import { beforeEach, describe, expect, it, vi } from "vitest";
import { readSessionCatalog, rememberSession } from "../lib/sessionCatalog";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(), open: vi.fn(), load: vi.fn(), save: vi.fn(), invalidate: vi.fn(),
  get: vi.fn(), set: vi.fn(), persist: vi.fn(), handlers: new Map<string, (event: { payload: unknown }) => void>(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));
vi.mock("@tauri-apps/plugin-store", () => ({ Store: { load: async () => ({ get: mocks.get, set: mocks.set, save: mocks.persist }) } }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async (name: string, handler: (event: { payload: unknown }) => void) => {
  mocks.handlers.set(name, handler); return () => mocks.handlers.delete(name);
} }));
vi.mock("./sessionRepository", () => ({ loadSessionCatalog: mocks.load, saveKnownSession: mocks.save, markSessionUnavailable: mocks.invalidate }));
import { useAgentsStore } from "./agents";
import { useSessionStore } from "./session";

const catalog = rememberSession(readSessionCatalog(null, { "/workspace": "first" }), "/workspace", "second", 10);
const flush = async () => { await new Promise((resolve) => setTimeout(resolve, 0)); };

beforeEach(async () => {
  await useSessionStore.getState().disconnect();
  vi.clearAllMocks();
  mocks.handlers.clear();
  mocks.invoke.mockResolvedValue(undefined);
  mocks.load.mockResolvedValue(catalog);
  mocks.save.mockResolvedValue(catalog);
  mocks.invalidate.mockResolvedValue(catalog);
  mocks.get.mockResolvedValue("/workspace");
  mocks.set.mockResolvedValue(undefined);
  mocks.persist.mockResolvedValue(undefined);
  useAgentsStore.setState({ selectedAgentId: "codex" });
  useSessionStore.setState({ cwd: "/workspace", catalog, connected: false, busy: false, switching: false,
    catalogError: false, permission: null, savedSessionId: "second", sessionId: null, error: null, loadSessionSupported: null,
    lines: [{ id: "old", kind: "agent_message", text: "old transcript" }], draft: "old draft" });
});

describe("app-known session selection", () => {
  it("resumes the selected ID and discards the previous transcript/draft", async () => {
    useSessionStore.getState().selectSavedSession("first");
    expect(useSessionStore.getState().lines).toEqual([]);
    expect(useSessionStore.getState().draft).toBe("");
    await useSessionStore.getState().connect("resume");
    expect(mocks.invoke).toHaveBeenCalledWith("connect_agent", { agentId: "codex", cwd: "/workspace", resumeSessionId: "first" });
  });
  it.each([{ connected: true }, { busy: true }, { switching: true }, { permission: { requestId: 1, title: "Ask", detail: "", options: [] } }])(
    "blocks workspace and session replacement while active: %j", async (patch) => {
      useSessionStore.setState(patch);
      useSessionStore.getState().selectSavedSession("first");
      await useSessionStore.getState().pickFolder();
      expect(useSessionStore.getState().savedSessionId).toBe("second");
      expect(mocks.open).not.toHaveBeenCalled();
    });
  it("rejects IDs from a different workspace or unavailable entries", () => {
    useSessionStore.setState({ catalog: { version: 1, sessions: [
      { ...catalog.sessions[0], cwd: "/other", sessionId: "foreign" },
      { ...catalog.sessions[0], sessionId: "stale", unavailable: true },
    ] } });
    useSessionStore.getState().selectSavedSession("foreign");
    useSessionStore.getState().selectSavedSession("stale");
    expect(useSessionStore.getState().savedSessionId).toBe("second");
  });
  it("marks only the requested Resume ID stale on invoke rejection", async () => {
    useSessionStore.getState().selectSavedSession("first");
    mocks.invoke.mockRejectedValueOnce(new Error("session/load failed: unknown session id"));
    await useSessionStore.getState().connect("resume");
    expect(mocks.invalidate).toHaveBeenCalledWith("codex", "/workspace", "first");
    expect(useSessionStore.getState().catalog.sessions.find((entry) => entry.sessionId === "second")?.unavailable).toBe(false);
    expect(useSessionStore.getState().savedSessionId).toBeNull();
  });
});

describe("history I/O context races", () => {
  it("ignores an older agent's delayed catalog load", async () => {
    let finish!: (value: typeof catalog) => void;
    mocks.load.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const old = useSessionStore.getState().reloadForAgent("codex");
    useAgentsStore.setState({ selectedAgentId: "copilot" });
    const copilot = readSessionCatalog(null, { "/workspace": "copilot-id" });
    mocks.load.mockResolvedValueOnce(copilot);
    await useSessionStore.getState().reloadForAgent("copilot");
    finish(catalog); await old;
    expect(useSessionStore.getState().catalog).toEqual(copilot);
    expect(useSessionStore.getState().savedSessionId).toBe("copilot-id");
    expect(useSessionStore.getState().switching).toBe(false);
  });
  it("captures the connection's agent for persistence even if selection changes", async () => {
    const cleanup = await useSessionStore.getState().bindEvents();
    await useSessionStore.getState().connect("new");
    useAgentsStore.setState({ selectedAgentId: "copilot" });
    mocks.handlers.get("acp://status")!({ payload: { connected: true, busy: false, cwd: "/workspace", sessionId: "codex-live" } });
    expect(mocks.save).toHaveBeenCalledWith("codex", "/workspace", "codex-live");
    await flush();
    expect(useSessionStore.getState().savedSessionId).not.toBe("codex-live");
    cleanup();
  });
  it("does not overwrite a newly chosen ID when an earlier disk write completes", async () => {
    let finish!: (value: typeof catalog) => void;
    mocks.save.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const cleanup = await useSessionStore.getState().bindEvents();
    await useSessionStore.getState().connect("new");
    mocks.handlers.get("acp://status")!({ payload: { connected: true, busy: false, cwd: "/workspace", sessionId: "second" } });
    await useSessionStore.getState().disconnect();
    useSessionStore.getState().selectSavedSession("first");
    finish(catalog); await flush();
    expect(useSessionStore.getState().savedSessionId).toBe("first");
    cleanup();
  });
  it("restores the folder after initial agent detection changes during hydration", async () => {
    let finish!: (value: typeof catalog) => void;
    mocks.load.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    useSessionStore.setState({ cwd: null });
    const hydration = useSessionStore.getState().hydrateFromPrefs();
    await flush();
    useAgentsStore.setState({ selectedAgentId: "copilot" });
    const copilot = readSessionCatalog(null, { "/workspace": "copilot-id" });
    mocks.load.mockResolvedValueOnce(copilot);
    await useSessionStore.getState().reloadForAgent("copilot");
    finish(catalog); await hydration;
    expect(useSessionStore.getState().cwd).toBe("/workspace");
    expect(useSessionStore.getState().savedSessionId).toBe("copilot-id");
  });
  it("keeps Connect available and shows metadata failure if the catalog cannot load", async () => {
    mocks.load.mockRejectedValueOnce(new Error("disk unavailable"));
    await useSessionStore.getState().reloadForAgent("codex");
    expect(useSessionStore.getState().catalogError).toBe(true);
    expect(useSessionStore.getState().switching).toBe(false);
    await useSessionStore.getState().connect("new");
    expect(mocks.invoke).toHaveBeenCalledWith("connect_agent", expect.objectContaining({ resumeSessionId: null }));
  });
});
