# acp-desktop

Unofficial desktop **ACP client**: one window, switch the local coding-agent CLIs you already installed (Grok Build, Codex, Claude Code, and others that speak ACP).

**Not affiliated with, endorsed by, or a product of xAI, OpenAI, Anthropic, or any other vendor.**  
Their names and marks belong to them. This repo does not ship vendor CLIs, installers, or credentials.

各家 CLI 你自己装、自己登录。本应用只拉起它们的 ACP stdio（例如 `grok agent stdio`、`codex-acp`、`claude-agent-acp`）。会话仍在各家自己的目录里，能和原 TUI 接着聊。改文件、跑命令默认要你点头。

## Status

Scaffold only. No app yet.

## Planned

- Detect which CLIs are on `PATH`; missing ones stay grey
- Switch agent in one window; histories do not mix
- Streaming chat + permission cards (allow / deny)
- macOS first
- Small client, not an IDE clone

Will not: redistribute binaries, use official logos, default to YOLO, PTY-wrap a TUI that has no ACP.

## License

MIT. See [LICENSE](LICENSE).
