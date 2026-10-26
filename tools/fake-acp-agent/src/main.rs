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
    ConfigOptionUpdate, SessionConfigOption, SessionConfigSelectGroup, SessionConfigSelectOption, SetSessionConfigOptionRequest, SetSessionConfigOptionResponse,
    AvailableCommand, AvailableCommandInput, AvailableCommandsUpdate, UnstructuredCommandInput, UsageUpdate,
    AgentCapabilities, CancelNotification, ContentBlock, ContentChunk, Diff, InitializeRequest,
    InitializeResponse, ListSessionsRequest, ListSessionsResponse, LoadSessionRequest, LoadSessionResponse, NewSessionRequest,
    NewSessionResponse, PermissionOption, PermissionOptionKind, PromptRequest, PromptResponse,
    RequestPermissionOutcome, RequestPermissionRequest, SessionId, SessionNotification,
    SessionCapabilities, SessionInfo, SessionListCapabilities, SessionUpdate, StopReason, TextContent, ToolCall, ToolCallLocation, ToolCallStatus,
    ToolCallUpdate, ToolCallUpdateFields, ToolKind,
};
use agent_client_protocol::{Agent, Client, ConnectionTo, Error, Stdio};

static CONFIG_MODEL: AtomicU64 = AtomicU64::new(0);
static CONFIG_MODE: AtomicU64 = AtomicU64::new(0);
static CONFIG_REASONING: AtomicU64 = AtomicU64::new(0);

static NEXT_SESSION: AtomicU64 = AtomicU64::new(1);
static NEXT_TOOL: AtomicU64 = AtomicU64::new(1);

const RESUME_REPLAY: &str = "fake-agent: resumed";
const MARKDOWN_REPLY: &str = "## Markdown reply\n\nA **streamed** answer with `inline code`.\n\n- First item\n- 中文 🦊\n\n```ts\nconst greeting = 'hello';\nconsole.log(greeting);\n```\n\n| Item | State |\n| --- | --- |\n| Rendering | ready |\n\n[Project](https://github.com/Andy115951/acp-desktop)\n\n[Unsafe link](javascript:alert(1))\n\n![remote image](https://example.invalid/should-not-load.png)\n\n<script>alert('untrusted')</script>\n";

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

fn fake_config_options() -> Option<Vec<SessionConfigOption>> {
    if !std::env::args().any(|arg| arg == "--config-options") { return None; }
    Some(vec![
        SessionConfigOption::select("model", "Model", match CONFIG_MODEL.load(Ordering::Relaxed) { 1 => "fast", 2 => "slow", _ => "balanced" }, vec![
            SessionConfigSelectGroup::new("local", "Fixture models", vec![
                SessionConfigSelectOption::new("balanced", "Balanced"), SessionConfigSelectOption::new("fast", "Fast"),
                SessionConfigSelectOption::new("denied", "Rejected model"), SessionConfigSelectOption::new("slow", "Slow model"),
            ])
        ]).description("Choose an agent-advertised model"),
        SessionConfigOption::select("mode", "Mode", if CONFIG_MODE.load(Ordering::Relaxed) == 0 { "code" } else { "plan" }, vec![
            SessionConfigSelectOption::new("code", "Code"), SessionConfigSelectOption::new("plan", "Plan")]),
        SessionConfigOption::select("reasoning", "Reasoning", if CONFIG_REASONING.load(Ordering::Relaxed) == 0 { "low" } else { "high" }, vec![
            SessionConfigSelectOption::new("low", "Low"), SessionConfigSelectOption::new("high", "High")]),
    ])
}

