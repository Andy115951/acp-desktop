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
