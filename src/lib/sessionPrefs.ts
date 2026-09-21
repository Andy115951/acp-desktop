/** Pure helpers for session prefs / resume UX (unit-tested; no Tauri). */

/** Host error from a failed `session/load` (corrupt / unknown saved id). */
export function isSessionLoadFailedError(message: string): boolean {
  return /session\/load failed/i.test(message);
}
