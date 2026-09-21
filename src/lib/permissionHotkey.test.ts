import { describe, expect, it } from "vitest";
import {
  isNoPendingPermissionError,
  isQuietPermissionHostError,
  isStalePermissionError,
  permissionHotkeyAction,
} from "./permissionHotkey";

const OPTIONS = [
  { id: "allow", name: "Allow once", kind: "AllowOnce" },
  { id: "reject", name: "Reject once", kind: "RejectOnce" },
];

describe("permissionHotkeyAction", () => {
  it("a and Enter select Allow", () => {
    expect(permissionHotkeyAction("a", OPTIONS)).toEqual({
      type: "allow",
      optionId: "allow",
    });
    expect(permissionHotkeyAction("A", OPTIONS)).toEqual({
      type: "allow",
      optionId: "allow",
    });
    expect(permissionHotkeyAction("Enter", OPTIONS)).toEqual({
      type: "allow",
      optionId: "allow",
    });
  });

  it("r selects Reject", () => {
    expect(permissionHotkeyAction("r", OPTIONS)).toEqual({
      type: "reject",
      optionId: "reject",
    });
    expect(permissionHotkeyAction("R", OPTIONS)).toEqual({
      type: "reject",
      optionId: "reject",
    });
  });

  it("Escape cancels", () => {
    expect(permissionHotkeyAction("Escape", OPTIONS)).toEqual({
      type: "cancel",
    });
  });

  it("falls back to options[0] when no Allow* kind", () => {
    const only = [{ id: "x", name: "X", kind: "Other" }];
    expect(permissionHotkeyAction("Enter", only)).toEqual({
      type: "allow",
      optionId: "x",
    });
  });

  it("returns null for unknown keys or empty options", () => {
    expect(permissionHotkeyAction("x", OPTIONS)).toBeNull();
    expect(permissionHotkeyAction("Enter", [])).toBeNull();
    expect(permissionHotkeyAction("r", [])).toBeNull();
  });
});

describe("permission host error helpers", () => {
  it("matches host no-pending strings", () => {
    expect(isNoPendingPermissionError("no pending permission request")).toBe(
      true,
    );
    expect(isNoPendingPermissionError("No Pending Permission")).toBe(true);
    expect(isNoPendingPermissionError("stale permission request id")).toBe(
      false,
    );
  });

  it("matches stale id without treating it as no-pending", () => {
    expect(isStalePermissionError("stale permission request id")).toBe(true);
    expect(isStalePermissionError("no pending permission request")).toBe(
      false,
    );
  });

  it("quiet helper covers both race outcomes", () => {
    expect(isQuietPermissionHostError("no pending permission request")).toBe(
      true,
    );
    expect(isQuietPermissionHostError("stale permission request id")).toBe(
      true,
    );
    expect(isQuietPermissionHostError("permission responder gone")).toBe(
      false,
    );
  });
});
