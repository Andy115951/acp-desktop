import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ agentRevision: 0, sessionRevision: 0, agent: {} as any, session: {} as any, ui: {} as any }));
vi.mock("../store/agents", () => ({ useAgentsStore: { getState: () => m.agent }, getAgentSelectionRevision: () => m.agentRevision }));
vi.mock("../store/session", () => ({ useSessionStore: { getState: () => m.session }, getStartupInterventionRevision: () => m.sessionRevision }));
vi.mock("../store/ui", () => ({ useUiStore: { getState: () => m.ui } }));
import { prepareStartup } from "./startupConnection";

beforeEach(() => {
  m.agentRevision = 0; m.sessionRevision = 0;
  m.ui = { autoConnect: true };
  m.agent = { selectedAgentId: "codex", restoredAgentId: "codex", agents: [{ id: "codex", available: true, connectable: true }], refresh: vi.fn(async () => {}) };
  m.session = { cwd: "/workspace", draftTarget: { agentId: "codex", cwd: "/workspace" }, savedSessionId: "session", draft: "", bindEvents: vi.fn(async () => vi.fn()), hydrateFromPrefs: vi.fn(async () => {}), connect: vi.fn() };
});

describe("startup connection", () => {
  it("registers events before restoring and resumes without sending a message", async () => {
    const order: string[] = [];
    m.session.bindEvents.mockImplementation(async () => { order.push("bind"); return vi.fn(); });
    m.agent.refresh.mockImplementation(async () => { order.push("detect"); });
    m.session.hydrateFromPrefs.mockImplementation(async () => { order.push("hydrate"); });
    m.session.connect.mockImplementation(() => { order.push("connect"); });
    await prepareStartup(() => false, () => {});
    expect(order).toEqual(["bind", "detect", "hydrate", "connect"]);
    expect(m.session.connect).toHaveBeenCalledOnce();
    expect(m.session.connect).toHaveBeenCalledWith("resume");
  });
  it("starts a new session when no previous conversation exists", async () => {
    m.session.savedSessionId = null;
    await prepareStartup(() => false, () => {});
    expect(m.session.connect).toHaveBeenCalledWith("new");
  });
  it.each([
    ["disabled", () => { m.ui.autoConnect = false; }],
    ["no explicit previous agent", () => { m.agent.restoredAgentId = null; }],
    ["fallback agent", () => { m.agent.restoredAgentId = "other"; }],
    ["unavailable agent", () => { m.agent.agents[0].available = false; }],
    ["no workspace", () => { m.session.cwd = null; }],
    ["changed context", () => { m.session.draftTarget.agentId = "other"; }],
    ["draft", () => { m.session.draft = "text"; }],
    ["connecting", () => { m.session.connecting = true; }],
    ["user changed agent", () => { m.agent.refresh.mockImplementation(async () => { m.agentRevision++; }); }],
    ["user interacted", () => { m.session.hydrateFromPrefs.mockImplementation(async () => { m.sessionRevision++; }); }],
  ])("skips auto-connect for %s", async (_name, setup) => {
    setup(); await prepareStartup(() => false, () => {});
    expect(m.session.connect).not.toHaveBeenCalled();
  });
  it("cleans up a listener installed after unmount", async () => {
    const cleanup = vi.fn(); m.session.bindEvents.mockResolvedValue(cleanup);
    await prepareStartup(() => true, () => { throw new Error("unmounted"); });
    expect(cleanup).toHaveBeenCalledOnce(); expect(m.agent.refresh).not.toHaveBeenCalled();
  });
  it("does not connect if unmounted while restoring", async () => {
    let cancelled = false;
    m.session.hydrateFromPrefs.mockImplementation(async () => { cancelled = true; });
    await prepareStartup(() => cancelled, () => {});
    expect(m.session.connect).not.toHaveBeenCalled();
  });
});
