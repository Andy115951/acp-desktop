//! Local launch profiles, separate from credentials and vendor-owned history.
use crate::agent_backend::AgentInfo;
use agent_client_protocol::{AcpAgent, AcpAgentConfig};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Manager};

const MAX_PROFILES: usize = 32;
const MAX_FILE_BYTES: u64 = 512 * 1024;
const FILE_ERROR: &str = "Could not read or save custom agents. Existing profiles were retained.";

#[derive(Default)]
pub struct CustomAgentsState(pub Mutex<()>);

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CustomAgent {
    pub id: String,
    pub name: String,
    pub executable: String,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CustomAgentInput {
    pub id: Option<String>,
    pub name: String,
    pub executable: String,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(deny_unknown_fields)]
struct Registry {
    version: u32,
    agents: Vec<CustomAgent>,
}

fn valid_id(id: &str) -> bool {
    id.strip_prefix("custom-")
        .is_some_and(|value| uuid::Uuid::parse_str(value).is_ok())
}

fn secret_key(key: &str) -> bool {
    let upper = key.to_ascii_uppercase();
    [
        "TOKEN",
        "SECRET",
        "PASSWORD",
        "PASSWD",
        "CREDENTIAL",
        "API_KEY",
        "APIKEY",
        "PRIVATE_KEY",
        "AUTHORIZATION",
    ]
    .iter()
    .any(|part| upper.contains(part))
}

impl CustomAgent {
    pub fn validate(&self) -> Result<(), String> {
        if !valid_id(&self.id) {
            return Err("Invalid custom agent ID.".into());
        }
        if self.name.trim().is_empty()
            || self.name.len() > 100
            || self.name.chars().any(char::is_control)
        {
            return Err("Enter a name of at most 100 bytes without control characters.".into());
        }
        let executable = Path::new(&self.executable);
        if self.executable.trim().is_empty()
            || self.executable.len() > 4096
            || self.executable.chars().any(char::is_control)
            || (!executable.is_absolute()
                && (self.executable.contains('/') || self.executable.contains('\\')))
        {
            return Err("Use an absolute executable path or a command name on PATH.".into());
        }
        if self.args.len() > 128
            || self
                .args
                .iter()
                .any(|arg| arg.len() > 8192 || arg.contains('\0'))
        {
            return Err("Use at most 128 arguments, each at most 8192 bytes without NUL.".into());
        }
        if self.env.len() > 64
            || self.env.iter().any(|(key, value)| {
                key.is_empty()
                    || key.len() > 128
                    || !key.bytes().enumerate().all(|(i, c)| {
                        c == b'_' || c.is_ascii_alphabetic() || (i > 0 && c.is_ascii_digit())
                    })
                    || secret_key(key)
                    || value.len() > 8192
                    || value.contains('\0')
            })
        {
            return Err("Environment overrides require valid variable names and non-secret values. Keep tokens, API keys and passwords in the CLI's existing authentication setup.".into());
        }
        if self.args.iter().map(String::len).sum::<usize>()
            + self
                .env
                .iter()
                .map(|(k, v)| k.len() + v.len())
                .sum::<usize>()
            > 32 * 1024
        {
            return Err("Custom agent arguments and environment are too large.".into());
        }
        Ok(())
    }

    pub fn launch(&self) -> Result<AcpAgent, String> {
        self.validate()?;
        // Do not use from_args: it interprets leading NAME=value entries. Paths,
        // empty arguments and shell-looking strings here must remain literal.
        Ok(AcpAgent::new(
            AcpAgentConfig::new(&self.executable)
                .args(self.args.clone())
                .envs(self.env.clone()),
        ))
    }

    pub fn info(&self) -> AgentInfo {
        let available = if Path::new(&self.executable).is_absolute() {
            executable_file(Path::new(&self.executable))
        } else {
            self.env
                .get("PATH")
                .map(std::ffi::OsString::from)
                .or_else(|| std::env::var_os("PATH"))
                .is_some_and(|path| {
                    std::env::split_paths(&path)
                        .any(|dir| executable_file(&dir.join(&self.executable)))
                })
        };
        AgentInfo {
            id: self.id.clone(),
            name: self.name.clone(),
            binary: self.executable.clone(),
            available,
            connectable: true,
            detail: None,
            detail_code: None,
        }
    }
}

fn executable_file(path: &Path) -> bool {
    let Ok(meta) = path.metadata() else {
        return false;
    };
    if !meta.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if meta.permissions().mode() & 0o111 == 0 {
            return false;
        }
    }
    true
}

fn read_profiles(path: &Path) -> Result<Vec<CustomAgent>, String> {
    match fs::metadata(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Ok(meta) if meta.len() <= MAX_FILE_BYTES => {}
        _ => return Err(FILE_ERROR.into()),
    }
    let bytes = fs::read(path).map_err(|_| FILE_ERROR)?;
    let registry: Registry = serde_json::from_slice(&bytes).map_err(|_| FILE_ERROR)?;
    if registry.version != 1 || registry.agents.len() > MAX_PROFILES {
        return Err(FILE_ERROR.into());
    }
    let mut ids = HashSet::new();
    for profile in &registry.agents {
        profile.validate().map_err(|_| FILE_ERROR)?;
        if !ids.insert(&profile.id) {
            return Err(FILE_ERROR.into());
        }
    }
    Ok(registry.agents)
}

