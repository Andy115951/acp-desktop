import { beforeEach, describe, expect, it, vi } from "vitest";
import { editSession, readSessionCatalog, rememberSession } from "../lib/sessionCatalog";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(), open: vi.fn(), load: vi.fn(), save: vi.fn(), invalidate: vi.fn(), edit: vi.fn(), loadWorkspaces: vi.fn(), visit: vi.fn(),
  get: vi.fn(), set: vi.fn(), persist: vi.fn(), handlers: new Map<string, (event: { payload: unknown }) => void>(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));
vi.mock("@tauri-apps/plugin-store", () => ({ Store: { load: async () => ({ get: mocks.get, set: mocks.set, save: mocks.persist }) } }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async (name: string, handler: (event: { payload: unknown }) => void) => {
  mocks.handlers.set(name, handler); return () => mocks.handlers.delete(name);
} }));
vi.mock("./sessionRepository", () => ({ loadSessionCatalog: mocks.load, saveKnownSession: mocks.save, markSessionUnavailable: mocks.invalidate, editKnownSession: mocks.edit, loadWorkspaceHistory: mocks.loadWorkspaces, saveWorkspaceVisit: mocks.visit }));
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
  mocks.edit.mockImplementation(async (_agent, cwd, id, change) => editSession(catalog, cwd, id, change));
  mocks.loadWorkspaces.mockResolvedValue({ version: 1, workspaces: [{ cwd: "/workspace", lastOpenedAt: 0 }] });
  mocks.visit.mockImplementation(async (cwd) => ({ version: 1, workspaces: [{ cwd, lastOpenedAt: 1 }, { cwd: "/workspace", lastOpenedAt: 0 }] }));
  mocks.get.mockResolvedValue("/workspace");
  mocks.set.mockResolvedValue(undefined);
  mocks.persist.mockResolvedValue(undefined);
  useAgentsStore.setState({ selectedAgentId: "codex" });
  useSessionStore.setState({ cwd: "/workspace", catalog, connected: false, busy: false, switching: false,
    catalogError: false, recentWorkspaces: [], workspaceError: false, permission: null, savedSessionId: "second", sessionId: null, error: null, loadSessionSupported: null,
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
      await useSessionStore.getState().selectWorkspace("/other");
      expect(useSessionStore.getState().cwd).toBe("/workspace");
      expect(await useSessionStore.getState().renameSavedSession("New title")).toBe(false);
      expect(await useSessionStore.getState().archiveSavedSession()).toBe(false);
      expect(await useSessionStore.getState().restoreSavedSession("first")).toBe(false);
      expect(mocks.edit).not.toHaveBeenCalled();
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

describe("workspace and session management", () => {
  it("switches folders using only that agent/workspace's saved IDs and clears the old view", async () => {
    const other = rememberSession(catalog, "/other", "other-id", 20);
    mocks.load.mockResolvedValueOnce(other);
    await useSessionStore.getState().selectWorkspace("/other");
    expect(useSessionStore.getState()).toMatchObject({ cwd: "/other", savedSessionId: "other-id", lines: [], draft: "", switching: false });
    expect(mocks.visit).toHaveBeenCalledWith("/other");
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("opens a new workspace even if saving the shortcut fails, with a visible warning", async () => {
    mocks.visit.mockRejectedValueOnce(new Error("disk full"));
    await useSessionStore.getState().selectWorkspace("/new");
    expect(useSessionStore.getState()).toMatchObject({ cwd: "/new", savedSessionId: null, workspaceError: true, switching: false });
    expect(useSessionStore.getState().recentWorkspaces[0].cwd).toBe("/new");
  });
  it("ignores a pending folder dialog if the agent changed in the meantime", async () => {
    let finish!: (folder: string) => void;
    mocks.open.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const picking = useSessionStore.getState().pickFolder();
    useAgentsStore.setState({ selectedAgentId: "copilot" });
    await useSessionStore.getState().reloadForAgent("copilot");
    finish("/other"); await picking;
    expect(useSessionStore.getState().cwd).toBe("/workspace");
    expect(mocks.visit).not.toHaveBeenCalled();
  });
  it("preserves transcript/draft on rename and keeps the same Resume ID", async () => {
    const lines = useSessionStore.getState().lines;
    expect(await useSessionStore.getState().renameSavedSession("  中文 session  ")).toBe(true);
    expect(useSessionStore.getState()).toMatchObject({ savedSessionId: "second", draft: "old draft" });
    expect(useSessionStore.getState().lines).toBe(lines);
    expect(useSessionStore.getState().catalog.sessions[0].title).toBe("中文 session");
  });
  it("archives the selected entry and chooses the next available Resume without deleting any vendor data", async () => {
    expect(await useSessionStore.getState().archiveSavedSession()).toBe(true);
    expect(useSessionStore.getState()).toMatchObject({ savedSessionId: "first", lines: [], draft: "" });
    expect(useSessionStore.getState().catalog.sessions.find((entry) => entry.sessionId === "second")?.archivedAt).toBeTypeOf("number");
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("leaves New session available when the final entry is archived", async () => {
    const single = readSessionCatalog(null, { "/workspace": "second" });
    useSessionStore.setState({ catalog: single });
    mocks.edit.mockResolvedValueOnce(editSession(single, "/workspace", "second", { archivedAt: 1 }));
    await useSessionStore.getState().archiveSavedSession();
    expect(useSessionStore.getState().savedSessionId).toBeNull();
    await useSessionStore.getState().connect("new");
    expect(mocks.invoke).toHaveBeenCalledWith("connect_agent", expect.objectContaining({ resumeSessionId: null }));
  });
  it("restores an archived entry and selects it for Resume without connecting", async () => {
    useSessionStore.setState({ catalog: editSession(catalog, "/workspace", "first", { archivedAt: 1 }) });
    expect(await useSessionStore.getState().restoreSavedSession("first")).toBe(true);
    expect(useSessionStore.getState()).toMatchObject({ savedSessionId: "first", lines: [], draft: "" });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("retains the current entry on failed archive and blocks Connect during the edit", async () => {
    let fail!: (error: Error) => void;
    mocks.edit.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    const archiving = useSessionStore.getState().archiveSavedSession();
    await useSessionStore.getState().connect("new");
    expect(mocks.invoke).not.toHaveBeenCalled();
    fail(new Error("disk full"));
    expect(await archiving).toBe(false);
    expect(useSessionStore.getState()).toMatchObject({ savedSessionId: "second", catalogError: true, switching: false });
    expect(useSessionStore.getState().catalog).toBe(catalog);
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
  it("does not revive an unavailable entry when an earlier successful save settles", async () => {
    let finish!: (value: typeof catalog) => void;
    mocks.save.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const cleanup = await useSessionStore.getState().bindEvents();
    await useSessionStore.getState().connect("resume");
    const status = mocks.handlers.get("acp://status")!;
    status({ payload: { connected: true, busy: false, cwd: "/workspace", sessionId: "second" } });
    status({ payload: { connected: false, busy: false, cwd: "/workspace", error: "session/load failed: session expired" } });
    finish(catalog); await flush();
    expect(useSessionStore.getState().savedSessionId).toBeNull();
    expect(useSessionStore.getState().catalog.sessions.find((entry) => entry.sessionId === "second")?.unavailable).toBe(true);
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
