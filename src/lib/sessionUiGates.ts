/** Pure UI enablement gates for Connect / Resume / Send / Cancel (unit-tested). */

export type SessionUiGates = {
  cwd: string | null;
  connected: boolean;
  busy: boolean;
  /** True when an Ask permission modal is open. */
  permissionOpen: boolean;
  draftTrimmed: boolean;
  savedSessionId: string | null;
  /** null = unknown (still allow Resume; host will decide). */
  loadSessionSupported: boolean | null;
  canConnectAgent: boolean;
};

/** Resume button: saved id + cwd + agent, idle, loadSession not known-false. */
export function canResumeSession(g: SessionUiGates): boolean {
  return (
    !!g.savedSessionId &&
    g.loadSessionSupported !== false &&
    !!g.cwd &&
    !g.connected &&
    !g.busy &&
    g.canConnectAgent
  );
}

/** New session / Connect when idle. Busy blocks double-clicks. */
export function canConnectNewSession(g: SessionUiGates): boolean {
  return !!g.cwd && g.canConnectAgent && !g.busy && !g.connected;
}

/** Send / draft Enter: blocked while Ask is open or busy. */
export function canSendPrompt(g: SessionUiGates): boolean {
  return g.connected && !g.busy && !g.permissionOpen && g.draftTrimmed;
}

/** Toolbar Cancel: enabled while prompt busy OR Ask is open. */
export function canCancelPrompt(g: SessionUiGates): boolean {
  return g.connected && (g.busy || g.permissionOpen);
}

/**
 * Whether draft-field Enter should invoke send.
 * While Ask is open, window hotkeys own Enter — never submit a new prompt.
 */
export function draftEnterShouldSend(
  permissionOpen: boolean,
  key: string,
  shiftKey: boolean,
): boolean {
  if (permissionOpen) return false;
  return key === "Enter" && !shiftKey;
}

/**
 * Connect enablement for the selected built-in agent.
 * Fake/custom override may Connect even when PATH detect is false
 * (Linux `tauri:fake` Switch→Codex while both CLIs are missing).
 */
export function canConnectSelectedAgent(
  connectable: boolean | undefined,
  available: boolean | undefined,
  usingFake: boolean,
): boolean {
  return !!connectable && (!!available || usingFake);
}