fn write_profiles(path: &Path, agents: Vec<CustomAgent>) -> Result<(), String> {
    let bytes =
        serde_json::to_vec_pretty(&Registry { version: 1, agents }).map_err(|_| FILE_ERROR)?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err("Custom agent storage is full.".into());
    }
    fs::create_dir_all(path.parent().ok_or(FILE_ERROR)?).map_err(|_| FILE_ERROR)?;
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, bytes).map_err(|_| FILE_ERROR)?;
    fs::rename(&temporary, path).map_err(|_| FILE_ERROR)?;
    Ok(())
}

fn profile_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|_| FILE_ERROR)?
        .join("custom-agents.json"))
}

pub fn load(app: &AppHandle) -> Result<Vec<CustomAgent>, String> {
    let state = app.state::<CustomAgentsState>();
    let _guard = state.0.lock().map_err(|_| FILE_ERROR)?;
    read_profiles(&profile_path(app)?)
}

fn upsert(agents: &mut Vec<CustomAgent>, input: CustomAgentInput) -> Result<CustomAgent, String> {
    let existing = match &input.id {
        Some(id) => Some(
            agents
                .iter()
                .position(|a| &a.id == id)
                .ok_or("Custom agent no longer exists.")?,
        ),
        None if agents.len() < MAX_PROFILES => None,
        None => return Err("At most 32 custom agents can be saved.".into()),
    };
    let profile = CustomAgent {
        id: input
            .id
            .unwrap_or_else(|| format!("custom-{}", uuid::Uuid::new_v4())),
        name: input.name,
        executable: input.executable,
        args: input.args,
        env: input.env,
    };
    profile.validate()?;
    if let Some(index) = existing {
        agents[index] = profile.clone();
    } else {
        agents.push(profile.clone());
    }
    Ok(profile)
}

#[tauri::command]
pub fn list_custom_agents(app: AppHandle) -> Result<Vec<CustomAgent>, String> {
    load(&app)
}

#[tauri::command]
pub fn save_custom_agent(app: AppHandle, input: CustomAgentInput) -> Result<CustomAgent, String> {
    let state = app.state::<CustomAgentsState>();
    let _guard = state.0.lock().map_err(|_| FILE_ERROR)?;
    ensure_disconnected(&app)?;
    let path = profile_path(&app)?;
    let mut agents = read_profiles(&path)?;
    let saved = upsert(&mut agents, input)?;
    write_profiles(&path, agents)?;
    Ok(saved)
}

#[tauri::command]
pub fn remove_custom_agent(app: AppHandle, id: String) -> Result<(), String> {
    let state = app.state::<CustomAgentsState>();
    let _guard = state.0.lock().map_err(|_| FILE_ERROR)?;
    ensure_disconnected(&app)?;
    let path = profile_path(&app)?;
    let mut agents = read_profiles(&path)?;
    let index = agents
        .iter()
        .position(|a| a.id == id)
        .ok_or("Custom agent no longer exists.")?;
    agents.remove(index);
    // App session metadata and vendor files are deliberately retained.
    write_profiles(&path, agents)
}

