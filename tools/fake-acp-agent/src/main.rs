//! Minimal ACP v1 stdio agent for permission allow/deny + Resume smoke tests.
//!
//! On ordinary `session/prompt` it sends `session/request_permission` with
//! allow/reject options. Only after an allow selection does it stream agent
//! text and finish with `EndTurn`. Reject (or cancel) ends the turn without
//! streaming the "allowed" side-effect message.
//! Reserved `fake:*` prompts exercise quota errors, explicit refusal reports,
//! and simultaneous permission requests without running actual tools.
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

fn permission_label(outcome: &RequestPermissionOutcome) -> &'static str {
    if is_allow(outcome) {
        "allowed"
    } else if matches!(outcome, RequestPermissionOutcome::Cancelled) {
        "cancelled"
    } else {
        "rejected"
    }
}

fn permission_request(session_id: SessionId, id: &str, title: &str) -> RequestPermissionRequest {
    RequestPermissionRequest::new(
        session_id,
        ToolCallUpdate::new(
            id.to_owned(),
            ToolCallUpdateFields::new()
                .title(title)
                .kind(ToolKind::Execute)
                .status(ToolCallStatus::Pending),
        ),
        vec![
            PermissionOption::new("allow", "Allow once", PermissionOptionKind::AllowOnce),
            PermissionOption::new("reject", "Reject once", PermissionOptionKind::RejectOnce),
        ],
    )
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
                let session_id = if std::env::args().any(|arg| arg == "--stale-session") {
                    "fake-stale-session".to_string()
                } else {
                    format!("fake-session-{id}")
                };
                responder.respond(NewSessionResponse::new(SessionId::new(session_id)))
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

                // Emit replay on this task before responding so it is on the
                // wire ahead of the JSON-RPC result. Respond from a spawn after
                // yield so we do not await block_task inside the request handler.
                let session_id = req.session_id.clone();
                connection.send_notification(SessionNotification::new(
                    session_id,
                    SessionUpdate::AgentMessageChunk(ContentChunk::new(ContentBlock::Text(
                        TextContent::new(RESUME_REPLAY),
                    ))),
                ))?;
                connection.spawn(async move {
                    tokio::task::yield_now().await;
                    responder.respond(LoadSessionResponse::new())?;
                    Ok(())
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
                let scenario = match req.prompt.first() {
                    Some(ContentBlock::Text(text)) => text.text.clone(),
                    _ => String::new(),
                };
                if scenario == "fake:usage-limit" {
                    return responder.respond_with_error(
                        Error::internal_error().data("usageLimitExceeded: fixture limit reached"),
                    );
                }
                let session_id = req.session_id.clone();
                connection.spawn({
                    let connection = connection.clone();
                    async move {
                        if scenario == "fake:stream" || scenario == "fake:long-stream" {
                            for text in ["Thinking ", "about the reply."] {
                                connection.send_notification(SessionNotification::new(
                                    session_id.clone(),
                                    SessionUpdate::AgentThoughtChunk(ContentChunk::new(
                                        ContentBlock::Text(TextContent::new(text)),
                                    )),
                                ))?;
                            }
                            let chunks = if scenario == "fake:long-stream" {
                                180
                            } else {
                                8
                            };
                            for index in 1..=chunks {
                                connection.send_notification(SessionNotification::new(
                                    session_id.clone(),
                                    SessionUpdate::AgentMessageChunk(ContentChunk::new(
                                        ContentBlock::Text(TextContent::new(format!(
                                            "Line {index}: streamed text · 中文 🦊\n"
                                        ))),
                                    )),
                                ))?;
                                tokio::time::sleep(std::time::Duration::from_millis(35)).await;
                            }
                            responder.respond(PromptResponse::new(StopReason::EndTurn))?;
                            return Ok(());
                        }
                        if scenario == "fake:parallel" {
                            let first = connection.send_request(permission_request(
                                session_id.clone(),
                                "fake-parallel-1",
                                "First parallel action (smoke)",
                            ));
                            let second = connection.send_request(permission_request(
                                session_id.clone(),
                                "fake-parallel-2",
                                "Second parallel action (smoke)",
                            ));
                            let (first, second) =
                                tokio::join!(first.block_task(), second.block_task());
                            let report = format!(
                                "fake-agent: first={} second={}",
                                permission_label(&first?.outcome),
                                permission_label(&second?.outcome)
                            );
                            connection.send_notification(SessionNotification::new(
                                session_id,
                                SessionUpdate::AgentMessageChunk(ContentChunk::new(
                                    ContentBlock::Text(TextContent::new(report)),
                                )),
                            ))?;
                            responder.respond(PromptResponse::new(StopReason::EndTurn))?;
                            return Ok(());
                        }
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
                        } else if scenario == "fake:deny-report" {
                            connection.send_notification(SessionNotification::new(
                                session_id,
                                SessionUpdate::AgentMessageChunk(ContentChunk::new(
                                    ContentBlock::Text(TextContent::new(format!(
                                        "fake-agent: tool {} by user",
                                        permission_label(&perm.outcome),
                                    ))),
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
