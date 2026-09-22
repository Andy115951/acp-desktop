/** Pure helpers for session prefs / resume UX (unit-tested; no Tauri). */

/** prefs.json key: last successfully picked workspace folder. */
export const PREFS_KEY_LAST_CWD = "lastCwd";

/** prefs.json key: last selected agent id (grok / codex / …). */
export const PREFS_KEY_SELECTED_AGENT = "selectedAgentId";

/**
 * Grok per-vendor map key (M2+). Same string as `sessionPrefsKey("grok")` —
 * kept as a named constant for tests and call sites that mean “Grok’s map”.
 */
export const PREFS_KEY_SESSION_BY_CWD = "grok.sessionByCwd";

export type SessionByCwd = Record<string, string>;

/** Per-vendor prefs key so Resume never mixes Grok/Codex session ids. */
export function sessionPrefsKey(agentId: string): string {
  const id = agentId.trim() || "grok";
  return `${id}.sessionByCwd`;
}

/**
 * Host / agent errors that mean the saved Resume id is dead
 * (`session/load` not-found, FS_NOT_FOUND, unknown id, …).
 */
export function isSessionLoadFailedError(message: string): boolean {
  const text = message ?? "";
  if (/session\/load\s*failed/i.test(text)) return true;
  // Raw ACP / filesystem codes sometimes surface without the host prefix
  // (invoke wrap, agent stderr leak, or status race). Treat as stale Resume.
  if (/FS_NOT_FOUND/i.test(text)) return true;
  if (/ENOENT/i.test(text) && /session/i.test(text)) return true;
  if (/no such session/i.test(text)) return true;
  if (/no such file/i.test(text) && /session/i.test(text)) return true;
  if (/unknown (session )?id/i.test(text)) return true;
  if (/session\s+(not found|missing|does not exist|expired)/i.test(text)) {
    return true;
  }
  if (/missing session/i.test(text)) return true;
  return false;
}

/** Clear UI message when Resume id is gone — points user to Connect. */
export const STALE_RESUME_USER_MESSAGE =
  "Saved session is no longer available (missing or expired). Resume was cleared — use Connect (New session).";

/**
 * Prefer a recoverable Connect hint over raw FS_NOT_FOUND / ACP codes when
 * the error is a stale `session/load`. Unrelated errors pass through.
 */
export function recoverableSessionLoadMessage(raw: string): string {
  if (!isSessionLoadFailedError(raw)) return raw;
  // Keep host prefix so logs / matchers still see session/load failed.
  if (/session\/load\s*failed/i.test(raw)) {
    return `${STALE_RESUME_USER_MESSAGE} (was: ${raw.split("\n")[0]})`;
  }
  return `${STALE_RESUME_USER_MESSAGE} (was: ${raw.split("\n")[0]})`;
}

/**
 * Only persist cwd→sessionId after handshake completes.
 * Emitting `session_id` while Resume is still loading (`busy`) must NOT
 * re-write prefs — that raced clear-on-load-failure and restored dead ids.
 */
export function shouldPersistConnectedSessionId(opts: {
  connected: boolean;
  sessionId: string | null | undefined;
  busy: boolean;
  error?: string | null;
}): boolean {
  return (
    !!opts.connected &&
    !!opts.sessionId &&
    !opts.busy &&
    !opts.error
  );
}

/**
 * True when `value` looks like an absolute workspace path string.
 * Does not touch the filesystem — restore may still fail later at connect.
 */
export function isPlausibleCwd(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const path = value.trim();
  if (path.length < 2) return false;
  // Reject NUL / control chars that would never be a real folder path.
  if (/[\0-\x1f]/.test(path)) return false;
  // Unix absolute
  if (path.startsWith("/")) return true;
  // Windows drive absolute (C:\ or C:/)
  if (/^[A-Za-z]:[\\/]/.test(path)) return true;
  // Windows UNC
  if (path.startsWith("\\\\")) return true;
  return false;
}

/** Immutable upsert into the cwd→sessionId map. */
export function upsertSessionByCwd(
  map: SessionByCwd,
  cwd: string,
  sessionId: string,
): SessionByCwd {
  return { ...map, [cwd]: sessionId };
}

/** Immutable delete; returns same reference if key was absent. */
export function removeSessionByCwd(
  map: SessionByCwd,
  cwd: string,
): SessionByCwd {
  if (!(cwd in map)) return map;
  const next = { ...map };
  delete next[cwd];
  return next;
}
