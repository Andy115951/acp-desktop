//! loadSession advertise + session/load replay / reject against fake-acp-agent.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::schema::v1::{
    ContentBlock, InitializeRequest, LoadSessionRequest, NewSessionRequest, PermissionOptionKind,
    PromptRequest, RequestPermissionOutcome, RequestPermissionRequest, RequestPermissionResponse,
    SelectedPermissionOutcome, SessionNotification, SessionUpdate, StopReason, TextContent,
};
use agent_client_protocol::util::MatchDispatch;
use agent_client_protocol::{AcpAgent, Agent, Client, ConnectionTo, ErrorCode, SessionMessage};

fn fake_agent() -> AcpAgent {
    let bin = env!("CARGO_BIN_EXE_fake-acp-agent");
    AcpAgent::from_args([bin]).expect("configure fake-acp-agent")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn initialize_advertises_load_session() {
    let flag = Arc::new(Mutex::new(None));
    let flag_for_connect = flag.clone();

    let connect = Client
        .builder()
        .name("load-session-cap")
        .connect_with(fake_agent(), |connection: ConnectionTo<Agent>| {
            let flag = flag_for_connect.clone();
            async move {
                let init = connection
                    .send_request(InitializeRequest::new(ProtocolVersion::V1))
                    .block_task()
                    .await?;
                *flag.lock().unwrap() = Some(init.agent_capabilities.load_session);
                Ok(())
            }
        });

    tokio::time::timeout(Duration::from_secs(15), connect)
        .await
        .expect("timed out")
        .expect("client connect");

    assert_eq!(*flag.lock().unwrap(), Some(true));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn new_session_prompt_allow_then_load_replays_text() {
    let agent_text = Arc::new(Mutex::new(String::new()));
    let text_for_notif = agent_text.clone();
    let loaded_text = Arc::new(Mutex::new(String::new()));
    let loaded_for_connect = loaded_text.clone();
    let saw_perm = Arc::new(Mutex::new(false));
    let saw_for_perm = saw_perm.clone();

    let connect = Client
        .builder()
        .name("load-session-replay")
        .on_receive_notification(
            async move |notification: SessionNotification, _cx| {
                if let SessionUpdate::AgentMessageChunk(chunk) = &notification.update {
                    let text = match &chunk.content {
                        ContentBlock::Text(t) => t.text.clone(),
                        other => format!("{other:?}"),
                    };
                    text_for_notif.lock().unwrap().push_str(&text);
                }
                Ok(())
            },
            agent_client_protocol::on_receive_notification!(),
        )
        .on_receive_request(
            async move |request: RequestPermissionRequest, responder, _connection| {
                *saw_for_perm.lock().unwrap() = true;
                let has_allow = request
                    .options
                    .iter()
                    .any(|o| o.kind == PermissionOptionKind::AllowOnce);
                assert!(has_allow, "expected AllowOnce option");
                responder.respond(RequestPermissionResponse::new(
                    RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new("allow")),
                ))
            },
            agent_client_protocol::on_receive_request!(),
        )
        .connect_with(fake_agent(), |connection: ConnectionTo<Agent>| {
            let loaded_for_connect = loaded_for_connect.clone();
            async move {
                connection
                    .send_request(InitializeRequest::new(ProtocolVersion::V1))
                    .block_task()
                    .await?;

                let session = connection
                    .send_request(NewSessionRequest::new(std::env::temp_dir()))
                    .block_task()
                    .await?;

                let prompt = connection
                    .send_request(PromptRequest::new(
                        session.session_id.clone(),
                        vec![ContentBlock::Text(TextContent::new("smoke"))],
                    ))
                    .block_task()
                    .await?;
                assert_eq!(prompt.stop_reason, StopReason::EndTurn);

                // Mirror host: load_session_from + drain replay updates.
                let mut restored = connection
                    .load_session_from(LoadSessionRequest::new(
                        session.session_id.clone(),
                        std::env::temp_dir(),
                    ))
                    .block_task()
                    .start_session()
                    .await?;

                let deadline = tokio::time::Instant::now() + Duration::from_millis(500);
                loop {
                    let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
                    if remaining.is_zero() {
                        break;
                    }
                    match tokio::time::timeout(remaining, restored.session_mut().read_update()).await
                    {
                        Ok(Ok(SessionMessage::SessionMessage(dispatch))) => {
                            let sink = loaded_for_connect.clone();
                            let _ = MatchDispatch::new(dispatch)
                                .if_notification(async move |notif: SessionNotification| {
                                    if let SessionUpdate::AgentMessageChunk(chunk) = &notif.update {
                                        let text = match &chunk.content {
                                            ContentBlock::Text(t) => t.text.clone(),
                                            other => format!("{other:?}"),
                                        };
                                        sink.lock().unwrap().push_str(&text);
                                    }
                                    Ok(())
                                })
                                .await;
                        }
                        Ok(Ok(_)) => {}
                        Ok(Err(_)) => break,
                        Err(_) => break,
                    }
                }

                Ok(())
            }
        });

    tokio::time::timeout(Duration::from_secs(20), connect)
        .await
        .expect("timed out")
        .expect("client connect");

    assert!(
        *saw_perm.lock().unwrap(),
        "expected permission on prompt before load"
    );
    let conn_text = agent_text.lock().unwrap().clone();
    assert!(
        conn_text.contains("fake-agent: allowed"),
        "expected allow side-effect before load, got {conn_text:?}"
    );

    let replay = loaded_text.lock().unwrap().clone();
    // Prefer ActiveSession (host drain_load_replay). Connection handler is the
    // fallback the host also uses for post-response session/update.
    let saw_resume =
        replay.contains("fake-agent: resumed") || conn_text.contains("fake-agent: resumed");
    assert!(
        saw_resume,
        "expected load replay text; ActiveSession={replay:?} connection={conn_text:?}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn load_unknown_session_id_fails() {
    let connect = Client
        .builder()
        .name("load-session-unknown")
        .connect_with(fake_agent(), |connection: ConnectionTo<Agent>| async move {
            let init = connection
                .send_request(InitializeRequest::new(ProtocolVersion::V1))
                .block_task()
                .await?;
            assert!(init.agent_capabilities.load_session);

            let err = connection
                .load_session_from(LoadSessionRequest::new(
                    "not-a-real-session",
                    std::env::temp_dir(),
                ))
                .block_task()
                .start_session()
                .await
                .expect_err("unknown session id must fail");
            assert_eq!(err.code, ErrorCode::InvalidParams);
            Ok(())
        });

    tokio::time::timeout(Duration::from_secs(15), connect)
        .await
        .expect("timed out")
        .expect("client connect");
}

/// Fresh process (no prior session/new in this connection) still accepts a
/// previously-shaped `fake-session-N` id — mirrors Disconnect→Resume.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn load_fake_session_id_across_fresh_process_replays() {
    let replay = Arc::new(Mutex::new(String::new()));
    let replay_notif = replay.clone();

    let connect = Client
        .builder()
        .name("load-session-fresh")
        .on_receive_notification(
            async move |notification: SessionNotification, _cx| {
                if let SessionUpdate::AgentMessageChunk(chunk) = &notification.update {
                    if let ContentBlock::Text(t) = &chunk.content {
                        replay_notif.lock().unwrap().push_str(&t.text);
                    }
                }
                Ok(())
            },
            agent_client_protocol::on_receive_notification!(),
        )
        .connect_with(fake_agent(), |connection: ConnectionTo<Agent>| {
            let replay = replay.clone();
            async move {
                connection
                    .send_request(InitializeRequest::new(ProtocolVersion::V1))
                    .block_task()
                    .await?;

                let mut restored = connection
                    .load_session_from(LoadSessionRequest::new(
                        "fake-session-42",
                        std::env::temp_dir(),
                    ))
                    .block_task()
                    .start_session()
                    .await?;

                let deadline = tokio::time::Instant::now() + Duration::from_millis(500);
                loop {
                    let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
                    if remaining.is_zero() {
                        break;
                    }
                    match tokio::time::timeout(remaining, restored.session_mut().read_update()).await
                    {
                        Ok(Ok(SessionMessage::SessionMessage(dispatch))) => {
                            let sink = replay.clone();
                            let _ = MatchDispatch::new(dispatch)
                                .if_notification(async move |notif: SessionNotification| {
                                    if let SessionUpdate::AgentMessageChunk(chunk) = &notif.update {
                                        if let ContentBlock::Text(t) = &chunk.content {
                                            sink.lock().unwrap().push_str(&t.text);
                                        }
                                    }
                                    Ok(())
                                })
                                .await;
                        }
                        Ok(Ok(_)) => {}
                        Ok(Err(_)) => break,
                        Err(_) => break,
                    }
                }

                Ok(())
            }
        });

    tokio::time::timeout(Duration::from_secs(15), connect)
        .await
        .expect("timed out")
        .expect("client connect");

    let text = replay.lock().unwrap().clone();
    assert!(
        text.contains("fake-agent: resumed"),
        "expected resume replay, got {text:?}"
    );
}
