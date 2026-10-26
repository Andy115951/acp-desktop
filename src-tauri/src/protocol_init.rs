//! ACP v1 negotiation precedes discovery and every session operation.
use agent_client_protocol::schema::{
    v1::{InitializeRequest, InitializeResponse},
    ProtocolVersion,
};
use agent_client_protocol::{Agent, ConnectionTo};

pub const UNSUPPORTED_VERSION: &str =
    "Unsupported ACP protocol version. This client supports ACP v1 only. Use a v1-compatible agent.";

pub struct Capabilities {
    pub load_session: bool,
    pub list_sessions: bool,
}

fn accept_response(response: InitializeResponse) -> agent_client_protocol::Result<Capabilities> {
    if response.protocol_version != ProtocolVersion::V1 {
        return Err(agent_client_protocol::Error::internal_error().data(UNSUPPORTED_VERSION));
    }
    // New capability keys and provider metadata do not implicitly enable any
    // feature. Only the capabilities implemented by the shared host are used.
    Ok(Capabilities {
        load_session: response.agent_capabilities.load_session,
        list_sessions: response
            .agent_capabilities
            .session_capabilities
            .list
            .is_some(),
    })
}

pub async fn initialize_v1(
    connection: &ConnectionTo<Agent>,
) -> agent_client_protocol::Result<Capabilities> {
    let response = connection
        .send_request(InitializeRequest::new(ProtocolVersion::V1))
        .block_task()
        .await
        .map_err(|error| {
            agent_client_protocol::Error::internal_error()
                .data(format!("initialize failed: {error}"))
        })?;
    accept_response(response)
}

#[cfg(test)]
mod tests {
    use super::*;
    use agent_client_protocol::schema::v1::{NewSessionRequest, NewSessionResponse};
    use agent_client_protocol::{AcpAgent, Client};
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };

    #[test]
    fn missing_and_unknown_capabilities_stay_off_without_exposing_metadata() {
        for extra in [
            serde_json::json!({}),
            serde_json::json!({
                "futureCapability": {"enabled": true},
                "sessionCapabilities": {"futureSessionMethod": {}},
                "_meta": {"credential": "must-not-appear"}
            }),
        ] {
            let response: InitializeResponse = serde_json::from_value(serde_json::json!({
                "protocolVersion": 1, "agentCapabilities": extra,
                "futureResponseField": "ignored", "_meta": {"credential": "must-not-appear"}
            }))
            .unwrap();
            let capabilities = accept_response(response).unwrap();
            assert!(!capabilities.load_session);
            assert!(!capabilities.list_sessions);
        }
        let response: InitializeResponse = serde_json::from_value(serde_json::json!({
            "protocolVersion": 1, "agentCapabilities": {"loadSession": true,
                "sessionCapabilities": {"list": {}, "futureSessionMethod": {}}}
        }))
        .unwrap();
        let capabilities = accept_response(response).unwrap();
        assert!(capabilities.load_session);
        assert!(capabilities.list_sessions);
    }

    #[tokio::test]
    async fn mismatched_versions_close_before_any_session_request_and_v1_can_connect_afterward() {
        // Same production initializer, in-memory peer: the session handler is a
        // tripwire, not a mocked result of the version comparison.
        for version in [0u16, 2, 65535, 1] {
            let sessions = Arc::new(AtomicUsize::new(0));
            let received = sessions.clone();
            let agent = Agent
                .builder()
                .on_receive_request(
                    async move |request: InitializeRequest, responder, _cx| {
                        assert_eq!(request.protocol_version, ProtocolVersion::V1);
                        let capabilities =
                            serde_json::to_value(request.client_capabilities).unwrap();
                        assert_ne!(capabilities["terminal"], true);
                        assert!(capabilities
                            .pointer("/session/configOptions/boolean")
                            .is_none_or(serde_json::Value::is_null));
                        responder.respond(InitializeResponse::new(ProtocolVersion::from(version)))
                    },
                    agent_client_protocol::on_receive_request!(),
                )
                .on_receive_request(
                    async move |_request: NewSessionRequest, responder, _cx| {
                        received.fetch_add(1, Ordering::SeqCst);
                        responder.respond(NewSessionResponse::new("session-1"))
                    },
                    agent_client_protocol::on_receive_request!(),
                );
            let client = Client
                .builder()
                .connect_with(agent, async move |connection| {
                    initialize_v1(&connection).await?;
                    connection
                        .send_request(NewSessionRequest::new(std::env::temp_dir()))
                        .block_task()
                        .await?;
                    Ok(())
                });
            let result = tokio::time::timeout(std::time::Duration::from_secs(5), client)
                .await
                .unwrap();
            if version == 1 {
                result.unwrap();
                assert_eq!(sessions.load(Ordering::SeqCst), 1);
            } else {
                let error = result.unwrap_err().to_string();
                assert!(error.contains(UNSUPPORTED_VERSION), "{error}");
                assert_eq!(sessions.load(Ordering::SeqCst), 0);
                for id in ["grok", "codex", "claude", "copilot", "custom-test"] {
                    assert_eq!(
                        crate::agent_backend::enrich_connect_error(id, &error),
                        UNSUPPORTED_VERSION
                    );
                }
            }
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn stdio_mismatch_is_rejected_with_safe_actionable_diagnostics() {
        let binary = crate::agent_backend::find_fake_agent_bin().unwrap();
        let agent =
            AcpAgent::from_args([binary.to_str().unwrap(), "--unsupported-protocol"]).unwrap();
        let client = Client
            .builder()
            .connect_with(agent, async move |connection| {
                initialize_v1(&connection).await?;
                panic!("unsupported peer must not reach session setup");
                #[allow(unreachable_code)]
                Ok(())
            });
        let error = tokio::time::timeout(std::time::Duration::from_secs(5), client)
            .await
            .unwrap()
            .unwrap_err()
            .to_string();
        assert!(error.contains(UNSUPPORTED_VERSION), "{error}");
    }
}