fn send_session_info(connection: &ConnectionTo<Client>, session_id: SessionId) -> agent_client_protocol::Result<()> {
    if !std::env::args().any(|arg| arg == "--session-info") { return Ok(()); }
    connection.send_notification(SessionNotification::new(session_id.clone(), SessionUpdate::AvailableCommandsUpdate(
        AvailableCommandsUpdate::new(vec![
            AvailableCommand::new("review", "Review selected files").input(AvailableCommandInput::Unstructured(UnstructuredCommandInput::new("Files to review"))),
            AvailableCommand::new("compact", "Compact context"),
        ]))))?;
    connection.send_notification(SessionNotification::new(session_id, SessionUpdate::UsageUpdate(UsageUpdate::new(2048, 8192))))?;
    Ok(())
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
                let mut capabilities = AgentCapabilities::new().load_session(true);
                if std::env::args().any(|arg| arg == "--list-sessions" || arg == "--list-error") {
                    capabilities = capabilities.session_capabilities(SessionCapabilities::new().list(SessionListCapabilities::new()));
                }
                responder.respond(
                    InitializeResponse::new(if std::env::args().any(|arg| arg == "--unsupported-protocol") { agent_client_protocol::schema::ProtocolVersion::from(2u16) } else { initialize.protocol_version })
                        .agent_capabilities(capabilities),
                )
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            async move |request: ListSessionsRequest, responder, _connection| {
                if std::env::args().any(|arg| arg == "--list-error") {
                    return responder.respond_with_error(Error::internal_error().data("fixture listing unavailable"));
                }
                if !std::env::args().any(|arg| arg == "--list-sessions") {
                    return responder.respond_with_error(Error::method_not_found());
                }
                let cwd = request.cwd.unwrap_or_else(|| "/fixture".into());
                let page = if request.cursor.as_deref() == Some("second-page") {
                    ListSessionsResponse::new(vec![SessionInfo::new("fake-session-99", cwd).title("Discovered second page")])
                } else {
                    ListSessionsResponse::new(vec![
                        SessionInfo::new("fake-session-42", cwd).title("Discovered first page").updated_at("2026-01-01T00:00:00Z"),
                        SessionInfo::new("fake-session-888", "/foreign-workspace").title("Foreign workspace"),
                    ]).next_cursor("second-page")
                };
                responder.respond(page)
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            async move |_req: NewSessionRequest, responder, connection: ConnectionTo<Client>| {
                let id = NEXT_SESSION.fetch_add(1, Ordering::Relaxed);
                let session_id = if std::env::args().any(|arg| arg == "--stale-session") {
                    "fake-stale-session".to_string()
                } else {
                    format!("fake-session-{id}")
                };
                send_session_info(&connection, SessionId::new(session_id.clone()))?;
                responder.respond(NewSessionResponse::new(SessionId::new(session_id)).config_options(fake_config_options()))
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
                send_session_info(&connection, session_id.clone())?;
                connection.send_notification(SessionNotification::new(
                    session_id,
                    SessionUpdate::AgentMessageChunk(ContentChunk::new(ContentBlock::Text(
                        TextContent::new(if std::env::var("ACP_DESKTOP_FAKE_RICH_REPLAY").as_deref() == Ok("1") {
                            format!("{RESUME_REPLAY}\n\n{MARKDOWN_REPLY}")
                        } else { RESUME_REPLAY.to_string() }),
                    ))),
                ))?;
                connection.spawn(async move {
                    tokio::task::yield_now().await;
                    responder.respond(LoadSessionResponse::new().config_options(fake_config_options()))?;
                    Ok(())
                })?;
                Ok(())
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            async move |request: SetSessionConfigOptionRequest, responder, connection: ConnectionTo<Client>| {
                if fake_config_options().is_none() { return responder.respond_with_error(Error::method_not_found()); }
                let id = request.config_id.0.as_ref();
                let value = request.value.as_value_id().map(|v| v.0.to_string()).unwrap_or_default();
                let target = match id { "model" => &CONFIG_MODEL, "mode" => &CONFIG_MODE, "reasoning" => &CONFIG_REASONING, _ => return responder.respond_with_error(Error::invalid_params()) };
                let setting = match (id, value.as_str()) {
                    ("model", "balanced") | ("mode", "code") | ("reasoning", "low") => 0,
                    ("model", "fast") | ("mode", "plan") | ("reasoning", "high") => 1,
                    ("model", "slow") => 2,
                    _ => return responder.respond_with_error(Error::invalid_params().data("fixture-secret-do-not-render")),
                };
                connection.spawn(async move {
                    if value == "slow" { tokio::time::sleep(std::time::Duration::from_secs(5)).await; }
                    target.store(setting, Ordering::Relaxed);
                    responder.respond(SetSessionConfigOptionResponse::new(fake_config_options().unwrap_or_default()))?;
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
                if scenario == "fake:config-update" || scenario == "fake:clear-config" {
                    CONFIG_MODE.store(1, Ordering::Relaxed);
                    let options = if scenario == "fake:clear-config" { vec![] } else { fake_config_options().unwrap_or_default() };
                    connection.send_notification(SessionNotification::new(req.session_id.clone(), SessionUpdate::ConfigOptionUpdate(ConfigOptionUpdate::new(options))))?;
                    return responder.respond(PromptResponse::new(StopReason::EndTurn));
                }
                if scenario == "fake:clear-session-info" {
                    connection.send_notification(SessionNotification::new(req.session_id.clone(), SessionUpdate::AvailableCommandsUpdate(AvailableCommandsUpdate::new(vec![]))))?;
                    connection.send_notification(SessionNotification::new(req.session_id.clone(), SessionUpdate::UsageUpdate(UsageUpdate::new(4096, 8192))))?;
                    return responder.respond(PromptResponse::new(StopReason::EndTurn));
                }
                if scenario == "fake:usage-limit" {
                    return responder.respond_with_error(
                        Error::internal_error().data("usageLimitExceeded: fixture limit reached"),
                    );
                }
                let session_id = req.session_id.clone();
                connection.spawn({
                    let connection = connection.clone();
                    async move {
                        if scenario == "fake:markdown" {
                            let chars: Vec<char> = MARKDOWN_REPLY.chars().collect();
                            for chunk in chars.chunks(24) {
                                connection.send_notification(SessionNotification::new(
                                    session_id.clone(), SessionUpdate::AgentMessageChunk(ContentChunk::new(
                                        ContentBlock::Text(TextContent::new(chunk.iter().collect::<String>())),
                                    )),
                                ))?;
                                tokio::time::sleep(std::time::Duration::from_millis(25)).await;
                            }
                            responder.respond(PromptResponse::new(StopReason::EndTurn))?;
                            return Ok(());
                        }
                        if scenario == "fake:tool" {
                            let id = format!("fake-rich-{}", NEXT_TOOL.fetch_add(1, Ordering::Relaxed));
                            let input = serde_json::json!({"command": "printf 'approved\\n' > preview.txt", "fixtureOnly": true});
                            let location = ToolCallLocation::new("/fixture/preview.txt").line(1);
                            connection.send_notification(SessionNotification::new(session_id.clone(),
                                SessionUpdate::ToolCall(ToolCall::new(id.clone(), "Preview file change")
                                    .kind(ToolKind::Edit).status(ToolCallStatus::Pending)
                                    .raw_input(input.clone()).locations(vec![location.clone()])),
                            ))?;
                            let permission = permission_request(session_id.clone(), &id, "Preview file change");
                            let permission = RequestPermissionRequest::new(session_id.clone(),
                                ToolCallUpdate::new(id.clone(), ToolCallUpdateFields::new()
                                    .title("Preview file change").kind(ToolKind::Edit)
                                    .raw_input(input).locations(vec![location])), permission.options);
                            let result = connection.send_request(permission).block_task().await?;
                            let allowed = is_allow(&result.outcome);
                            if allowed {
                                connection.send_notification(SessionNotification::new(session_id.clone(),
                                    SessionUpdate::ToolCallUpdate(ToolCallUpdate::new(id.clone(),
                                        ToolCallUpdateFields::new().status(ToolCallStatus::InProgress))),
                                ))?;
                            }
                            let content = if allowed { vec![Diff::new("/fixture/preview.txt", "approved\n").old_text("before\n").into()] }
                                else { vec![ContentBlock::Text(TextContent::new("Tool refused; no file was written.")).into()] };
                            connection.send_notification(SessionNotification::new(session_id.clone(),
                                SessionUpdate::ToolCallUpdate(ToolCallUpdate::new(id,
                                    ToolCallUpdateFields::new()
                                        .status(if allowed { ToolCallStatus::Completed } else { ToolCallStatus::Failed })
                                        .content(content).raw_output(serde_json::json!({"outcome": permission_label(&result.outcome)})))),
                            ))?;
                            connection.send_notification(SessionNotification::new(session_id,
                                SessionUpdate::AgentMessageChunk(ContentChunk::new(ContentBlock::Text(TextContent::new(
                                    format!("Tool outcome: **{}**.", permission_label(&result.outcome)),
                                )))),
                            ))?;
                            responder.respond(PromptResponse::new(StopReason::EndTurn))?;
                            return Ok(());
                        }
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
