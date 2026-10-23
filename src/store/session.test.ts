import { beforeEach, describe, expect, it, vi } from "vitest";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import { useSessionStore, type PermissionRequest } from "./session";

const permission: PermissionRequest = { requestId: 1, title: "Test", detail: "", tool: { id: "tool-1" }, options: [{ id: "allow", name: "Allow", kind: "AllowOnce" }] };

describe("permission decision races", () => {
  beforeEach(() => {
    invoke.mockReset();
    useSessionStore.setState({ permission, connected: true, sessionId: "same-id", lines: [{ id: "tool-row", kind: "tool_call", text: "Test", tool: { id: "tool-1" } }] });
  });
  it("retains a newer pending request when the previous decision resolves", async () => {
    let finish!: () => void;
    invoke.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const sending = useSessionStore.getState().respondPermission("allow");
    const newer = { ...permission, requestId: 2, tool: { id: "tool-2" } };
    useSessionStore.setState({ permission: newer });
    finish(); await sending;
    expect(useSessionStore.getState().permission).toBe(newer);
    expect(useSessionStore.getState().lines[0].tool?.decision).toBe("allowed");
  });
  it("ignores an old decision after disconnect even when a new session reuses IDs", async () => {
    let finish!: () => void;
    invoke.mockImplementation((command) => command === "respond_permission" ? new Promise<void>((resolve) => { finish = resolve; }) : Promise.resolve());
    const sending = useSessionStore.getState().respondPermission("allow");
    await useSessionStore.getState().disconnect();
    const newer = { ...permission };
    const lines = [{ id: "new-row", kind: "tool_call", text: "Test", tool: { id: "tool-1" } }];
    useSessionStore.setState({ permission: newer, connected: true, sessionId: "same-id", lines });
    finish(); await sending;
    expect(useSessionStore.getState().permission).toBe(newer);
    expect(useSessionStore.getState().lines).toBe(lines);
  });
  it("does not append an old turn result to a replacement connection", async () => {
    let finish!: (reason: string) => void;
    invoke.mockImplementation((command) => command === "send_prompt" ? new Promise<string>((resolve) => { finish = resolve; }) : Promise.resolve());
    useSessionStore.setState({ permission: null, busy: false, draft: "hello" });
    const sending = useSessionStore.getState().send();
    await useSessionStore.getState().disconnect();
    const lines = [{ id: "replacement", kind: "status", text: "New session" }];
    useSessionStore.setState({ connected: true, busy: true, lines });
    finish("EndTurn"); await sending;
    expect(useSessionStore.getState().lines).toBe(lines);
    expect(useSessionStore.getState().busy).toBe(true);
  });
});
