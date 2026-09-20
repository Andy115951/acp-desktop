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

## Status

Scaffold only. Docs + license. No app code yet.

## Roadmap

1. **Grok path** — detect `grok` → ACP handshake → one streaming turn → permission cards → pick folder / resume session
2. **AgentBackend** — abstract the transport so a second CLI can plug in
3. **Multi-agent switch** — add one of Codex or Claude; switcher UI
4. **macOS packaging** — after the above works

## Tech notes

- Protocol: **ACP v1 (stable)**, local stdio subprocess only
- Shell: lean **Electron** first (familiar, faster to prove the protocol); revisit Tauri later if size/native feel matters
- Client SDK: `@agentclientprotocol/sdk` while on Electron

### Still open

- Electron vs Tauri longer term
- Second agent: Codex vs Claude Code
- Switcher UI: top dropdown vs left list

## Non-goals

- Shipping or bundling vendor binaries / official logos
- Default YOLO / auto-approve everything
- PTY-wrapping a TUI that has no ACP
- Forking third-party vendor desktop shells as the mainline
- Unified account or unified cross-vendor session format
- Collecting tokens

## License

MIT. See [LICENSE](LICENSE).
