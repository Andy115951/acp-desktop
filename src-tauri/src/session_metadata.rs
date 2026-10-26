//! Explicit presentation fields only: never forward provider `_meta` into UI/diagnostics.
use agent_client_protocol::schema::v1::{
    AvailableCommandInput, SessionNotification, SessionUpdate,
};
use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandInfo {
    pub name: String,
    pub description: String,
    pub input_hint: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextUsage {
    // Strings preserve the full provider u64; do not compute estimates or percentages.
    pub used: String,
    pub size: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMetadata {
    pub agent_id: String,
    pub cwd: String,
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commands: Option<Vec<CommandInfo>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<ContextUsage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config_options: Option<Vec<crate::session_config::ConfigOption>>,
}

pub fn metadata_event(
    agent_id: &str,
    cwd: &str,
    notification: &SessionNotification,
) -> Option<SessionMetadata> {
    let mut event = SessionMetadata {
        agent_id: agent_id.into(),
        cwd: cwd.into(),
        session_id: notification.session_id.0.to_string(),
        commands: None,
        usage: None,
        config_options: None,
    };
    match &notification.update {
        SessionUpdate::AvailableCommandsUpdate(update) => {
            let mut seen = std::collections::HashSet::new();
            event.commands = Some(
                update
                    .available_commands
                    .iter()
                    .filter(|c| {
                        !c.name.is_empty()
                            && c.name.len() <= 128
                            && !c.name.starts_with('/')
                            && !c.name.chars().any(|v| v.is_whitespace() || v.is_control())
                            && seen.insert(c.name.clone())
                    })
                    .take(100)
                    .map(|c| CommandInfo {
                        name: c.name.clone(),
                        description: c.description.chars().take(2000).collect(),
                        input_hint: match &c.input {
                            Some(AvailableCommandInput::Unstructured(input)) => {
                                Some(input.hint.chars().take(1000).collect())
                            }
                            _ => None,
                        },
                    })
                    .collect(),
            );
        }
        SessionUpdate::ConfigOptionUpdate(update) => {
            event.config_options = Some(crate::session_config::config_options(&update.config_options));
        }
        SessionUpdate::UsageUpdate(update) => {
            event.usage = Some(ContextUsage {
                used: update.used.to_string(),
                size: update.size.to_string(),
            })
        }
        _ => return None,
    }
    Some(event)
}

#[cfg(test)]
mod tests {
    use super::*;
    use agent_client_protocol::schema::v1::{
        AvailableCommand, AvailableCommandsUpdate, UsageUpdate,
    };

    #[test]
    fn commands_replace_with_empty_and_never_forward_meta() {
        let notification: SessionNotification = serde_json::from_value(serde_json::json!({
            "sessionId":"s", "update":{"sessionUpdate":"available_commands_update", "availableCommands":[
                {"name":"review","description":"Review files", "_meta":{"secret":"do-not-forward"}},
                {"name":"review","description":"duplicate"}, {"name":"bad\nname","description":"bad"}
            ]}
        })).unwrap();
        let event =
            serde_json::to_value(metadata_event("agent", "/cwd", &notification).unwrap()).unwrap();
        assert_eq!(event["commands"].as_array().unwrap().len(), 1);
        assert!(!event.to_string().contains("do-not-forward"));
        let empty = SessionNotification::new(
            "s",
            SessionUpdate::AvailableCommandsUpdate(AvailableCommandsUpdate::new(vec![])),
        );
        assert!(metadata_event("agent", "/cwd", &empty)
            .unwrap()
            .commands
            .unwrap()
            .is_empty());
    }

    #[test]
    fn usage_is_exact_and_no_cost_is_invented() {
        let notification = SessionNotification::new(
            "s",
            SessionUpdate::UsageUpdate(UsageUpdate::new(u64::MAX, 0)),
        );
        let event =
            serde_json::to_value(metadata_event("agent", "/cwd", &notification).unwrap()).unwrap();
        assert_eq!(event["usage"]["used"], u64::MAX.to_string());
        assert_eq!(event["usage"]["size"], "0");
        assert!(event.get("commands").is_none());
        assert!(!event.to_string().contains("cost"));
    }

    #[test]
    fn command_input_hint_is_preserved_without_raw_extensions() {
        let command =
            AvailableCommand::new("review", "Review").input(AvailableCommandInput::Unstructured(
                agent_client_protocol::schema::v1::UnstructuredCommandInput::new("files to review"),
            ));
        let n = SessionNotification::new(
            "s",
            SessionUpdate::AvailableCommandsUpdate(AvailableCommandsUpdate::new(vec![command])),
        );
        assert_eq!(
            metadata_event("a", "/c", &n).unwrap().commands.unwrap()[0]
                .input_hint
                .as_deref(),
            Some("files to review")
        );
    }
}
