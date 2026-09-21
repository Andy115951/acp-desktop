import { describe, expect, it } from "vitest";
import {
  PREFS_KEY_LAST_CWD,
  PREFS_KEY_SELECTED_AGENT,
  PREFS_KEY_SESSION_BY_CWD,
  isPlausibleCwd,
  isSessionLoadFailedError,
  removeSessionByCwd,
  sessionPrefsKey,
  upsertSessionByCwd,
} from "./sessionPrefs";

describe("prefs keys", () => {
  it("exports stable store key names", () => {
    expect(PREFS_KEY_SESSION_BY_CWD).toBe("grok.sessionByCwd");
    expect(PREFS_KEY_LAST_CWD).toBe("lastCwd");
    expect(PREFS_KEY_SELECTED_AGENT).toBe("selectedAgentId");
  });

  it("scopes session maps per agent id", () => {
    expect(sessionPrefsKey("grok")).toBe("grok.sessionByCwd");
    expect(sessionPrefsKey("codex")).toBe("codex.sessionByCwd");
    expect(sessionPrefsKey("  ")).toBe("grok.sessionByCwd");
  });
});

describe("isSessionLoadFailedError", () => {
  it("matches host session/load failure text", () => {
    expect(
      isSessionLoadFailedError(
        "session/load failed: invalid params. You can start a New session.",
      ),
    ).toBe(true);
  });

  it("is case-insensitive on the path", () => {
    expect(isSessionLoadFailedError("Session/Load Failed: boom")).toBe(true);
  });

  it("ignores unrelated errors", () => {
    expect(isSessionLoadFailedError("grok not found on PATH")).toBe(false);
    expect(isSessionLoadFailedError("no pending permission request")).toBe(
      false,
    );
  });
});

describe("isPlausibleCwd", () => {
  it("accepts Unix absolute paths", () => {
    expect(isPlausibleCwd("/Users/apple/Documents/code")).toBe(true);
    expect(isPlausibleCwd("/tmp")).toBe(true);
  });

  it("accepts Windows drive and UNC paths", () => {
    expect(isPlausibleCwd("C:\\Users\\me\\proj")).toBe(true);
    expect(isPlausibleCwd("D:/work/repo")).toBe(true);
    expect(isPlausibleCwd("\\\\server\\share")).toBe(true);
  });

  it("rejects relative, empty, and non-strings", () => {
    expect(isPlausibleCwd("")).toBe(false);
    expect(isPlausibleCwd("   ")).toBe(false);
    expect(isPlausibleCwd(".")).toBe(false);
    expect(isPlausibleCwd("relative/path")).toBe(false);
    expect(isPlausibleCwd(null)).toBe(false);
    expect(isPlausibleCwd(42)).toBe(false);
    expect(isPlausibleCwd("/")).toBe(false); // length < 2 after trim edge: "/" is length 1
  });

  it("rejects control characters", () => {
    expect(isPlausibleCwd("/tmp/\0evil")).toBe(false);
  });
});

describe("sessionByCwd map helpers", () => {
  it("upserts without mutating the original", () => {
    const prev = { "/a": "s1" };
    const next = upsertSessionByCwd(prev, "/b", "s2");
    expect(next).toEqual({ "/a": "s1", "/b": "s2" });
    expect(prev).toEqual({ "/a": "s1" });
  });

  it("overwrites an existing cwd entry", () => {
    expect(upsertSessionByCwd({ "/a": "old" }, "/a", "new")).toEqual({
      "/a": "new",
    });
  });

  it("removes a key immutably; no-op when absent", () => {
    const prev = { "/a": "s1", "/b": "s2" };
    const next = removeSessionByCwd(prev, "/a");
    expect(next).toEqual({ "/b": "s2" });
    expect(prev).toEqual({ "/a": "s1", "/b": "s2" });
    expect(removeSessionByCwd(prev, "/missing")).toBe(prev);
  });
});
