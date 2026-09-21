//! Minimal ACP v1 stdio agent for permission allow/deny + Resume smoke tests.
//!
//! On every `session/prompt` it sends `session/request_permission` with
//! allow/reject options. Only after an allow selection does it stream agent
//! text and finish with `EndTurn`. Reject (or cancel) ends the turn without
//! streaming the "allowed" side-effect message.
//!
//! Advertises `agentCapabilities.loadSession` and implements `session/load`:
//! accepts ids shaped like `fake-session-N` (including across process restarts
//! for Mac `tauri:fake` Disconnect→Resume), replays a deterministic agent
//! message chunk before the load response, and rejects unknown ids.
//!
//! Permission is requested from a `connection.spawn` task so we do not await
//! `block_task` inside the prompt handler (that deadlocks the dispatch loop).

use std::sync::atomic::{AtomicU64, Ordering};

use agent_client_protocol::schema::v1::{
    AgentCapabilities, CancelNotification, ContentBlock, ContentChunk, InitializeRequest,
    InitializeResponse, LoadSessionRequest, LoadSessionResponse, NewSessionRequest,
    NewSessionResponse, PermissionOption, PermissionOptionKind, PromptRequest, PromptResponse,
    RequestPermissionOutcome, RequestPermissionRequest, SessionId, SessionNotification,
    SessionUpdate, StopReason, TextContent, ToolCallStatus, ToolCallUpdate, ToolCallUpdateFields,
    ToolKind,
};
use agent_client_protocol::{Agent, Client, ConnectionTo, Error, Stdio};

static NEXT_SESSION: AtomicU64 = AtomicU64::new(1);

const RESUME_REPLAY: &str = "fake-agent: resumed";

fn is_allow(outcome: &RequestPermissionOutcome) -> bool {
    match outcome {
        RequestPermissionOutcome::Selected(selected) => selected.option_id.0.as_ref() == "allow",
        RequestPermissionOutcome::Cancelled => false,
        _ => false,
    }
}

/// Fake sessions are `fake-session-<digits>`. Pattern (not in-memory set) so a
/// fresh agent process can still honor Resume after Disconnect.
fn is_known_fake_session(id: &str) -> bool {
    let Some(rest) = id.strip_prefix("fake-session-") else {
        return false;
    };
    !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit())
}

#[tokio::main]
async fn main() -> agent_client_protocol::Result<()> {
    // ACP owns stdout for JSON-RPC; keep diagnostics on stderr.
    eprintln!("fake-acp-agent: listening on stdio (ACP v1, loadSession=true)");

    Agent
        .builder()
        .name("fake-acp-agent")
        .on_receive_request(
            async move |initialize: InitializeRequest, responder, _connection| {
                responder.respond(
                    InitializeResponse::new(initialize.protocol_version)
                        .agent_capabilities(AgentCapabilities::new().load_session(true)),
                )
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            async move |_req: NewSessionRequest, responder, _connection| {
                let id = NEXT_SESSION.fetch_add(1, Ordering::Relaxed);
                responder.respond(NewSessionResponse::new(SessionId::new(format!(
                    "fake-session-{id}"
                ))))
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            async move |req: LoadSessionRequest, responder, connection: ConnectionTo<Client>| {
                let sid = req.session_id.0.as_ref();
                if !is_known_fake_session(sid) {
                    return responder.respond_with_error(
                        Error::invalid_params().data(format!("unknown session id: {sid}")),
                    );
                }

                // Spawn so we can yield between replay notify and the load
                // response — keeps session/update ahead of the JSON-RPC result
                // on stdio (host load_session_from queues pre-response replay).
                let session_id = req.session_id.clone();
                connection.spawn({
                    let connection = connection.clone();
                    async move {
                        connection.send_notification(SessionNotification::new(
                            session_id,
                            SessionUpdate::AgentMessageChunk(ContentChunk::new(
                                ContentBlock::Text(TextContent::new(RESUME_REPLAY)),
                            )),
                        ))?;
                        tokio::task::yield_now().await;
                        responder.respond(LoadSessionResponse::new())?;
                        Ok(())
                    }
                })?;
                Ok(())
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_notification(
            async move |_cancel: CancelNotification, _connection| Ok(()),
            agent_client_protocol::on_receive_notification!(),
        )
        .on_receive_request(
            async move |req: PromptRequest, responder, connection: ConnectionTo<Client>| {
                let session_id = req.session_id.clone();
                connection.spawn({
                    let connection = connection.clone();
                    async move {
                        let tool_call = ToolCallUpdate::new(
                            "fake-tool-1",
                            ToolCallUpdateFields::new()
                                .title("Fake sensitive action (smoke)")
                                .kind(ToolKind::Execute)
                                .status(ToolCallStatus::Pending),
                        );

                        let perm = connection
                            .send_request(RequestPermissionRequest::new(
                                session_id.clone(),
                                tool_call,
                                vec![
                                    PermissionOption::new(
                                        "allow",
                                        "Allow once",
                                        PermissionOptionKind::AllowOnce,
                                    ),
                                    PermissionOption::new(
                                        "reject",
                                        "Reject once",
                                        PermissionOptionKind::RejectOnce,
                                    ),
                                ],
                            ))
                            .block_task()
                            .await?;

                        if is_allow(&perm.outcome) {
                            connection.send_notification(SessionNotification::new(
                                session_id,
                                SessionUpdate::AgentMessageChunk(ContentChunk::new(
                                    ContentBlock::Text(TextContent::new("fake-agent: allowed")),
                                )),
                            ))?;
                        }

                        responder.respond(PromptResponse::new(StopReason::EndTurn))?;
                        Ok(())
                    }
                })?;
                Ok(())
            },
            agent_client_protocol::on_receive_request!(),
        )
        .connect_to(Stdio::new())
        .await
}
