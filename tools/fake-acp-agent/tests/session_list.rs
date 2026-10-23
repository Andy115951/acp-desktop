use agent_client_protocol::schema::v1::{InitializeRequest, ListSessionsRequest};
use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::{AcpAgent, Agent, Client, ConnectionTo};
use std::time::Duration;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn advertised_listing_paginates_without_creating_a_session() {
    let agent =
        AcpAgent::from_args([env!("CARGO_BIN_EXE_fake-acp-agent"), "--list-sessions"]).unwrap();
    let connection = Client.builder().name("list-test").connect_with(
        agent,
        |connection: ConnectionTo<Agent>| async move {
            let init = connection
                .send_request(InitializeRequest::new(ProtocolVersion::V1))
                .block_task()
                .await?;
            assert!(init.agent_capabilities.session_capabilities.list.is_some());
            let first = connection
                .send_request(ListSessionsRequest::new().cwd("/fixture"))
                .block_task()
                .await?;
            assert_eq!(first.sessions[0].session_id.0.as_ref(), "fake-session-42");
            assert_eq!(first.next_cursor.as_deref(), Some("second-page"));
            let second = connection
                .send_request(
                    ListSessionsRequest::new()
                        .cwd("/fixture")
                        .cursor(first.next_cursor),
                )
                .block_task()
                .await?;
            assert_eq!(second.sessions[0].session_id.0.as_ref(), "fake-session-99");
            assert!(second.next_cursor.is_none());
            Ok(())
        },
    );
    tokio::time::timeout(Duration::from_secs(15), connection)
        .await
        .unwrap()
        .unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn advertised_list_error_is_a_normal_protocol_failure() {
    let agent =
        AcpAgent::from_args([env!("CARGO_BIN_EXE_fake-acp-agent"), "--list-error"]).unwrap();
    let connection = Client.builder().name("list-error-test").connect_with(
        agent,
        |connection: ConnectionTo<Agent>| async move {
            let init = connection
                .send_request(InitializeRequest::new(ProtocolVersion::V1))
                .block_task()
                .await?;
            assert!(init.agent_capabilities.session_capabilities.list.is_some());
            assert!(connection
                .send_request(ListSessionsRequest::new().cwd("/fixture"))
                .block_task()
                .await
                .is_err());
            Ok(())
        },
    );
    tokio::time::timeout(Duration::from_secs(15), connection)
        .await
        .unwrap()
        .unwrap();
}
