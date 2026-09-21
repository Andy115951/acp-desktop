# acp-desktop

Unofficial desktop **ACP client**: one window to switch the local coding-agent CLIs you already installed (Grok Build, Codex, Claude Code, and others that speak ACP).

**Not affiliated with, endorsed by, or a product of xAI, OpenAI, Anthropic, or any other vendor.** Their names and marks belong to them. This repo does not ship vendor CLIs, installers, or credentials.

各家 CLI 你自己装、自己登录。本应用只拉起它们的 ACP stdio（例如 `grok agent stdio`、`codex-acp`、`claude-agent-acp`）。会话仍在各家自己的目录里，能和原 TUI 接着聊。改文件、跑命令默认要你点头。

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
| Copilot CLI | `copilot --acp` (preview) — later |
| Anything without ACP | out of scope |

## Architecture

```text
React (Vite)  --Tauri IPC-->  Rust host (Tauri 2)
                                 |
                                 |  agent-client-protocol (ACP v1)
                                 v
                           grok agent stdio   (later: Codex / Claude adapters)
```

- UI never talks to the CLI directly; the Rust host owns spawn, handshake, streaming, and permission replies.
- Vendor session files stay in each CLI’s own directories; this app does not re-store chat history.
- See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for `AgentBackend`, event flow, and defaults.

## Status

M1 is on `main`. **M2 (Grok ACP path)** is in progress on [`feat/m2-grok-acp`](https://github.com/Andy115951/acp-desktop/pull/8): `initialize` → `session/new` | `session/load` → streaming `session/update` → Ask permission cards → Resume/New session UI. Preferences store only cwd→sessionId (no chat history).

Protocol smoke against a local logged-in `grok agent stdio` (Mac): streaming turn + `session/load` resume both OK (`loadSession: true`). Full in-app UI E2E (especially permission allow/deny cards) still needed before closing [#3](https://github.com/Andy115951/acp-desktop/issues/3).

Plan board: [acp-desktop project](https://github.com/users/Andy115951/projects/2) (issues #2–#6).

## Develop

Prerequisites: [Node.js](https://nodejs.org/), [Rust](https://rustup.rs/), and OS webview deps ([Tauri prerequisites](https://tauri.app/start/prerequisites/) — on macOS that means Xcode CLT / WebKit).

```bash
npm install
npm run tauri dev
```

## Roadmap

1. **Tauri skeleton + Grok detect** — empty window, Vite/React UI, PATH check for `grok`
2. **Grok ACP path** — handshake → one streaming turn → permission cards → pick folder / resume session
3. **AgentBackend** — abstract the transport so a second CLI can plug in
4. **Multi-agent switch** — add one of Codex or Claude; switcher UI
5. **macOS packaging** — after the above works

## Tech notes

- Protocol: **ACP v1 (stable)**, local stdio subprocess only
- Shell: **Tauri 2** + **React** (Vite, TypeScript, Tailwind, Zustand)
- ACP client: official Rust crate [`agent-client-protocol`](https://crates.io/crates/agent-client-protocol)
- Layout: single repo (`src/` frontend + `src-tauri/` backend)
- Agents: built-in table + user-defined command/args (no ACP Registry in v1)
- Preferences: `tauri-plugin-store` (last folder / selected agent); no local session DB
- First agent: **Grok Build** via `grok agent stdio`

### Still open

- Second agent: Codex vs Claude Code
- Switcher UI: top dropdown vs left list
- Permission card: modal vs inline in the chat thread

## Non-goals

- Shipping or bundling vendor binaries / official logos
- Default YOLO / auto-approve everything
- PTY-wrapping a TUI that has no ACP
- Forking third-party vendor desktop shells as the mainline
- Unified account or unified cross-vendor session format
- Collecting tokens

## License

MIT. See [LICENSE](LICENSE).
