/** Tiny UI locale dictionary (no i18next). Chrome strings only. */

export type Locale = "en" | "zh-CN";

/** prefs.json key: UI chrome locale. */
export const PREFS_KEY_UI_LOCALE = "ui.locale";

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALES: readonly Locale[] = ["en", "zh-CN"] as const;

/** Message keys used by App / PermissionCard chrome. */
export type MessageKey =
  | "navigation.newConversation" | "navigation.newHelp" | "navigation.cancelConnection"
  | "navigation.placeholderDraft" | "navigation.firstSend" | "navigation.connectingDraft"
  | "connection.connectNew" | "connection.connectResume" | "connection.connecting"
  | "connection.chooseWorkspace" | "connection.checking" | "connection.missingAgent"
  | "connection.finishEditing" | "connection.readySaved" | "connection.ready"
  | "connection.newHelp" | "connection.resumeHelp" | "connection.firstDownload"
  | "connection.steps" | "connection.chooseAgent" | "connection.startConversation"
  | "theme.label" | "theme.system" | "theme.light" | "theme.dark"
  | "layout.workspace"
  | "layout.historyHelp"
  | "layout.sidebar"
  | "layout.hideSidebar"
  | "layout.showSidebar"
  | "layout.agentSettings"
  | "layout.sessionDetails"
  | "layout.noWorkspace"
  | "layout.awaitingPermission"
  | "layout.configuring"
  | "layout.working"
  | "layout.readyTitle"
  | "layout.welcomeTitle"
  | "layout.readyDescription"
  | "layout.welcomeDescription"
  | "layout.sessionOptions"
  | "layout.configFailed"

  | "custom.title"
  | "custom.help"
  | "custom.disconnect"
  | "custom.failed"
  | "custom.edit"
  | "custom.remove"
  | "custom.removeHelp"
  | "custom.confirmRemove"
  | "custom.cancel"
  | "custom.add"
  | "custom.name"
  | "custom.executable"
  | "custom.args"
  | "custom.argsHelp"
  | "custom.env"
  | "custom.save"

  | "config.title"
  | "config.unknown"
  | "config.empty"
  | "config.unsupported"
  | "config.valueUnknown"
  | "config.failed"
  | "agentInfo.title"
  | "agentInfo.context"
  | "agentInfo.contextUnknown"
  | "agentInfo.commandsUnknown"
  | "agentInfo.commandsEmpty"
  | "agentInfo.commands"
  | "agentInfo.insert"
  | "agentInfo.insertHelp"
  | "badge.acpClient"
  | "header.taglineBefore"
  | "header.taglineAfter"
  | "language.label"
  | "agents.title"
  | "agents.switch"
  | "agents.refresh"
  | "agents.checking"
  | "agents.later"
  | "agents.selected"
  | "agents.available"
  | "agents.missing"
  | "agents.missingSuffix"
  | "agents.npxFallback"
  | "dev.title"
  | "dev.blurbBefore"
  | "dev.blurbAfter"
  | "dev.useFake"
  | "dev.mode"
  | "dev.cmd"
  | "dev.binary"
  | "dev.binaryMissing"
  | "session.fakeTitle"
  | "session.agentTitle"
  | "workspace.recent"
  | "workspace.empty"
  | "workspace.choose"
  | "workspace.failed"
  | "history.rename"
  | "history.archive"
  | "history.archiveHelp"
  | "history.title"
  | "history.save"
  | "history.cancel"
  | "history.archived"
  | "history.restore"
  | "history.restoreNamed"
  | "history.unavailable"
  | "history.label"
  | "history.choose"
  | "history.empty"
  | "history.appKnown"
  | "history.discovered"
  | "history.listUnsupported"
  | "history.listIncomplete"
  | "history.disconnect"
  | "history.failed"
  | "session.pickFolder"
  | "session.resume"
  | "session.newSession"
  | "session.connect"
  | "session.disconnect"
  | "session.clear"
  | "session.cwd"
  | "session.session"
  | "session.saved"
  | "session.connected"
  | "session.idle"
  | "session.loadUnsupported"
  | "session.loadOk"
  | "session.resumeDisabledBefore"
  | "session.resumeDisabledAfter"
  | "session.transcriptEmpty"
  | "session.placeholderConnectedFake"
  | "session.placeholderConnected"
  | "session.placeholderIdle"
  | "session.send"
  | "session.cancel"
  | "session.cancelTitleAsk"
  | "session.cancelTitleBusy"
  | "session.resumeTitleBusy"
  | "session.resumeTitleUnsupported"
  | "session.resumeTitleId"
  | "permission.ariaLabel"
  | "permission.cancel"
  | "permission.hotkeys"
  | "auth.codex"
  | "auth.claude"
  | "auth.copilot"
  | "error.details"
  | "error.general"
  | "error.usageLimit"
  | "error.staleSession" | "error.draftConflict"
  | "error.connection"
  | "error.auth"
  | "error.workspace"
  | "error.noSavedSession"
  | "error.resumeUnsupported"
  | "error.startup"
  | "chat.you"
  | "chat.agent"
  | "chat.thinking"
  | "chat.tool"
  | "chat.plan"
  | "chat.status"
  | "chat.newSession"
  | "chat.resuming"
  | "chat.resumed"
  | "chat.turnEnded"
  | "chat.transcript"
  | "chat.latest"
  | "chat.message"
  | "chat.draftWhileWorking"
  | "chat.composerHelp"
  | "header.description"
  | "chat.copy"
  | "chat.copyCode"
  | "chat.copied"
  | "chat.copyFailed"
  | "chat.code"
  | "chat.image"
  | "error.handshake"
  | "error.timeout"
  | "error.network"
  | "error.session"
  | "error.permission"
  | "tool.pending"
  | "tool.running"
  | "tool.completed"
  | "tool.failed"
  | "tool.cancelled"
  | "tool.allowed"
  | "tool.rejected"
  | "tool.input"
  | "tool.output"
  | "tool.diff"
  | "tool.before"
  | "tool.after"
  | "tool.terminal";

