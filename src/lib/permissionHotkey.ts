/** Pure helpers for the Ask permission modal (unit-tested; no Tauri). */

export type PermissionOption = { id: string; name: string; kind: string };

export type PermissionHotkeyAction =
  | { type: "allow"; optionId: string }
  | { type: "reject"; optionId: string }
  | { type: "cancel" };

/**
 * Map a keyboard event key to an Ask action.
 * a / Enter → first Allow* option (else options[0]); r → first Reject*; Esc → Cancel.
 */
export function permissionHotkeyAction(
  key: string,
  options: PermissionOption[],
): PermissionHotkeyAction | null {
  if (key === "Escape") {
    return { type: "cancel" };
  }
  const lower = key.length === 1 ? key.toLowerCase() : key;
  if (lower === "a" || key === "Enter") {
    const allow =
      options.find((o) => o.kind.startsWith("Allow")) ?? options[0];
    return allow ? { type: "allow", optionId: allow.id } : null;
  }
  if (lower === "r") {
    const reject = options.find((o) => o.kind.startsWith("Reject"));
    return reject ? { type: "reject", optionId: reject.id } : null;
  }
  return null;
}

/** Whether the host error means Ask was already cleared (Cancel / Disconnect). */
export function isNoPendingPermissionError(message: string): boolean {
  return /no pending permission/i.test(message);
}

/**
 * Stale respond_permission id: host kept the real Ask oneshot.
 * Do not dismiss the modal and do not surface a red error banner.
 */
export function isStalePermissionError(message: string): boolean {
  return /stale permission request id/i.test(message);
}

/** Host errors that should not leave a scary banner over an open Ask. */
export function isQuietPermissionHostError(message: string): boolean {
  return (
    isNoPendingPermissionError(message) || isStalePermissionError(message)
  );
}

/** Drop open Ask when host reports disconnected (agent exit / Disconnect). */
export function shouldDismissAskOnDisconnect(connected: boolean): boolean {
  return !connected;
}

