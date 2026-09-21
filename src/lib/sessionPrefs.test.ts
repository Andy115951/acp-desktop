import { describe, expect, it } from "vitest";
import { isSessionLoadFailedError } from "./sessionPrefs";

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
