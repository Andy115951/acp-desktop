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
  | "auth.copilot";

type Dictionary = Record<MessageKey, string>;

const en: Dictionary = {
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
  "dev.title": "Dev: fake ACP agent",
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
  "dev.title": "开发：假 ACP agent",
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
