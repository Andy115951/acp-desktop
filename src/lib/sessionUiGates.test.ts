import { describe, expect, it } from "vitest";
import {
  canCancelPrompt,
  canConnectNewSession,
  canResumeSession,
  canSendPrompt,
  draftEnterShouldSend,
  type SessionUiGates,
} from "./sessionUiGates";

const base: SessionUiGates = {
  cwd: "/tmp/ws",
  connected: false,
  busy: false,
  permissionOpen: false,
  draftTrimmed: true,
  savedSessionId: "fake-session-1",
  loadSessionSupported: true,
  canConnectAgent: true,
};

describe("canResumeSession", () => {
  it("allows Disconnect→Resume when prefs + loadSession ok", () => {
    expect(canResumeSession(base)).toBe(true);
  });

  it("allows Resume when loadSessionSupported is still unknown", () => {
    expect(canResumeSession({ ...base, loadSessionSupported: null })).toBe(
      true,
    );
  });

  it("blocks when agent omitted loadSession", () => {
    expect(
      canResumeSession({ ...base, loadSessionSupported: false }),
    ).toBe(false);
  });

  it("blocks without saved id, cwd, agent, or while connected", () => {
    expect(canResumeSession({ ...base, savedSessionId: null })).toBe(false);
    expect(canResumeSession({ ...base, cwd: null })).toBe(false);
    expect(canResumeSession({ ...base, canConnectAgent: false })).toBe(false);
    expect(canResumeSession({ ...base, connected: true })).toBe(false);
  });

  it("blocks while busy (parity with Connect; no Disconnect→Resume race)", () => {
    expect(canResumeSession({ ...base, busy: true })).toBe(false);
  });
});

describe("canConnectNewSession", () => {
  it("requires cwd + agent and idle", () => {
    expect(canConnectNewSession(base)).toBe(true);
    expect(canConnectNewSession({ ...base, busy: true })).toBe(false);
    expect(canConnectNewSession({ ...base, connected: true })).toBe(false);
    expect(canConnectNewSession({ ...base, cwd: null })).toBe(false);
  });
});

describe("canSendPrompt / canCancelPrompt", () => {
  const connected: SessionUiGates = { ...base, connected: true };

  it("Send blocked while Ask open (permission owns the turn)", () => {
    expect(canSendPrompt(connected)).toBe(true);
    expect(canSendPrompt({ ...connected, permissionOpen: true })).toBe(false);
    expect(canSendPrompt({ ...connected, busy: true })).toBe(false);
    expect(canSendPrompt({ ...connected, draftTrimmed: false })).toBe(false);
  });

  it("Cancel enabled while busy or Ask open", () => {
    expect(canCancelPrompt(connected)).toBe(false);
    expect(canCancelPrompt({ ...connected, busy: true })).toBe(true);
    expect(canCancelPrompt({ ...connected, permissionOpen: true })).toBe(true);
    expect(
      canCancelPrompt({
        ...connected,
        busy: true,
        permissionOpen: true,
      }),
    ).toBe(true);
  });
});

describe("draftEnterShouldSend", () => {
  it("Enter sends when Ask closed; ignored while Ask open", () => {
    expect(draftEnterShouldSend(false, "Enter", false)).toBe(true);
    expect(draftEnterShouldSend(true, "Enter", false)).toBe(false);
    expect(draftEnterShouldSend(false, "Enter", true)).toBe(false);
    expect(draftEnterShouldSend(false, "a", false)).toBe(false);
  });
});
