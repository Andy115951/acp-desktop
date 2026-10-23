use agent_client_protocol::schema::v1::{
    ContentBlock, InitializeRequest, NewSessionRequest, PromptRequest, SessionNotification,
    SessionUpdate, TextContent,
};
use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::{AcpAgent, Agent, Client, ConnectionTo};
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn session_info_fixture_reports_commands_context_and_live_replacement() {
    let reports = Arc::new(Mutex::new(Vec::new()));
    let notifications = reports.clone();
    let agent =
        AcpAgent::from_args([env!("CARGO_BIN_EXE_fake-acp-agent"), "--session-info"]).unwrap();
    let connection = Client
        .builder()
        .name("session-info-test")
        .on_receive_notification(
            async move |notification: SessionNotification, _cx| {
                notifications.lock().unwrap().push(notification.update);
                Ok(())
            },
            agent_client_protocol::on_receive_notification!(),
        )
        .connect_with(agent, |connection: ConnectionTo<Agent>| async move {
            connection
                .send_request(InitializeRequest::new(ProtocolVersion::V1))
                .block_task()
                .await?;
            let session = connection
                .send_request(NewSessionRequest::new(std::env::temp_dir()))
                .block_task()
                .await?;
            connection
                .send_request(PromptRequest::new(
                    session.session_id,
                    vec![ContentBlock::Text(TextContent::new(
                        "fake:clear-session-info",
                    ))],
                ))
                .block_task()
                .await?;
            Ok(())
        });
    tokio::time::timeout(Duration::from_secs(15), connection)
        .await
        .unwrap()
        .unwrap();
    let reports = reports.lock().unwrap();
    let commands: Vec<_> = reports
        .iter()
        .filter_map(|r| match r {
            SessionUpdate::AvailableCommandsUpdate(c) => Some(c.available_commands.len()),
            _ => None,
        })
        .collect();
    let used: Vec<_> = reports
        .iter()
        .filter_map(|r| match r {
            SessionUpdate::UsageUpdate(u) => Some(u.used),
            _ => None,
        })
        .collect();
    assert_eq!(commands, vec![2, 0]);
    assert_eq!(used, vec![2048, 4096]);
}
