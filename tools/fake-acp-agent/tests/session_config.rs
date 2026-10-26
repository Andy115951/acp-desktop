use agent_client_protocol::schema::v1::{
    InitializeRequest, LoadSessionRequest, NewSessionRequest, SessionConfigKind,
    SetSessionConfigOptionRequest,
};
use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::{AcpAgent, Agent, Client, ConnectionTo};
use std::time::Duration;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn advertised_config_survives_acceptance_rejection_and_load_in_acp_v1() {
    let agent =
        AcpAgent::from_args([env!("CARGO_BIN_EXE_fake-acp-agent"), "--config-options"]).unwrap();
    let connection = Client.builder().name("config-test").connect_with(
        agent,
        |connection: ConnectionTo<Agent>| async move {
            let init = connection
                .send_request(InitializeRequest::new(ProtocolVersion::V1))
                .block_task()
                .await?;
            assert_eq!(init.protocol_version, ProtocolVersion::V1);
            let session = connection
                .send_request(NewSessionRequest::new(std::env::temp_dir()))
                .block_task()
                .await?;
            let options = session.config_options.unwrap();
            assert_eq!(options.len(), 3);
            let SessionConfigKind::Select(model) = &options[0].kind else {
                panic!("select model");
            };
            assert_eq!(model.current_value.0.as_ref(), "balanced");
            let accepted = connection
                .send_request(SetSessionConfigOptionRequest::new(
                    session.session_id.clone(),
                    "model",
                    "fast",
                ))
                .block_task()
                .await?;
            let SessionConfigKind::Select(model) = &accepted.config_options[0].kind else {
                panic!("select model");
            };
            assert_eq!(model.current_value.0.as_ref(), "fast");
            assert!(connection
                .send_request(SetSessionConfigOptionRequest::new(
                    session.session_id.clone(),
                    "model",
                    "denied"
                ))
                .block_task()
                .await
                .is_err());
            let loaded = connection
                .send_request(LoadSessionRequest::new(
                    session.session_id,
                    std::env::temp_dir(),
                ))
                .block_task()
                .await?;
            let SessionConfigKind::Select(model) = &loaded.config_options.unwrap()[0].kind else {
                panic!("select model");
            };
            assert_eq!(model.current_value.0.as_ref(), "fast");
            Ok(())
        },
    );
    tokio::time::timeout(Duration::from_secs(15), connection)
        .await
        .unwrap()
        .unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn legacy_agent_does_not_invent_configuration_support() {
    let agent = AcpAgent::from_args([env!("CARGO_BIN_EXE_fake-acp-agent")]).unwrap();
    let connection = Client.builder().name("legacy-config-test").connect_with(
        agent,
        |connection: ConnectionTo<Agent>| async move {
            connection
                .send_request(InitializeRequest::new(ProtocolVersion::V1))
                .block_task()
                .await?;
            let session = connection
                .send_request(NewSessionRequest::new(std::env::temp_dir()))
                .block_task()
                .await?;
            assert!(session.config_options.is_none());
            Ok(())
        },
    );
    tokio::time::timeout(Duration::from_secs(15), connection)
        .await
        .unwrap()
        .unwrap();
}
