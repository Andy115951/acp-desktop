/** Pure helpers for session prefs / resume UX (unit-tested; no Tauri). */

/** prefs.json key: cwd → vendor sessionId map (Grok path). */
export const PREFS_KEY_SESSION_BY_CWD = "grok.sessionByCwd";

/** prefs.json key: last successfully picked workspace folder. */
export const PREFS_KEY_LAST_CWD = "lastCwd";

export type SessionByCwd = Record<string, string>;

/** Host error from a failed `session/load` (corrupt / unknown saved id). */
export function isSessionLoadFailedError(message: string): boolean {
  return /session\/load failed/i.test(message);
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
