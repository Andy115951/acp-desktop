/** Pure helpers for agent switcher / per-vendor Resume (unit-tested; no Tauri). */

import {
  PREFS_KEY_SESSION_BY_CWD,
  sessionPrefsKey,
  type SessionByCwd,
} from "./sessionPrefs";

export type ConnectableAgent = {
  id: string;
  connectable: boolean;
};

/**
 * Live ACP session must tear down before the host spawns a different vendor.
 * Busy covers in-flight connect/prompt so we never stack backends.
 */
export function shouldDisconnectOnAgentSwitch(
  connected: boolean,
  busy: boolean,
): boolean {
  return connected || busy;
}

/**
 * Session store fields reset when the user switches agents.
 * `savedSessionId` comes from that vendor’s map only (caller supplies it).
 */
export function sessionPatchAfterAgentSwitch(
  savedSessionId: string | null,
): {
  savedSessionId: string | null;
  sessionId: null;
  loadSessionSupported: null;
  lines: [];
  error: null;
  permission: null;
} {
  return {
    savedSessionId,
    sessionId: null,
    loadSessionSupported: null,
    lines: [],
    error: null,
    permission: null,
  };
}

/**
 * Look up Resume id for `agentId`+`cwd` from per-vendor maps.
 * Never reads another vendor’s key — Grok may fall back to legacy
 * `grok.sessionByCwd` only when its per-agent map is empty.
 */
export function resumeIdForAgent(
  agentId: string,
  cwd: string,
  getMap: (key: string) => SessionByCwd | null | undefined,
): string | null {
  const key = sessionPrefsKey(agentId);
  let map = getMap(key) ?? {};
  if (
    Object.keys(map).length === 0 &&
    agentId === "grok" &&
    key !== PREFS_KEY_SESSION_BY_CWD
  ) {
    map = getMap(PREFS_KEY_SESSION_BY_CWD) ?? {};
  }
  return map[cwd] ?? null;
}

/**
 * Hydrate selection after detect: prefer saved id if still connectable,
 * else first connectable agent, else fallback.
 */
export function pickConnectableAgentId(
  agents: ConnectableAgent[],
  preferredId: string | null | undefined,
  fallback = "grok",
): string {
  const preferred =
    typeof preferredId === "string" && preferredId.trim()
      ? preferredId.trim()
      : fallback;
  const connectable =
    agents.find((a) => a.id === preferred && a.connectable) ??
    agents.find((a) => a.connectable);
  return connectable?.id ?? fallback;
}

/**
 * Matches `selectAgent`: block known non-connectable placeholders;
 * allow unknown ids (empty list / race) so selection is not stuck.
 */
export function canSelectAgentId(
  agents: ConnectableAgent[],
  id: string,
): boolean {
  const agent = agents.find((a) => a.id === id);
  if (agent && !agent.connectable) return false;
  return true;
}