type Dictionary = Record<MessageKey, string>;

const en: Dictionary = {
  "navigation.newConversation": "New conversation",
  "navigation.newHelp": "Open an editable draft. Connect when ready or send the first message to connect automatically.",
  "navigation.cancelConnection": "Cancel connection",
  "navigation.placeholderDraft": "Write a message…",
  "navigation.firstSend": "Send connects your selected agent and conversation. Your draft stays here if connection fails.",
  "navigation.connectingDraft": "Connecting… Editing this draft keeps it for you to send after connecting.",
  "connection.connectNew": "Connect & start new",
  "connection.connectResume": "Connect & resume",
  "connection.connecting": "Connecting…",
  "connection.chooseWorkspace": "Choose a workspace folder, then connect your agent.",
  "connection.checking": "Checking installed agents…",
  "connection.missingAgent": "{name} was not found locally. Open Agents & settings to check its setup or choose another installed agent.",
  "connection.finishEditing": "Finish updating the workspace or agent settings before connecting.",
  "connection.readySaved": "Connect & resume continues the selected saved conversation. New conversation opens a separate draft and keeps earlier conversations in history.",
  "connection.ready": "Ready to connect to {name}. Your agent uses its existing CLI login.",
  "connection.newHelp": "Connect to the selected agent and start a new conversation. Earlier sessions stay in history.",
  "connection.resumeHelp": "Connect to the selected agent and restore the selected saved conversation.",
  "connection.firstDownload": "The first connection may download an adapter and take a little longer.",
  "connection.steps": "Connection setup",
  "connection.chooseAgent": "Choose an installed agent",
  "connection.startConversation": "Connect and send when ready",
  "theme.label": "Theme",
  "theme.system": "System",
  "theme.light": "Light",
  "theme.dark": "Dark",
  "layout.workspace": "Workspace",
  "layout.historyHelp": "About session history",
  "layout.sidebar": "Workspace and conversations",
  "layout.hideSidebar": "Hide sidebar",
  "layout.showSidebar": "Show sidebar",
  "layout.agentSettings": "Agents & settings",
  "layout.sessionDetails": "Session details",
  "layout.noWorkspace": "No workspace selected",
  "layout.awaitingPermission": "Waiting for your approval",
  "layout.configuring": "Updating configuration…",
  "layout.working": "Working…",
  "layout.readyTitle": "What shall we work on?",
  "layout.welcomeTitle": "A space to build.",
  "layout.readyDescription": "Send a message to {name}. Your conversation stays with your agent.",
  "layout.welcomeDescription": "Choose a workspace and agent, then write your first message.",
  "layout.sessionOptions": "Session options & commands",
  "layout.configFailed": "Update failed",

  "custom.title": "Custom agents",
  "custom.help": "Launch a trusted local ACP executable. Profiles are stored as plain text. Use non-secret arguments and environment values only; keep authentication in the CLI’s existing login or inherited environment.",
  "custom.disconnect": "Disconnect before editing custom agents.",
  "custom.failed": "Could not save or load this profile. Check the fields and retry. Arguments must be a JSON array of strings; environment must be a JSON object of strings.",
  "custom.edit": "Edit",
  "custom.remove": "Remove",
  "custom.removeHelp": "Remove this launch profile? Vendor conversations and app session metadata will be retained. A new profile gets a new ID.",
  "custom.confirmRemove": "Remove profile",
  "custom.cancel": "Cancel",
  "custom.add": "Add custom agent",
  "custom.name": "Name",
  "custom.executable": "Executable path or command",
  "custom.args": "Arguments (JSON array)",
  "custom.argsHelp": "Example: [\"--acp\", \"--label\", \"My agent\"]. Each string is one argument. Do not add shell quotes around the executable; no shell expansion is performed.",
  "custom.env": "Non-secret environment overrides (JSON object)",
  "custom.save": "Save profile",

  "header.description": "Conversations with your local coding agents.",
  "chat.copy": "Copy message",
  "chat.copyCode": "Copy code",
  "chat.copied": "Copied",
  "chat.copyFailed": "Copy failed — select text to copy",
  "chat.code": "Code",
  "chat.image": "Image",
  "error.handshake": "The agent started but ACP initialization failed. Check its adapter version and protocol support.",
  "error.timeout": "The agent did not respond in time. Check its startup, network and adapter configuration, then reconnect.",
  "error.network": "The agent could not reach its server. Check the CLI endpoint, proxy and network, then reconnect.",
  "error.session": "The agent initialized but could not create a session. Check the workspace and CLI diagnostics, then reconnect.",
  "error.permission": "The tool permission could not be submitted. Review technical details and retry the decision.",
  "tool.pending": "Pending",
  "tool.running": "Running",
  "tool.completed": "Completed",
  "tool.failed": "Failed",
  "tool.cancelled": "Cancelled",
  "tool.allowed": "Permission allowed",
  "tool.rejected": "Permission denied",
  "tool.input": "Input",
  "tool.output": "Output",
  "tool.diff": "File change",
  "tool.before": "Before",
  "tool.after": "After",
  "tool.terminal": "Terminal reference",
  "chat.you": "You",
  "chat.agent": "Assistant",
  "chat.thinking": "Thinking",
  "chat.tool": "Tool",
  "chat.plan": "Plan",
  "chat.status": "Status",
  "chat.newSession": "New session",
  "chat.resuming": "Restoring conversation…",
  "chat.resumed": "Conversation restored",
  "chat.turnEnded": "Turn ended · {reason}",
  "chat.transcript": "Conversation",
  "chat.latest": "Jump to latest",
  "chat.message": "Message",
  "chat.draftWhileWorking": "Keep writing your next message. Send it when the current reply or action finishes.",
  "chat.composerHelp": "Enter to send · Shift+Enter for a new line",
  "error.details": "Technical details",
  "error.general": "The request could not be completed. Open technical details for diagnostics, then retry.",
  "error.usageLimit": "The agent reached its usage or rate limit. Check its usage and retry later.",
  "error.draftConflict": "A separate New conversation draft is waiting. Copy this failed Resume message somewhere safe, then clear the input and choose New conversation to restore that draft.",
  "error.staleSession": "The saved session is missing or expired. Its Resume entry was cleared; choose another saved session or start a new one.",
  "error.connection": "The connection could not be verified. Check the CLI's certificate and network configuration.",
  "error.auth": "The agent could not authenticate. Check its local CLI login or API configuration, then reconnect.",
  "error.workspace": "Pick a workspace folder before connecting.",
  "error.noSavedSession": "No saved session is available for this folder. Start a new session.",
  "error.resumeUnsupported": "This agent does not support restoring sessions. Start a new session.",
  "error.startup": "The agent could not start. Check its executable, adapter and PATH, then reconnect.",
  "badge.acpClient": "ACP client",
  "header.taglineBefore":
    "ACP host path: last folder restores on launch; switch Grok / Codex / Claude / Copilot in the Agents list (histories stay per-vendor). Connect via host APIs, stream a turn, approve tools with Ask, resume via ",
  "header.taglineAfter": ".",
  "language.label": "Language",
  "agents.title": "Agents",
  "agents.switch": "Switch",
  "agents.refresh": "Refresh",
  "agents.checking": "Checking…",
  "agents.later": "later",
  "agents.selected": "selected",
  "agents.available": "available",
  "agents.missing": "missing",
  "agents.missingSuffix": " (missing)",
  "agents.npxFallback":
    "{cli} on PATH; Connect spawns via npx (@agentclientprotocol/{adapter}). Install `{adapter}` globally to skip the download.",
  "dev.title": "Developer tools",
  "dev.blurbBefore": "Deterministic ",
  "dev.blurbAfter":
    " for permission-card E2E (process env only; not persisted).",
  "dev.useFake": "Use fake agent",
  "dev.mode": "mode",
  "dev.cmd": "cmd",
  "dev.binary": "binary",
  "dev.binaryMissing": "binary missing (cargo build -p fake-acp-agent)",
  "session.fakeTitle": "Fake agent session",
  "session.agentTitle": "{name} session",
  "workspace.recent": "Recent workspaces",
  "workspace.empty": "No recent workspaces",
  "workspace.choose": "Choose a workspace",
  "workspace.failed": "Workspace shortcuts could not be loaded or saved. Pick a folder to continue; check local storage before relaunching.",
  "history.rename": "Rename",
  "history.archive": "Archive app entry",
  "history.archiveHelp": "Archiving hides this app entry. Your agent’s conversation history stays intact, and you can restore the entry here.",
  "history.title": "Session title",
  "history.save": "Save title",
  "history.cancel": "Cancel rename",
  "history.archived": "Archived sessions ({count})",
  "history.restore": "Restore",
  "history.restoreNamed": "Restore {name}",
  "history.unavailable": "Unavailable",
  "history.label": "Saved sessions",
  "history.choose": "Choose a session",
  "history.empty": "No saved sessions for this workspace",
  "config.title": "Session configuration",
  "config.unknown": "This agent has not reported configuration options.",
  "config.empty": "This agent reports no configuration options.",
  "config.unsupported": "This control type is not supported by this client.",
  "config.valueUnknown": "Current value not reported",
  "config.failed": "The agent rejected the update or did not respond. Showing the last reported values; you can retry.",
  "agentInfo.title": "Agent session information",
  "agentInfo.context": "Agent-reported context: {used} / {size} tokens",
  "agentInfo.contextUnknown": "Context usage has not been reported by this agent.",
  "agentInfo.commandsUnknown": "Commands have not been reported by this agent.",
  "agentInfo.commandsEmpty": "This agent reports no available commands.",
  "agentInfo.commands": "Agent commands ({count})",
  "agentInfo.insert": "Insert /{name}",
  "agentInfo.insertHelp": "Insert a command before your draft, add any arguments, then send when ready.",
  "history.appKnown": "Sessions known to this app for the selected agent and workspace. Connect refreshes discovery when supported. Conversation history is restored by the agent when you Resume.",
  "history.discovered": "Sessions discovered from your agent and known to this app for this workspace. Disconnect to choose one, then Resume its conversation.",
  "history.listUnsupported": "This agent does not advertise session listing. Showing sessions known to this app for this agent and workspace.",
  "history.listIncomplete": "Some agent sessions could not be retrieved or saved. App-known and retrieved entries remain available; the conversation can continue.",
  "history.disconnect": "Finish the current action before changing the workspace or conversation.",
  "history.failed": "Session metadata could not be loaded or saved. Your agent’s conversation history is unchanged; check local storage and try again.",
  "session.pickFolder": "Pick folder",
  "session.resume": "Resume",
  "session.newSession": "New session",
  "session.connect": "Connect",
  "session.disconnect": "Disconnect",
  "session.clear": "Clear",
  "session.cwd": "cwd",
  "session.session": "session",
  "session.saved": "saved",
  "session.connected": "connected",
  "session.idle": "Not connected",
  "session.loadUnsupported": "loadSession unsupported",
  "session.loadOk": "loadSession ok",
  "session.resumeDisabledBefore":
    "Resume disabled: agent did not advertise ",
  "session.resumeDisabledAfter": ". Choose New conversation.",
  "session.transcriptEmpty": "Transcript appears here…",
  "session.placeholderConnectedFake": "Message fake agent…",
  "session.placeholderConnected": "Message {name}…",
  "session.placeholderIdle": "Connect first",
  "session.send": "Send",
  "session.cancel": "Cancel",
  "session.cancelTitleAsk": "Cancel prompt and clear pending Ask",
  "session.cancelTitleBusy": "Cancel in-flight prompt",
  "session.resumeTitleBusy": "Busy…",
  "session.resumeTitleUnsupported": "Agent does not advertise loadSession",
  "session.resumeTitleId": "Resume session {id}",
  "permission.ariaLabel": "Permission request",
  "permission.cancel": "Cancel",
  "permission.hotkeys":
    "Keys: a/Enter Allow · r Reject · Esc Cancel",
  "auth.codex":
    "Codex uses your local CLI auth: ChatGPT login via `codex`, or `CODEX_API_KEY` / `OPENAI_API_KEY`. ACP adapter: `codex-acp` or `npx -y @agentclientprotocol/codex-acp`.",
  "auth.claude":
    "Claude uses your local CLI auth: Claude Code login (Pro/Max), or `ANTHROPIC_API_KEY`. ACP adapter: `claude-agent-acp` or `npx -y @agentclientprotocol/claude-agent-acp`.",
  "auth.copilot":
    "Copilot uses your local CLI auth: GitHub login via `copilot`. ACP: `copilot --acp` (stdio; public preview). No separate npx adapter.",
};

