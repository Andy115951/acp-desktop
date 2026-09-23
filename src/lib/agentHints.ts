/** Pure UI hints for vendor auth / install (unit-tested; no Tauri). */

import { t, type Locale } from "./i18n";

/**
 * Short Agents-panel note for the selected connectable agent.
 * Returns null when no hint is needed (or fake-agent override is on).
 */
export function agentAuthHint(
  agentId: string,
  usingFake: boolean,
  locale: Locale = "en",
): string | null {
  if (usingFake) return null;
  switch (agentId.trim()) {
    case "codex":
      return t(locale, "auth.codex");
    case "claude":
      return t(locale, "auth.claude");
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
