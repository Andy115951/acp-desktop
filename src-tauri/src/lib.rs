use serde::Serialize;
use std::env;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    pub id: String,
    pub name: String,
    pub binary: String,
    pub available: bool,
}

fn binary_on_path(binary: &str) -> bool {
    let Some(path_os) = env::var_os("PATH") else {
        return false;
    };

    let candidates: Vec<PathBuf> = {
        #[cfg(windows)]
        {
            vec![
                PathBuf::from(binary),
                PathBuf::from(format!("{binary}.exe")),
                PathBuf::from(format!("{binary}.cmd")),
                PathBuf::from(format!("{binary}.bat")),
            ]
        }
        #[cfg(not(windows))]
        {
            vec![PathBuf::from(binary)]
        }
    };

    for dir in env::split_paths(&path_os) {
        for name in &candidates {
            let full = dir.join(name);
            if full.is_file() {
                return true;
            }
        }
    }
    false
}

/// Probe PATH for known agent CLIs. Grok is the M1 target; others are stubs for later.
#[tauri::command]
fn detect_agents() -> Vec<AgentInfo> {
    let agents = [
        ("grok", "Grok Build", "grok"),
        // Future agents (detect stubs only — no ACP handshake yet)
        ("codex", "Codex", "codex"),
        ("claude", "Claude Code", "claude"),
    ];

    agents
        .into_iter()
        .map(|(id, name, binary)| AgentInfo {
            id: id.to_string(),
            name: name.to_string(),
            binary: binary.to_string(),
            available: binary_on_path(binary),
        })
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![detect_agents])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_agents_includes_grok() {
        let agents = detect_agents();
        assert!(agents.iter().any(|a| a.id == "grok" && a.binary == "grok"));
    }
}