fn ensure_disconnected(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<crate::acp_host::AppState>();
    if state
        .inner
        .lock()
        .map_err(|_| FILE_ERROR)?
        .session
        .is_some()
    {
        return Err("Disconnect before editing custom agents.".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn input() -> CustomAgentInput {
        CustomAgentInput {
            id: None,
            name: "Local agent".into(),
            executable: "/path with spaces/agent=name".into(),
            args: vec![
                "hello world".into(),
                "".into(),
                "$(touch should-not-exist)".into(),
                "a=b".into(),
            ],
            env: BTreeMap::from([("PROFILE".into(), "a b=$HOME".into())]),
        }
    }
    fn directory() -> PathBuf {
        let path = std::env::temp_dir().join(format!("acp custom {}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        path
    }
    #[test]
    fn profile_edit_retains_identity_and_literal_launch_fields() {
        let mut profiles = vec![];
        let first = upsert(&mut profiles, input()).unwrap();
        let launch = first.launch().unwrap();
        assert_eq!(
            launch.config().command(),
            Path::new("/path with spaces/agent=name")
        );
        assert_eq!(launch.config().arguments(), input().args);
        assert_eq!(launch.config().environment(), &input().env);
        let mut edit = input();
        edit.id = Some(first.id.clone());
        edit.name = "Renamed".into();
        assert_eq!(upsert(&mut profiles, edit).unwrap().id, first.id);
        assert_eq!(profiles.len(), 1);
        let another = upsert(&mut profiles, input()).unwrap();
        assert_ne!(another.id, first.id);
    }
    #[test]
    fn rejects_identity_reuse_builtin_ids_and_missing_profiles() {
        let mut profiles = vec![];
        for id in [
            "grok".to_string(),
            format!("custom-{}", uuid::Uuid::new_v4()),
        ] {
            let mut edit = input();
            edit.id = Some(id);
            assert!(upsert(&mut profiles, edit).is_err());
        }
        assert!(profiles.is_empty());
    }
    #[test]
    fn rejects_secret_keys_invalid_shapes_and_oversized_payloads_without_echo() {
        let mut profiles = vec![];
        for key in [
            "OPENAI_API_KEY",
            "apiKey",
            "AUTH_TOKEN",
            "PASSWORD",
            "PRIVATE_KEY",
            "1INVALID",
            "BAD=KEY",
        ] {
            let mut invalid = input();
            invalid
                .env
                .insert(key.into(), "do-not-echo-private-value".into());
            let error = upsert(&mut profiles, invalid).err().unwrap();
            assert!(!error.contains("do-not-echo"));
        }
        let mut invalid = input();
        invalid.executable = "./relative/agent".into();
        assert!(upsert(&mut profiles, invalid).is_err());
        let mut invalid = input();
        invalid.args.push("bad\0argument".into());
        assert!(upsert(&mut profiles, invalid).is_err());
        let mut invalid = input();
        invalid.args = vec!["x".repeat(8192); 5];
        assert!(upsert(&mut profiles, invalid).is_err());
        assert!(profiles.is_empty());
    }
    #[test]
    fn registry_round_trip_rejects_unknown_schema_duplicate_ids_and_failed_save() {
        let dir = directory();
        let path = dir.join("custom-agents.json");
        assert!(read_profiles(&path).unwrap().is_empty());
        let mut profiles = vec![];
        let first = upsert(&mut profiles, input()).unwrap();
        write_profiles(&path, profiles.clone()).unwrap();
        assert_eq!(read_profiles(&path).unwrap()[0].id, first.id);
        let original = fs::read(&path).unwrap();
        // An unwritable staging destination must leave the previous profile intact.
        fs::create_dir(path.with_extension("tmp")).unwrap();
        assert!(write_profiles(&path, vec![]).is_err());
        assert_eq!(fs::read(&path).unwrap(), original);
        fs::write(&path, br#"{"version":2,"agents":[]}"#).unwrap();
        assert!(read_profiles(&path).is_err());
        fs::write(
            &path,
            serde_json::to_vec(&Registry {
                version: 1,
                agents: vec![first.clone(), first],
            })
            .unwrap(),
        )
        .unwrap();
        assert!(read_profiles(&path).is_err());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn custom_errors_preserve_recovery_phase_without_provider_or_launch_values() {
        for raw in [
            "session/load failed: SECRET",
            "prompt failed: SECRET",
            "initialize failed: SECRET",
        ] {
            let message = crate::agent_backend::enrich_connect_error("custom-test", raw);
            assert!(!message.contains("SECRET"));
            if raw.starts_with("session/load") {
                assert!(message.starts_with("session/load failed"));
            }
            if raw.starts_with("prompt") {
                assert!(message.starts_with("prompt failed"));
            }
        }
    }
    #[cfg(unix)]
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn saved_profile_launches_space_path_with_literal_args_and_child_only_env() {
        use agent_client_protocol::schema::{
            v1::{InitializeRequest, NewSessionRequest},
            ProtocolVersion,
        };
        use agent_client_protocol::{Agent, Client, ConnectionTo};
        use std::os::unix::fs::PermissionsExt;
        let dir = directory();
        let script = dir.join("agent with spaces=name");
        fs::write(
            &script,
            r#"#!/bin/sh
[ "$1" = 'hello world' ] || exit 21
[ "$2" = '' ] || exit 22
[ "$3" = '$(touch should-not-exist)' ] || exit 23
[ "$4" = 'a=b' ] || exit 24
[ "$ACP_CUSTOM_TEST_VALUE" = 'a b=$HOME' ] || exit 25
[ -n "$HOME" ] || exit 26
exec "$5" --config-options
"#,
        )
        .unwrap();
        fs::set_permissions(&script, fs::Permissions::from_mode(0o700)).unwrap();
        let mut config = input();
        config.executable = script.to_str().unwrap().into();
        config.args.push(
            crate::agent_backend::find_fake_agent_bin()
                .unwrap()
                .to_str()
                .unwrap()
                .into(),
        );
        config.env = BTreeMap::from([("ACP_CUSTOM_TEST_VALUE".into(), "a b=$HOME".into())]);
        let before = std::env::var_os("ACP_CUSTOM_TEST_VALUE");
        let mut profiles = vec![];
        upsert(&mut profiles, config).unwrap();
        let file = dir.join("profiles.json");
        write_profiles(&file, profiles).unwrap();
        let restored = read_profiles(&file).unwrap().remove(0);
        assert!(restored.info().available);
        let connection = Client.builder().name("custom-launch-test").connect_with(
            restored.launch().unwrap(),
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
                assert_eq!(session.config_options.unwrap().len(), 3);
                Ok(())
            },
        );
        tokio::time::timeout(std::time::Duration::from_secs(15), connection)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(std::env::var_os("ACP_CUSTOM_TEST_VALUE"), before);
        fs::remove_dir_all(dir).unwrap();
    }
}
