//! Recover the user's CLI search path for macOS launches outside a terminal.
//! Import PATH only: shell output and unrelated environment values are discarded.
use std::ffi::{OsStr, OsString};
use std::io::{self, Read};
use std::os::unix::ffi::OsStringExt;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const MARKER: &[u8] = b"\0ACP_DESKTOP_PATH\0";
const PRINT_PATH: &str = r#"/usr/bin/printf '\000ACP_DESKTOP_PATH\000%s\000' "$PATH""#;
const MAX_OUTPUT: usize = 64 * 1024;

/// Call before Tauri or any app worker starts, so detection and all spawned
/// agents (including /usr/bin/env node scripts) inherit the same PATH.
#[cfg(target_os = "macos")]
pub fn initialize() {
    let shell = std::env::var_os("SHELL")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute() && p.is_file())
        .unwrap_or_else(|| PathBuf::from("/bin/zsh"));
    let recovered = read_shell_path(&shell, Duration::from_secs(3));
    let path = merged_path(
        recovered.as_deref(),
        std::env::var_os("PATH").as_deref(),
        std::env::var_os("HOME").as_deref().map(Path::new),
    );
    if let Some(path) = path {
        std::env::set_var("PATH", path);
    }
}

fn read_shell_path(shell: &Path, timeout: Duration) -> Option<OsString> {
    let mut command = Command::new(shell);
    command.args(["-ilc", PRINT_PATH]);
    bounded_path_output(&mut command, timeout)
}

fn bounded_path_output(command: &mut Command, timeout: Duration) -> Option<OsString> {
    // A nonblocking socket avoids a reader thread that could remain stuck when
    // a shell startup script leaves a background child holding stdout open.
    let (mut reader, writer) = std::os::unix::net::UnixStream::pair().ok()?;
    reader.set_nonblocking(true).ok()?;
    let writer: std::os::fd::OwnedFd = writer.into();
    command
        .stdin(Stdio::null())
        .stdout(Stdio::from(writer))
        .stderr(Stdio::null());
    command.process_group(0);
    let mut child = command.spawn().ok()?;
    let deadline = Instant::now() + timeout;
    let mut output = Vec::new();
    let mut buffer = [0; 4096];
    let result = 'probe: loop {
        if Instant::now() >= deadline {
            break None;
        }
        // Bound each drain iteration, even if the shell writes continuously.
        loop {
            if Instant::now() >= deadline {
                break 'probe None;
            }
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => {
                    if output.len() + n > MAX_OUTPUT {
                        break 'probe None;
                    }
                    output.extend_from_slice(&buffer[..n]);
                }
                Err(e) if e.kind() == io::ErrorKind::WouldBlock => break,
                Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
                Err(_) => break 'probe None,
            }
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                // The shell can exit between the read and try_wait; drain the
                // final already-written bytes before parsing the framed value.
                loop {
                    match reader.read(&mut buffer) {
                        Ok(0) => break,
                        Ok(n) => {
                            if output.len() + n > MAX_OUTPUT {
                                break 'probe None;
                            }
                            output.extend_from_slice(&buffer[..n]);
                        }
                        Err(e) if e.kind() == io::ErrorKind::WouldBlock => break,
                        Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
                        Err(_) => break 'probe None,
                    }
                    if Instant::now() >= deadline {
                        break 'probe None;
                    }
                }
                break status.success().then(|| parse_path(&output)).flatten();
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(10)),
            Err(_) => break None,
        }
    };
    // This is our own process group, never the app's or an existing terminal's.
    // Also clean up descendants on success (startup scripts may background jobs).
    unsafe {
        libc::kill(-(child.id() as libc::pid_t), libc::SIGKILL);
    }
    let _ = child.wait();
    result
}

fn parse_path(output: &[u8]) -> Option<OsString> {
    let start = output.windows(MARKER.len()).rposition(|w| w == MARKER)? + MARKER.len();
    let tail = &output[start..];
    let end = tail.iter().position(|b| *b == 0)?;
    if end == 0 {
        return None;
    }
    Some(OsString::from_vec(tail[..end].to_vec()))
}

