/** Pure UI hints for vendor auth / install (unit-tested; no Tauri). */

/**
 * Short Agents-panel note for the selected connectable agent.
 * Returns null when no hint is needed (or fake-agent override is on).
 */
export function agentAuthHint(
  agentId: string,
  usingFake: boolean,
): string | null {
  if (usingFake) return null;
  switch (agentId.trim()) {
    case "codex":
      return (
        "Codex uses your local CLI auth: ChatGPT login via `codex`, or " +
        "`CODEX_API_KEY` / `OPENAI_API_KEY`. ACP adapter: `codex-acp` or " +
        "`npx -y @agentclientprotocol/codex-acp`."
      );
    case "claude":
      return (
        "Claude uses your local CLI auth: Claude Code login (Pro/Max), or " +
        "`ANTHROPIC_API_KEY`. ACP adapter: `claude-agent-acp` or " +
        "`npx -y @agentclientprotocol/claude-agent-acp`."
      );
    default:
      return null;
  }
}

/**
 * Extra note when host reports a vendor available only via CLI (npx spawn).
 * Prefer showing `AgentInfo.detail` from the host when present.
 */
export function agentNpxFallbackHint(detail: string | null | undefined): string | null {
  if (!detail) return null;
  const lower = detail.toLowerCase();
  if (
    lower.includes("npx") &&
    (lower.includes("codex") || lower.includes("claude"))
  ) {
    return detail;
  }
  return null;
}

/** @deprecated Use {@link agentNpxFallbackHint} */
export function agentCodexNpxFallbackHint(
  detail: string | null | undefined,
): string | null {
  return agentNpxFallbackHint(detail);
}

