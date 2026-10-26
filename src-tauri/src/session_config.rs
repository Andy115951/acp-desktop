//! Only advertised select values are writable; unknown control kinds stay read-only.
use agent_client_protocol::schema::v1::{
    SessionConfigKind, SessionConfigOption, SessionConfigSelectOptions,
};
use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigChoice {
    pub value: String,
    pub name: String,
    pub group: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigOption {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub current_value: Option<String>,
    pub choices: Vec<ConfigChoice>,
    pub writable: bool,
}

pub fn config_options(options: &[SessionConfigOption]) -> Vec<ConfigOption> {
    let mut ids = std::collections::HashSet::new();
    options
        .iter()
        .filter(|o| !o.id.0.is_empty() && ids.insert(o.id.0.to_string()))
        .take(100)
        .map(|option| {
            let mut dto = ConfigOption {
                id: option.id.0.to_string(),
                name: option.name.clone(),
                description: option.description.clone(),
                current_value: None,
                choices: vec![],
                writable: false,
            };
            if let SessionConfigKind::Select(select) = &option.kind {
                dto.current_value = Some(select.current_value.0.to_string());
                let groups = match &select.options {
                    SessionConfigSelectOptions::Ungrouped(values) => {
                        vec![(None, values.as_slice())]
                    }
                    SessionConfigSelectOptions::Grouped(groups) => groups
                        .iter()
                        .map(|g| (Some(g.name.clone()), g.options.as_slice()))
                        .collect(),
                    _ => vec![],
                };
                let mut values = std::collections::HashSet::new();
                dto.choices = groups
                    .into_iter()
                    .flat_map(|(group, options)| {
                        options.iter().map(move |o| ConfigChoice {
                            value: o.value.0.to_string(),
                            name: o.name.clone(),
                            group: group.clone(),
                        })
                    })
                    .filter(|o| values.insert(o.value.clone()))
                    .take(1000)
                    .collect();
                dto.writable = !dto.choices.is_empty();
            }
            dto
        })
        .collect()
}

#[derive(Default)]
pub struct ConfigSnapshot {
    session_id: Option<String>,
    bound: bool,
    options: Vec<ConfigOption>,
}

impl ConfigSnapshot {
    pub fn bind(&mut self, session_id: &str) {
        if self.session_id.as_deref() != Some(session_id) {
            self.options.clear();
        }
        self.session_id = Some(session_id.into());
        self.bound = true;
    }

    pub fn update(&mut self, session_id: &str, options: Vec<ConfigOption>) -> bool {
        if self.bound && self.session_id.as_deref() != Some(session_id) {
            return false;
        }
        self.session_id = Some(session_id.into());
        self.options = options;
        true
    }

    pub fn permits(&self, session_id: &str, id: &str, value: &str) -> bool {
        self.bound
            && self.session_id.as_deref() == Some(session_id)
            && self.options.iter().any(|o| {
                o.id == id && o.writable && o.choices.iter().any(|choice| choice.value == value)
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use agent_client_protocol::schema::v1::{SessionConfigSelectGroup, SessionConfigSelectOption};

    fn options() -> Vec<SessionConfigOption> {
        vec![SessionConfigOption::select(
            "model",
            "Model",
            "a",
            vec![SessionConfigSelectGroup::new(
                "g",
                "Provider",
                vec![
                    SessionConfigSelectOption::new("a", "A"),
                    SessionConfigSelectOption::new("b", "B"),
                ],
            )],
        )]
    }

    #[test]
    fn grouped_choices_and_exact_current_value_are_preserved_without_extensions() {
        let mut options = options();
        options[0].meta =
            Some(serde_json::from_value(serde_json::json!({"token":"do-not-forward"})).unwrap());
        let value = serde_json::to_value(config_options(&options)).unwrap();
        assert_eq!(value[0]["currentValue"], "a");
        assert_eq!(value[0]["choices"][1]["group"], "Provider");
        assert!(!value.to_string().contains("do-not-forward"));
    }

    #[test]
    fn validates_session_identity_advertised_values_and_revocation() {
        let mut state = ConfigSnapshot::default();
        state.update("s", config_options(&options()));
        assert!(!state.permits("s", "model", "b"));
        state.bind("s");
        assert!(state.permits("s", "model", "b"));
        assert!(!state.permits("s", "model", "invented"));
        assert!(!state.permits("other", "model", "b"));
        assert!(!state.update("other", vec![]));
        state.update("s", vec![]);
        assert!(!state.permits("s", "model", "b"));
    }

    #[test]
    fn unadvertised_boolean_controls_are_read_only_and_rebinding_drops_old_options() {
        let dto = config_options(&[SessionConfigOption::boolean("flag", "Flag", true)]);
        assert!(!dto[0].writable);
        let mut state = ConfigSnapshot::default();
        state.update("old", config_options(&options()));
        state.bind("new");
        assert!(!state.permits("new", "model", "b"));
    }
}
