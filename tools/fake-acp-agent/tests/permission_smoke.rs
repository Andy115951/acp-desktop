//! Allow + reject smoke against the in-repo fake ACP agent (no Grok login).

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::schema::v1::{
    ContentBlock, InitializeRequest, NewSessionRequest, PermissionOptionKind, PromptRequest,
    RequestPermissionOutcome, RequestPermissionRequest, RequestPermissionResponse,
    SelectedPermissionOutcome, SessionNotification, SessionUpdate, StopReason, TextContent,
};
use agent_client_protocol::{AcpAgent, Agent, Client, ConnectionTo};

fn fake_agent() -> AcpAgent {
    let bin = env!("CARGO_BIN_EXE_fake-acp-agent");
    AcpAgent::from_args([bin]).expect("configure fake-acp-agent")
}

#[derive(Clone, Default)]
struct TurnOutcome {
    agent_text: Arc<Mutex<String>>,
    saw_permission: Arc<Mutex<bool>>,
    stop_reason: Arc<Mutex<Option<StopReason>>>,
}

async fn run_turn(select_option: Option<&str>) -> (StopReason, String, bool) {
    let outcome = TurnOutcome::default();
    let select = Arc::new(select_option.map(|s| s.to_string()));

    let notif_text = outcome.agent_text.clone();
    let saw = outcome.saw_permission.clone();
    let select_for_perm = select.clone();
    let stop_slot = outcome.stop_reason.clone();

    let connect = Client
        .builder()
        .name("permission-smoke")
        .on_receive_notification(
            async move |notification: SessionNotification, _cx| {
                if let SessionUpdate::AgentMessageChunk(chunk) = &notification.update {
                    let text = match &chunk.content {
                        ContentBlock::Text(t) => t.text.clone(),
                        other => format!("{other:?}"),
                    };
                    notif_text.lock().unwrap().push_str(&text);
                }
                Ok(())
            },
            agent_client_protocol::on_receive_notification!(),
        )
        .on_receive_request(
            async move |request: RequestPermissionRequest, responder, _connection| {
                *saw.lock().unwrap() = true;

                let has_allow = request
                    .options
                    .iter()
                    .any(|o| o.kind == PermissionOptionKind::AllowOnce);
                let has_reject = request
                    .options
                    .iter()
                    .any(|o| o.kind == PermissionOptionKind::RejectOnce);
                if !has_allow || !has_reject {
                    return responder.respond(RequestPermissionResponse::new(
                        RequestPermissionOutcome::Cancelled,
                    ));
                }

                let response = match select_for_perm.as_ref() {
                    Some(id) => RequestPermissionResponse::new(RequestPermissionOutcome::Selected(
                        SelectedPermissionOutcome::new(id.clone()),
                    )),
                    None => RequestPermissionResponse::new(RequestPermissionOutcome::Cancelled),
                };
                responder.respond(response)
            },
            agent_client_protocol::on_receive_request!(),
        )
        .connect_with(fake_agent(), |connection: ConnectionTo<Agent>| {
            let stop_slot = stop_slot.clone();
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

                *stop_slot.lock().unwrap() = Some(prompt.stop_reason);
                Ok(())
            }
        });

    tokio::time::timeout(Duration::from_secs(15), connect)
        .await
        .expect("timed out waiting for fake-agent permission turn")
        .expect("client connect");

    let reason = outcome
        .stop_reason
        .lock()
        .unwrap()
        .clone()
        .expect("stop reason");
    let text = outcome.agent_text.lock().unwrap().clone();
    let saw = *outcome.saw_permission.lock().unwrap();
    (reason, text, saw)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn allow_streams_agent_text_and_end_turn() {
    let (reason, text, saw) = run_turn(Some("allow")).await;
    assert!(saw, "expected session/request_permission");
    assert_eq!(reason, StopReason::EndTurn);
    assert!(
        text.contains("fake-agent: allowed"),
        "expected allowed side-effect text, got {text:?}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn reject_ends_without_allowed_side_effect() {
    let (reason, text, saw) = run_turn(Some("reject")).await;
    assert!(saw, "expected session/request_permission");
    assert_eq!(reason, StopReason::EndTurn);
    assert!(
        !text.contains("fake-agent: allowed"),
        "reject must not stream allowed text, got {text:?}"
    );
    assert!(
        text.is_empty(),
        "reject should stream no agent text, got {text:?}"
    );
}

#[test]
fn binary_is_built_for_tests() {
    let bin = PathBuf::from(env!("CARGO_BIN_EXE_fake-acp-agent"));
    assert!(bin.is_file(), "missing fake-acp-agent at {bin:?}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cancel_ends_without_allowed_side_effect() {
    let (reason, text, saw) = run_turn(None).await;
    assert!(saw, "expected session/request_permission");
    assert_eq!(reason, StopReason::EndTurn);
    assert!(
        !text.contains("fake-agent: allowed"),
        "cancel must not stream allowed text, got {text:?}"
    );
    assert!(
        text.is_empty(),
        "cancel should stream no agent text, got {text:?}"
    );
}

/// Mirror toolbar Cancel-while-Ask: Ask is already pending, then Cancelled
/// arrives after a short delay (host clears the oneshot out-of-band).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn delayed_cancel_while_ask_unblocks_prompt() {
    use tokio::sync::oneshot;

    let agent_text = Arc::new(Mutex::new(String::new()));
    let text_for_notif = agent_text.clone();
    let saw = Arc::new(Mutex::new(false));
    let saw_for_perm = saw.clone();
    let stop_slot = Arc::new(Mutex::new(None::<StopReason>));
    let stop_for_connect = stop_slot.clone();

    let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
    let cancel_rx = Arc::new(tokio::sync::Mutex::new(Some(cancel_rx)));

    let connect = Client
        .builder()
        .name("delayed-cancel-ask")
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
            async move |_request: RequestPermissionRequest, responder, _connection| {
                *saw_for_perm.lock().unwrap() = true;
                let rx = cancel_rx
                    .lock()
                    .await
                    .take()
                    .expect("cancel gate still present");
                let _ = rx.await;
                responder.respond(RequestPermissionResponse::new(
                    RequestPermissionOutcome::Cancelled,
                ))
            },
            agent_client_protocol::on_receive_request!(),
        )
        .connect_with(fake_agent(), |connection: ConnectionTo<Agent>| {
            let stop_slot = stop_for_connect.clone();
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
                        vec![ContentBlock::Text(TextContent::new("cancel-while-ask"))],
                    ))
                    .block_task()
                    .await?;

                *stop_slot.lock().unwrap() = Some(prompt.stop_reason);
                Ok(())
            }
        });

    let saw_for_driver = saw.clone();
    let driver = tokio::spawn(async move {
        for _ in 0..500 {
            if *saw_for_driver.lock().unwrap() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        assert!(
            *saw_for_driver.lock().unwrap(),
            "timed out waiting for Ask before Cancel"
        );
        // Brief settle so the host/agent are blocked inside request_permission.
        tokio::time::sleep(Duration::from_millis(20)).await;
        let _ = cancel_tx.send(());
    });

    tokio::time::timeout(Duration::from_secs(15), connect)
        .await
        .expect("timed out waiting for delayed-cancel turn")
        .expect("client connect");
    driver.await.expect("cancel driver");

    let reason = stop_slot
        .lock()
        .unwrap()
        .clone()
        .expect("stop reason after cancel");
    assert_eq!(reason, StopReason::EndTurn);
    let text = agent_text.lock().unwrap().clone();
    assert!(
        !text.contains("fake-agent: allowed"),
        "delayed cancel must not stream allowed text, got {text:?}"
    );
}
