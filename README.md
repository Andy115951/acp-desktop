# acp-desktop

Unofficial desktop **ACP client**: one window to switch the local coding-agent CLIs you already installed (Grok Build, Codex, Claude Code, and others that speak ACP).

**Not affiliated with, endorsed by, or a product of xAI, OpenAI, Anthropic, or any other vendor.** Their names and marks belong to them. This repo does not ship vendor CLIs, installers, or credentials.

Install and sign in to each CLI yourself. This app starts its ACP stdio endpoint (for example `grok agent stdio`, `codex-acp`, `claude-agent-acp` or `copilot --acp`). Conversations stay in vendor-owned storage. Agent permission requests are shown for your approval.

## What it is

A small ACP window — not an IDE, not a single-vendor Grok wrapper:

- Detect which CLIs are on `PATH` (missing ones stay grey)
- Switch agent in one window; histories do not mix
- Streaming chat + permission cards (allow / deny)
- Resume the same vendor session the TUI uses

## How agents connect

ACP = [Agent Client Protocol](https://agentclientprotocol.com): JSON-RPC between a window/IDE and a local coding agent (usually stdin/stdout). MCP is agent↔tools; ACP is window↔agent.

| CLI | How we talk to it (no PTY scrape) |
| --- | --- |
| Grok Build | `grok agent stdio` |
| Claude Code | usually `@agentclientprotocol/claude-agent-acp` |
| Codex | `@agentclientprotocol/codex-acp` |
| Copilot CLI | `copilot --acp` (public preview) |
| Anything without ACP | out of scope |

## Architecture

```text
React (Vite)  --Tauri IPC-->  Rust host (Tauri 2)
                                 |
                                 |  agent-client-protocol (ACP v1)
                                 v
                           grok agent stdio | codex-acp | claude-agent-acp | copilot --acp
```

- UI never talks to the CLI directly; the Rust host owns spawn, handshake, streaming, and permission replies.
- Vendor session files stay in each CLI’s own directories; this app does not re-store chat history.
- See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for `AgentBackend`, event flow, and defaults.

## Status

The core conversation, workspace/session and custom-agent features are implemented.
The first public beta is in preparation under [M12 #35](https://github.com/Andy115951/acp-desktop/issues/35).
CI produces macOS arm64 candidates; fresh-user installation and publication remain
open. See the [tested compatibility matrix](docs/COMPATIBILITY.md),
[troubleshooting guide](docs/TROUBLESHOOTING.md) and [unreleased beta notes](docs/BETA_RELEASE_NOTES.md).

**Startup:** the window opens without requesting initial focus. On macOS, launching while another app is active leaves that app active; click ACP Desktop when you are ready to use it.

**Agent session information:** while connected, the app shows slash commands and context usage reported by the current agent. A command button inserts its name before your draft; add arguments and send explicitly. Reports refresh during a session and reset on disconnect or context change. Missing reports remain unknown, and empty command lists are distinct from missing reports. Token counts are shown exactly as reported; the app does not estimate usage or normalize prices.

**Session configuration:** the connected agent can report select controls for model, mode, reasoning or other settings, including grouped choices. The app uses the reported IDs, current values and choices without hard-coded vendor defaults. Changing a choice waits for the agent response; rejected or timed-out changes retain the last reported values and show a retry notice. Controls and prompt sending are disabled while a change is pending, but Disconnect remains available. Live reports replace the option list. Missing reports remain unknown; unsupported control types are read-only and boolean controls are not advertised by this client. Configuration is session-local and is refreshed by the agent on Resume.

**Saved sessions:** after Disconnect, choose an app-known session for the current agent/workspace and click Resume. New session keeps the earlier entries, and relaunch restores the most recently used session as the default. Existing cwd→sessionId preferences migrate automatically. Workspace/session selection is disabled until you disconnect; a missing or expired session is removed from the picker without discarding other entries or deleting vendor history. Use Recent workspaces to return to a previously opened folder. Rename changes only the app title; Archive app entry hides a record without deleting vendor history, and Archived sessions lets you restore it. These actions require a disconnected, idle session. Connect and Resume also discover vendor sessions when the agent advertises `sessionCapabilities.list`, following pagination for the selected workspace. Unsupported agents keep the app-known list. Discovery errors, repeated cursors or safety limits show an incomplete notice and keep existing entries usable (10 seconds total, up to 20 pages / 2,000 entries per connection). Local names, archives and stale-entry decisions are preserved.

## Quickstart

1. Install and log in to your intended agent CLI independently. Check the
   [tested versions and limitations](docs/COMPATIBILITY.md), including the open
   Claude acceptance blocker.
2. For development, follow [CONTRIBUTING.md](CONTRIBUTING.md) and start the app
   from source. Candidate archive trust and installation status are documented in
   [PACKAGING.md](docs/PACKAGING.md); no public beta install is certified yet.
3. Click the app window, choose a folder and agent, then Connect. Send a prompt
   and decide any requested permissions explicitly. Disconnect before changing
   agent/workspace; Resume loads a selected saved session when supported.

## Develop

Prerequisites: [Node.js](https://nodejs.org/) 22.23.4 for candidate parity, [Rust](https://rustup.rs/) 1.90 (pinned in `rust-toolchain.toml`), and OS webview deps ([Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) — on macOS that means Xcode CLT / WebKit).

```bash
npm ci
npm run tauri dev
```

The optional real-agent smoke scripts below use your account, can consume quota,
and automatically answer permission requests. Read the
[real-agent testing guidance](CONTRIBUTING.md#optional-real-agent-checks) before
running them. They are separate from the deterministic fake-agent tests.

### Codex ACP headless Connect/Ask/Resume (Mac)

Spawns the same argv as `CodexBackend` (`codex-acp` if on `PATH`, else `npx -y @agentclientprotocol/codex-acp`), then over stdio NDJSON runs:

`initialize` → `session/new` → `session/prompt` → fresh-process `session/load`

Asserts `protocolVersion: 1`, `loadSession`, `authMethods` (`api-key`, `chat-gpt`), a usable `sessionId`, prompt `end_turn`, and Resume replay chunks. Needs a local Codex login (ChatGPT / API key). Does **not** replace Mac UI Connect/Ask/Resume clicks.

```bash
npm run smoke:codex-acp
# optional: CODEX_ACP_SMOKE_SKIP_PROMPT=1 npm run smoke:codex-acp
```


### Claude ACP headless Connect/Ask/Resume (Mac)

Spawns the same argv as `ClaudeBackend` (`claude-agent-acp` if on `PATH`, else `npx -y @agentclientprotocol/claude-agent-acp`), then over stdio NDJSON runs:

`initialize` → `session/new` → `session/prompt` → fresh-process `session/load`

Needs a local Claude Code login (Pro/Max) or `ANTHROPIC_API_KEY`. Does **not** replace Mac UI Connect/Ask/Resume clicks.

```bash
npm run smoke:claude-acp
# optional: CLAUDE_ACP_SMOKE_SKIP_PROMPT=1 npm run smoke:claude-acp
```

### Copilot ACP headless Connect/Ask/Resume (Mac)

Spawns the same argv as `CopilotBackend` (`copilot --acp`), then over stdio NDJSON runs:

`initialize` → `session/new` → `session/prompt` → fresh-process `session/load` (when `loadSession` is advertised)

Needs a local GitHub Copilot CLI install + GitHub login. Does **not** replace Mac UI Connect/Ask/Resume clicks.

```bash
npm run smoke:copilot-acp
# optional: COPILOT_ACP_SMOKE_SKIP_PROMPT=1 npm run smoke:copilot-acp
```

### Fake ACP agent (permission smoke)

Grok may not emit `session/request_permission` for every prompt. For a deterministic allow/deny path:

```bash
# From repo root (Cargo workspace)
cargo test -p fake-acp-agent
cargo test -p acp-desktop
npx tsc --noEmit
npm test

# One-command Tauri UI smoke (builds fake agent, sets ACP_DESKTOP_FAKE_AGENT=1)
npm run tauri:fake
```

GitHub Actions (`.github/workflows/ci.yml`) runs the same `cargo test` + `tsc` + `vitest` checks on push/PR.

In the app, use the **Dev: fake ACP agent** toggle (same process-env override; not persisted). Then: Pick folder → Connect → Send any prompt → inline permission card Allow/Reject (keys: **a**/**Enter** Allow, **r** Reject, **Esc** Cancel; toolbar Cancel also clears a pending Ask) → Disconnect → **Resume** (expect `fake-agent: resumed` replay; prompt still asks permission).

Acceptance fixtures in the fake agent: send `fake:usage-limit` for a quota error,
`fake:deny-report` for an explicit refusal message, or `fake:parallel` for two
permission requests issued before either decision. Starting the fake binary with
`--stale-session` creates a session that is deliberately unavailable on Resume.
`--list-sessions` advertises a two-page session list (including a foreign-workspace
entry that the host must reject); `--list-error` advertises listing but fails the
request so app-known fallback can be checked. `--session-info` reports two commands
and 2,048 / 8,192 context tokens on new/load; send `fake:clear-session-info` to
replace the command list with an empty list and update usage to 4,096 tokens.
`--config-options` returns Model/Mode/Reasoning selectors on new/load; Fast is
accepted, Rejected model fails with synthetic error data, and Slow model delays
its response for five seconds to exercise Disconnect. `fake:config-update` sends
a live mode update, while `fake:clear-config` removes all configuration controls.
`--unsupported-protocol` replies with version 2 to verify rejection before any
session operation. This client explicitly requests ACP v1; other negotiated
versions close the connection with guidance to use a v1-compatible agent.
These fixtures do not call a vendor API or perform the proposed tool actions.
For conversation rendering, `fake:stream` emits thought/reply chunks and
`fake:long-stream` emits 180 lines over several seconds for scroll testing.
`fake:markdown` streams headings, lists, code and unsafe-content samples;
`fake:tool` previews input, locations, updates and a diff after an Ask decision
without writing a file. Set `ACP_DESKTOP_FAKE_RICH_REPLAY=1` when launching the
app to include the Markdown fixture in fake Resume replay. The fake-agent
toggle is under the collapsed **Developer tools** panel below the conversation.

Env alternatives:

```bash
cargo build -p fake-acp-agent
ACP_DESKTOP_FAKE_AGENT=1 npm run tauri dev
# or: ACP_DESKTOP_AGENT_CMD="$(pwd)/target/debug/fake-acp-agent" npm run tauri dev
```

`ACP_DESKTOP_FAKE_AGENT=1` resolves `target/debug/fake-acp-agent` from the workspace when the binary is not on PATH. Default for users remains `grok agent stdio`.


## Custom ACP agents

Open **Agents → Custom agents → Add custom agent** while disconnected. Set a
name, an absolute executable path (spaces need no quoting) or a command on PATH,
an argument array such as `["--acp", "--label", "My agent"]`, and optional
non-secret environment overrides such as `{"PROFILE": "local"}`. Every argument
is passed literally; there is no shell expansion, interpolation or command-line
splitting. Only launch executables you trust.

Profiles are stored in `custom-agents.json` in the app's configuration directory
as plain text, with generated stable IDs. Editing a profile retains its ID and
session catalog. Distinct profiles, including profiles using the same executable,
have separate app metadata from each other and the built-in agents. Removing a
profile does not delete vendor conversations or app session metadata; creating a
replacement assigns a new ID. Vendor storage remains authoritative, so two
profiles aimed at the same vendor storage may still discover the same vendor IDs.

Keep secrets out of both arguments and environment overrides. Credential-like
environment names are rejected, but arbitrary values cannot be classified as
secret automatically. Existing CLI login and the app's inherited environment
remain available; the app does not provide a credential store. Overrides affect
only the child process. Custom-agent connection/prompt diagnostics retain recovery
phases without exposing raw subprocess errors. Agent-authored conversation and
tool content still belong to the agent and can contain information it chooses to
report.

Custom profiles use ACP v1 and the same permission, Resume, discovery and reported
configuration UI as built-ins. Missing capabilities keep the existing fallbacks.
The developer fake/CMD overrides apply only to built-in selections; a custom
profile always launches its own executable. The older `ACP_DESKTOP_AGENT_CMD`
development override splits on whitespace; use a custom profile for paths or
arguments with spaces.

## macOS builds and beta preparation

The **macOS artifacts** workflow prepares audited Apple Silicon `.app.zip` candidates
with checksums and build manifests. These are ad-hoc signed, not notarized, and
not yet certified by a fresh-user installation check. It does not publish a
Release. See [packaging and candidate verification](docs/PACKAGING.md).

Build a local `.app` / `.dmg` without bundling vendor CLIs:

```bash
npm ci
npm run tauri:build:macos
```

Artifacts: `target/release/bundle/macos/` and `.../dmg/`. Signing & notarization stay optional (set `APPLE_SIGNING_IDENTITY` when you have a Developer ID cert). Details: [docs/PACKAGING.md](docs/PACKAGING.md).

## Roadmap

Scope and acceptance evidence live in the [GitHub Project](https://github.com/users/Andy115951/projects/2)
and public milestone issues. [M9](https://github.com/Andy115951/acp-desktop/issues/32),
[M10](https://github.com/Andy115951/acp-desktop/issues/33) and
[M11](https://github.com/Andy115951/acp-desktop/issues/34) are complete.
[M12](https://github.com/Andy115951/acp-desktop/issues/35) covers the first public
beta and contribution readiness; its installation/publication gates remain open.

## Tech notes

- Protocol: **ACP v1 (stable)**, local stdio subprocess only
- Shell: **Tauri 2** + **React** (Vite, TypeScript, Tailwind, Zustand)
- ACP client: official Rust crate [`agent-client-protocol`](https://crates.io/crates/agent-client-protocol)
- Layout: single repo (`src/` frontend + `src-tauri/` backend)
- Agents: built-in table + user-defined command/args (no ACP Registry in v1)
- Preferences: `tauri-plugin-store` (last folder / selected agent / `ui.locale` / per-agent session metadata); no local transcript database
- First agent: **Grok Build** via `grok agent stdio`

### Verification and distribution limits

Real-agent and platform claims are bounded by the [compatibility matrix](docs/COMPATIBILITY.md).
Claude's real Ask/Resume acceptance remains externally blocked. Candidate
installation, final beta versioning and publication are still pending. Signing,
notarization and auto-update are not claimed by the ad-hoc candidate pipeline.

## Non-goals

- Shipping or bundling vendor binaries / official logos
- Default YOLO / auto-approve everything
- PTY-wrapping a TUI that has no ACP
- Forking third-party vendor desktop shells as the mainline
- Unified account or unified cross-vendor session format
- Collecting tokens

## License

MIT. See [LICENSE](LICENSE).
