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
    default:
      return null;
  }
}

/**
 * Extra note when host reports Codex available only via `codex` (npx spawn).
 * Prefer showing `AgentInfo.detail` from the host when present.
 */
export function agentCodexNpxFallbackHint(detail: string | null | undefined): string | null {
  if (!detail) return null;
  const lower = detail.toLowerCase();
  if (lower.includes("npx") && lower.includes("codex")) return detail;
  return null;
}