fn merged_path(
    shell: Option<&OsStr>,
    inherited: Option<&OsStr>,
    home: Option<&Path>,
) -> Option<OsString> {
    let mut dirs = Vec::<PathBuf>::new();
    let mut add = |dir: PathBuf| {
        // Empty/relative entries would search the selected project directory.
        if dir.is_absolute() && !dirs.contains(&dir) {
            dirs.push(dir);
        }
    };
    for value in [shell, inherited].into_iter().flatten() {
        for dir in std::env::split_paths(value) {
            add(dir);
        }
    }
    if let Some(home) = home.filter(|p| p.is_absolute()) {
        for suffix in [
            ".local/bin",
            ".grok/bin",
            ".cargo/bin",
            ".volta/bin",
            ".bun/bin",
        ] {
            add(home.join(suffix));
        }
    }
    for dir in [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
    ] {
        add(PathBuf::from(dir));
    }
    std::env::join_paths(dirs).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn noisy_output_imports_only_framed_path_and_preserves_spaces() {
        let value = parse_path(b"banner\nSECRET=discarded\n\0ACP_DESKTOP_PATH\0/Users/example/Tools With Spaces:/usr/bin\0trailing noise").unwrap();
        assert_eq!(value, "/Users/example/Tools With Spaces:/usr/bin");
        assert!(parse_path(b"/unframed/path").is_none());
        assert!(parse_path(b"\0ACP_DESKTOP_PATH\0unterminated").is_none());
        assert!(parse_path(b"\0ACP_DESKTOP_PATH\0\0").is_none());
    }
    #[test]
    fn merge_keeps_shell_priority_and_inherited_paths_without_project_search() {
        let path = merged_path(
            Some(OsStr::new("/custom/node/bin:/usr/bin::relative")),
            Some(OsStr::new("/usr/bin:/inherited/bin")),
            Some(Path::new("/Users/example")),
        )
        .unwrap();
        let dirs: Vec<_> = std::env::split_paths(&path).collect();
        assert_eq!(
            &dirs[..3],
            &[
                PathBuf::from("/custom/node/bin"),
                PathBuf::from("/usr/bin"),
                PathBuf::from("/inherited/bin")
            ]
        );
        assert!(dirs.contains(&PathBuf::from("/Users/example/.local/bin")));
        assert!(dirs.contains(&PathBuf::from("/Users/example/.grok/bin")));
        assert!(dirs.contains(&PathBuf::from("/opt/homebrew/bin")));
        assert!(dirs.iter().all(|p| p.is_absolute()));
        assert_eq!(
            dirs.iter()
                .filter(|p| **p == PathBuf::from("/usr/bin"))
                .count(),
            1
        );
    }
    #[test]
    fn missing_or_failed_shell_still_has_safe_fallback_paths() {
        assert!(read_shell_path(
            Path::new("/nonexistent/acp-shell"),
            Duration::from_millis(100)
        )
        .is_none());
        let mut command = Command::new("/bin/sh");
        command.args(["-c", "exit 1"]);
        assert!(bounded_path_output(&mut command, Duration::from_secs(1)).is_none());
        let path = merged_path(None, None, None).unwrap();
        assert!(std::env::split_paths(&path).any(|p| p == Path::new("/usr/local/bin")));
    }
    #[test]
    fn real_shell_probe_is_framed() {
        assert!(read_shell_path(Path::new("/bin/sh"), Duration::from_secs(3)).is_some());
    }
    #[test]
    fn hung_shell_and_inherited_stdout_are_bounded() {
        let mut command = Command::new("/bin/sh");
        command.args(["-c", "sleep 30 & wait"]);
        let start = Instant::now();
        assert!(bounded_path_output(&mut command, Duration::from_millis(100)).is_none());
        assert!(start.elapsed() < Duration::from_secs(2));
        let mut command = Command::new("/bin/sh");
        command.args([
            "-c",
            "sleep 30 & /usr/bin/printf '\\000ACP_DESKTOP_PATH\\000/usr/bin\\000'",
        ]);
        let start = Instant::now();
        assert_eq!(
            bounded_path_output(&mut command, Duration::from_secs(1)),
            Some(OsString::from("/usr/bin"))
        );
        assert!(start.elapsed() < Duration::from_secs(2));
    }
    #[test]
    fn recovered_path_launches_an_env_shebang_from_a_directory_with_spaces() {
        use std::os::unix::fs::PermissionsExt;
        let root = std::env::temp_dir().join(format!("acp path {}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let node = root.join("node");
        let adapter = root.join("adapter");
        std::fs::write(&node, "#!/bin/sh\nprintf 'fake-node-ok'\n").unwrap();
        std::fs::write(&adapter, "#!/usr/bin/env node\n").unwrap();
        for p in [&node, &adapter] {
            std::fs::set_permissions(p, std::fs::Permissions::from_mode(0o700)).unwrap();
        }
        let mut shell = Command::new("/bin/sh");
        shell.args(["-c", PRINT_PATH]).env("PATH", &root);
        let recovered = bounded_path_output(&mut shell, Duration::from_secs(1)).unwrap();
        let path = merged_path(Some(&recovered), Some(OsStr::new("/usr/bin:/bin")), None).unwrap();
        let result = Command::new("adapter").env("PATH", path).output().unwrap();
        std::fs::remove_dir_all(root).unwrap();
        assert!(result.status.success());
        assert_eq!(result.stdout, b"fake-node-ok");
    }
    #[test]
    fn excessive_shell_output_is_rejected() {
        let mut command = Command::new("/bin/sh");
        command.args(["-c", "while :; do printf 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'; done"]);
        let start = Instant::now();
        assert!(bounded_path_output(&mut command, Duration::from_secs(1)).is_none());
        assert!(start.elapsed() < Duration::from_secs(2));
    }
}
