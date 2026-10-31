//! Verify the host's connection-level replay handler across repeated loads.
use std::sync::{Arc, atomic::{AtomicUsize, Ordering}};
use std::time::Duration;

use agent_client_protocol::{AcpAgent, Agent, Client, ConnectionTo};
use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::schema::v1::{
    ContentBlock, InitializeRequest, LoadSessionRequest, PromptRequest,
    RequestPermissionOutcome, RequestPermissionRequest, RequestPermissionResponse,
    SessionNotification, SessionUpdate, TextContent,
};

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn direct_load_replays_before_ready_and_keeps_permission_handler() {
    let count = Arc::new(AtomicUsize::new(0));
    let observed = count.clone();
    let agent = AcpAgent::from_args([env!("CARGO_BIN_EXE_fake-acp-agent")]).unwrap();
    let connection_count = count.clone();
    let permission_count = Arc::new(AtomicUsize::new(0));
    let observed_permission = permission_count.clone();
    let client = Client.builder().name("direct-load-probe")
        .on_receive_notification(async move |notification: SessionNotification, _| {
            // Exercise ordered delivery even if a notification handler is slow.
            tokio::time::sleep(Duration::from_millis(10)).await;
            if matches!(notification.update, SessionUpdate::AgentMessageChunk(_)) {
                observed.fetch_add(1, Ordering::SeqCst);
            }
            Ok(())
        }, agent_client_protocol::on_receive_notification!())
        .on_receive_request(async move |_: RequestPermissionRequest, responder, _| {
            observed_permission.fetch_add(1, Ordering::SeqCst);
            responder.respond(RequestPermissionResponse::new(RequestPermissionOutcome::Cancelled))
        }, agent_client_protocol::on_receive_request!())
        .connect_with(agent, |connection: ConnectionTo<Agent>| async move {
            connection.send_request(InitializeRequest::new(ProtocolVersion::V1)).block_task().await?;
            for i in 0..25 {
                let before = connection_count.load(Ordering::SeqCst);
                connection.send_request(LoadSessionRequest::new("fake-session-42", std::env::temp_dir())).block_task().await?;
                assert_eq!(connection_count.load(Ordering::SeqCst), before + 1, "replay must arrive exactly once before load returns, iteration {i}");
            }
            let missing = connection.send_request(LoadSessionRequest::new("missing-session", std::env::temp_dir())).block_task().await;
            assert!(missing.is_err());
            connection.send_request(PromptRequest::new("fake-session-42", vec![ContentBlock::Text(TextContent::new("after-load"))])).block_task().await?;
            Ok(())
        });
    tokio::time::timeout(Duration::from_secs(15), client).await.unwrap().unwrap();
    assert_eq!(permission_count.load(Ordering::SeqCst), 1);
}
