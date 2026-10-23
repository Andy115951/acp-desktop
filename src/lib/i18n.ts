/** Tiny UI locale dictionary (no i18next). Chrome strings only. */

export type Locale = "en" | "zh-CN";

/** prefs.json key: UI chrome locale. */
export const PREFS_KEY_UI_LOCALE = "ui.locale";

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALES: readonly Locale[] = ["en", "zh-CN"] as const;

/** Message keys used by App / PermissionCard chrome. */
export type MessageKey =
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
  | "history.label"
  | "history.choose"
  | "history.empty"
  | "history.appKnown"
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
  | "error.staleSession"
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
  "chat.composerHelp": "Enter to send · Shift+Enter for a new line",
  "error.details": "Technical details",
  "error.general": "The request could not be completed. Open technical details for diagnostics, then retry.",
  "error.usageLimit": "The agent reached its usage or rate limit. Check its usage and retry later.",
  "error.staleSession": "The saved session is missing or expired. Its Resume entry was cleared; start a new session.",
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
  "history.label": "Saved sessions",
  "history.choose": "Choose a session",
  "history.empty": "No saved sessions for this workspace",
  "history.appKnown": "Sessions known to this app for the selected agent and workspace. Conversation history is restored by the agent when you Resume.",
  "history.disconnect": "Disconnect before changing the workspace or saved session.",
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
  "session.idle": "idle",
  "session.loadUnsupported": "loadSession unsupported",
  "session.loadOk": "loadSession ok",
  "session.resumeDisabledBefore":
    "Resume disabled: agent did not advertise ",
  "session.resumeDisabledAfter": ". Use New session.",
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
  "chat.composerHelp": "Enter 发送 · Shift+Enter 换行",
  "error.details": "技术详情",
  "error.general": "请求未能完成。可展开技术详情查看诊断信息，然后重试。",
  "error.usageLimit": "智能体已达到用量或请求频率上限。请检查用量，稍后重试。",
  "error.staleSession": "已保存的会话缺失或已过期，恢复记录已清除。请新建会话。",
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
  "history.label": "已保存的会话",
  "history.choose": "选择会话",
  "history.empty": "此工作区暂无保存的会话",
  "history.appKnown": "仅列出本应用已知的当前智能体、当前工作区会话；恢复时由智能体加载对话历史。",
  "history.disconnect": "更换工作区或已保存的会话前，请先断开连接。",
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
  "session.idle": "空闲",
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