const zhCN: Dictionary = {
  "navigation.newConversation": "新建对话",
  "navigation.newHelp": "打开可编辑的草稿，准备好后可先连接，或直接发送首条消息自动连接。",
  "navigation.cancelConnection": "取消连接",
  "navigation.placeholderDraft": "写一条消息…",
  "navigation.firstSend": "发送时会连接所选智能体和对话；连接失败时，草稿会保留在这里。",
  "navigation.connectingDraft": "正在连接… 此时修改草稿，将保留到连接完成后由你手动发送。",
  "connection.connectNew": "连接并新建",
  "connection.connectResume": "连接并恢复",
  "connection.connecting": "正在连接…",
  "connection.chooseWorkspace": "先选择工作区文件夹，再连接智能体。",
  "connection.checking": "正在检测本机智能体…",
  "connection.missingAgent": "未在本机找到 {name}。打开「智能体与设置」检查配置，或选择其他已安装的智能体。",
  "connection.finishEditing": "请先完成工作区或智能体设置，再连接。",
  "connection.readySaved": "「连接并恢复」继续选中的历史对话；「新建对话」打开独立草稿，原有会话仍保留在历史中。",
  "connection.ready": "已准备好连接 {name}，将沿用该智能体已有的 CLI 登录配置。",
  "connection.newHelp": "连接所选智能体并开始新对话，原有会话仍保留在历史中。",
  "connection.resumeHelp": "连接所选智能体并恢复当前选中的历史对话。",
  "connection.firstDownload": "首次连接可能需要下载适配器，因此会稍慢一些。",
  "connection.steps": "连接准备",
  "connection.chooseAgent": "选择已安装的智能体",
  "connection.startConversation": "准备好后，连接并发送",
  "theme.label": "主题",
  "theme.system": "跟随系统",
  "theme.light": "浅色",
  "theme.dark": "深色",
  "layout.workspace": "工作区",
  "layout.historyHelp": "会话记录说明",
  "layout.sidebar": "工作区与对话",
  "layout.hideSidebar": "收起侧栏",
  "layout.showSidebar": "展开侧栏",
  "layout.agentSettings": "智能体与设置",
  "layout.sessionDetails": "会话详情",
  "layout.noWorkspace": "尚未选择工作区",
  "layout.awaitingPermission": "等待你的授权",
  "layout.configuring": "正在更新配置…",
  "layout.working": "正在处理…",
  "layout.readyTitle": "我们来做点什么？",
  "layout.welcomeTitle": "从这里开始创造。",
  "layout.readyDescription": "向 {name} 发送消息，对话仍由你的智能体保存。",
  "layout.welcomeDescription": "选择工作区与智能体，写下你的第一条消息。",
  "layout.sessionOptions": "会话选项与命令",
  "layout.configFailed": "更新失败",

  "custom.title": "自定义智能体",
  "custom.help": "启动可信的本地 ACP 程序。配置以明文保存，仅填写非秘密参数和环境变量；登录凭据继续由 CLI 登录或继承的环境提供。",
  "custom.disconnect": "请先断开连接再编辑自定义智能体。",
  "custom.failed": "无法保存或读取配置，请检查后重试。参数必须为 JSON 字符串数组，环境变量必须为 JSON 字符串对象。",
  "custom.edit": "编辑",
  "custom.remove": "移除",
  "custom.removeHelp": "移除此启动配置？厂商会话与应用会话元数据将保留。新建配置会获得新的 ID。",
  "custom.confirmRemove": "移除配置",
  "custom.cancel": "取消",
  "custom.add": "添加自定义智能体",
  "custom.name": "名称",
  "custom.executable": "可执行文件路径或命令名",
  "custom.args": "参数（JSON 数组）",
  "custom.argsHelp": "例如：[\"--acp\", \"--label\", \"My agent\"]。每个字符串是一个参数。路径无需添加 shell 引号，不进行 shell 展开。",
  "custom.env": "非秘密环境覆盖（JSON 对象）",
  "custom.save": "保存配置",

  "header.description": "与本机编程智能体展开对话。",
  "chat.copy": "复制消息",
  "chat.copyCode": "复制代码",
  "chat.copied": "已复制",
  "chat.copyFailed": "复制失败，请选择文本复制",
  "chat.code": "代码",
  "chat.image": "图片",
  "error.handshake": "智能体已启动，但 ACP 初始化失败。请检查适配器版本及协议支持。",
  "error.timeout": "智能体响应超时。请检查启动、网络及适配器配置，然后重新连接。",
  "error.network": "智能体无法连接服务器。请检查 CLI 服务地址、代理及网络，然后重新连接。",
  "error.session": "智能体已初始化，但无法创建会话。请检查工作文件夹及 CLI 诊断信息，然后重新连接。",
  "error.permission": "无法提交工具权限选择。请查看技术详情后重试。",
  "tool.pending": "等待执行",
  "tool.running": "执行中",
  "tool.completed": "已完成",
  "tool.failed": "失败",
  "tool.cancelled": "已取消",
  "tool.allowed": "已允许执行",
  "tool.rejected": "已拒绝执行",
  "tool.input": "输入",
  "tool.output": "输出",
  "tool.diff": "文件变更",
  "tool.before": "修改前",
  "tool.after": "修改后",
  "tool.terminal": "终端引用",
  "chat.you": "你",
  "chat.agent": "助手",
  "chat.thinking": "思考过程",
  "chat.tool": "工具",
  "chat.plan": "计划",
  "chat.status": "状态",
  "chat.newSession": "新会话",
  "chat.resuming": "正在恢复对话…",
  "chat.resumed": "对话已恢复",
  "chat.turnEnded": "本轮结束 · {reason}",
  "chat.transcript": "对话",
  "chat.latest": "跳到最新消息",
  "chat.message": "消息",
  "chat.draftWhileWorking": "可以继续准备下一条消息，当前回复或操作结束后再发送。",
  "chat.composerHelp": "Enter 发送 · Shift+Enter 换行",
  "error.details": "技术详情",
  "error.general": "请求未能完成。可展开技术详情查看诊断信息，然后重试。",
  "error.usageLimit": "智能体已达到用量或请求频率上限。请检查用量，稍后重试。",
  "error.draftConflict": "另有一份新对话草稿。请先复制保存本次恢复失败的消息，再清空输入并选择新建对话，取回原来的新对话草稿。",
  "error.staleSession": "已保存的会话缺失或已过期，恢复记录已清除。可选择其他已保存会话或新建会话。",
  "error.connection": "无法验证连接。请检查本机 CLI 的证书和网络配置。",
  "error.auth": "智能体认证失败。请检查本机 CLI 的登录状态或 API 配置，然后重新连接。",
  "error.workspace": "请先选择工作文件夹，再连接智能体。",
  "error.noSavedSession": "此文件夹没有可恢复的会话，请新建会话。",
  "error.resumeUnsupported": "此智能体不支持恢复会话，请新建会话。",
  "error.startup": "智能体启动失败。请检查可执行文件、适配器及 PATH，然后重新连接。",
  "badge.acpClient": "ACP 客户端",
  "header.taglineBefore":
    "ACP 宿主：启动时恢复上次文件夹；在 Agents 列表切换 Grok / Codex / Claude / Copilot（各家历史互不混用）。通过宿主 API 连接、流式一轮、Ask 审批工具，并用 ",
  "header.taglineAfter": " 恢复会话。",
  "language.label": "语言",
  "agents.title": "Agents",
  "agents.switch": "切换",
  "agents.refresh": "刷新",
  "agents.checking": "检测中…",
  "agents.later": "稍后",
  "agents.selected": "已选",
  "agents.available": "可用",
  "agents.missing": "未找到",
  "agents.missingSuffix": "（未找到）",
  "agents.npxFallback":
    "已在 PATH 中找到 {cli}；连接时通过 npx 启动 @agentclientprotocol/{adapter}。可全局安装 `{adapter}` 以跳过下载。",
  "dev.title": "开发工具",
  "dev.blurbBefore": "确定性 ",
  "dev.blurbAfter":
    "，用于权限卡片 E2E（仅进程环境变量；不持久化）。",
  "dev.useFake": "使用假 agent",
  "dev.mode": "模式",
  "dev.cmd": "命令",
  "dev.binary": "二进制",
  "dev.binaryMissing": "二进制缺失（cargo build -p fake-acp-agent）",
  "session.fakeTitle": "假 agent 会话",
  "session.agentTitle": "{name} 会话",
  "workspace.recent": "最近工作区",
  "workspace.empty": "暂无最近工作区",
  "workspace.choose": "选择工作区",
  "workspace.failed": "无法读取或保存工作区快捷记录。可选择文件夹继续；重新启动前请检查本地存储。",
  "history.rename": "重命名",
  "history.archive": "归档应用记录",
  "history.archiveHelp": "归档仅隐藏本应用中的记录，智能体的对话历史会保留，可在此恢复记录。",
  "history.title": "会话标题",
  "history.save": "保存标题",
  "history.cancel": "取消重命名",
  "history.archived": "已归档会话（{count}）",
  "history.restore": "恢复记录",
  "history.restoreNamed": "恢复记录 {name}",
  "history.unavailable": "不可用",
  "history.label": "已保存的会话",
  "history.choose": "选择会话",
  "history.empty": "此工作区暂无保存的会话",
  "config.title": "会话配置",
  "config.unknown": "此智能体尚未报告配置选项。",
  "config.empty": "此智能体报告当前没有配置选项。",
  "config.unsupported": "本客户端暂不支持此控件类型。",
  "config.valueUnknown": "尚未报告当前值",
  "config.failed": "智能体拒绝了修改或未响应，当前显示最近报告的值，可重试。",
  "agentInfo.title": "智能体会话信息",
  "agentInfo.context": "智能体报告的上下文：{used} / {size} tokens",
  "agentInfo.contextUnknown": "此智能体尚未报告上下文用量。",
  "agentInfo.commandsUnknown": "此智能体尚未报告命令。",
  "agentInfo.commandsEmpty": "此智能体报告当前没有可用命令。",
  "agentInfo.commands": "智能体命令（{count}）",
  "agentInfo.insert": "插入 /{name}",
  "agentInfo.insertHelp": "将命令插入草稿前，补充参数后再发送。",
  "history.appKnown": "仅列出本应用已知的当前智能体、当前工作区会话；连接时按智能体支持的能力发现更多会话，恢复时由智能体加载对话历史。",
  "history.discovered": "列出智能体发现及本应用已知的当前工作区会话。断开后选择会话，再恢复对话。",
  "history.listUnsupported": "此智能体未声明会话列表能力，仅显示本应用已知的当前智能体、当前工作区会话。",
  "history.listIncomplete": "部分智能体会话无法获取或保存，已知及已获取的会话仍可用，可继续当前对话。",
  "history.disconnect": "请等待当前操作结束，再更换工作区或对话。",
  "history.failed": "无法读取或保存会话元数据。智能体的对话历史未改变；请检查本地存储后重试。",
  "session.pickFolder": "选择文件夹",
  "session.resume": "恢复",
  "session.newSession": "新会话",
  "session.connect": "连接",
  "session.disconnect": "断开",
  "session.clear": "清空",
  "session.cwd": "cwd",
  "session.session": "会话",
  "session.saved": "已保存",
  "session.connected": "已连接",
  "session.idle": "未连接",
  "session.loadUnsupported": "不支持 loadSession",
  "session.loadOk": "loadSession 可用",
  "session.resumeDisabledBefore": "无法恢复：agent 未声明 ",
  "session.resumeDisabledAfter": "。请使用「新会话」。",
  "session.transcriptEmpty": "对话记录将显示在这里…",
  "session.placeholderConnectedFake": "给假 agent 发消息…",
  "session.placeholderConnected": "给 {name} 发消息…",
  "session.placeholderIdle": "请先连接",
  "session.send": "发送",
  "session.cancel": "取消",
  "session.cancelTitleAsk": "取消提示并清除待处理 Ask",
  "session.cancelTitleBusy": "取消进行中的提示",
  "session.resumeTitleBusy": "忙碌中…",
  "session.resumeTitleUnsupported": "Agent 未声明 loadSession",
  "session.resumeTitleId": "恢复会话 {id}",
  "permission.ariaLabel": "权限请求",
  "permission.cancel": "取消",
  "permission.hotkeys":
    "快捷键：a/Enter 允许 · r 拒绝 · Esc 取消",
  "auth.codex":
    "Codex 使用本机 CLI 登录：经 `codex` 的 ChatGPT 登录，或 `CODEX_API_KEY` / `OPENAI_API_KEY`。ACP 适配：`codex-acp` 或 `npx -y @agentclientprotocol/codex-acp`。",
  "auth.claude":
    "Claude 使用本机 CLI 登录：Claude Code（Pro/Max），或 `ANTHROPIC_API_KEY`。ACP 适配：`claude-agent-acp` 或 `npx -y @agentclientprotocol/claude-agent-acp`。",
  "auth.copilot":
    "Copilot 使用本机 CLI 登录：经 `copilot` 的 GitHub 登录。ACP：`copilot --acp`（stdio；公开预览）。无需单独的 npx 适配包。",
};

export const messages: Record<Locale, Dictionary> = {
  en,
  "zh-CN": zhCN,
};

/** Coerce unknown prefs value to a supported Locale (default en). */
export function parseLocale(value: unknown): Locale {
  if (value === "zh-CN" || value === "en") return value;
  if (typeof value === "string") {
    const v = value.trim();
    if (v === "zh-CN" || v === "zh_CN" || v === "zh") return "zh-CN";
    if (v === "en" || v === "en-US") return "en";
  }
  return DEFAULT_LOCALE;
}

/**
 * Look up a chrome string. Unknown keys fall back to the key itself;
 * missing locale falls back to English.
 */
export function t(
  locale: Locale,
  key: MessageKey,
  vars?: Record<string, string>,
): string {
  const dict = messages[locale] ?? messages[DEFAULT_LOCALE];
  let text = dict[key] ?? messages[DEFAULT_LOCALE][key] ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.split(`{${name}}`).join(value);
    }
  }
  return text;
}

/** Every MessageKey present in both locale dictionaries. */
export function dictionaryKeys(): MessageKey[] {
  return Object.keys(en) as MessageKey[];
}
