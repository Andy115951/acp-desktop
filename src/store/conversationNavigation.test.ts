import { beforeEach, describe, expect, it, vi } from "vitest";
import { readDraft } from "../lib/conversationDrafts";
import { readSessionCatalog, rememberSession } from "../lib/sessionCatalog";
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), handlers: new Map<string, (event: {payload: any}) => void>() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async (name: string, handler: (event: {payload: any}) => void) => { mocks.handlers.set(name, handler); return () => mocks.handlers.delete(name); } }));
vi.mock("@tauri-apps/plugin-store", () => ({ Store: { load: async () => ({ get: async () => null, set: async () => {}, save: async () => {} }) } }));
vi.mock("./sessionRepository", () => ({
  loadSessionCatalog: async () => catalog,
  saveKnownSession: async () => catalog,
  markSessionUnavailable: async () => catalog,
  loadWorkspaceHistory: async () => ({version:1,workspaces:[]}),
  saveWorkspaceVisit: async (cwd:string) => ({version:1,workspaces:[{cwd,lastOpenedAt:1}]}),
  editKnownSession: async () => catalog,
  importKnownSessions: async () => catalog,
}));
import { useAgentsStore } from "./agents";
import { useSessionStore } from "./session";
const catalog = rememberSession(rememberSession(readSessionCatalog(null, {"/workspace":"first"}), "/workspace", "second", 2), "/other", "other", 3);
const state = () => useSessionStore.getState();
const ready = (args: any) => ({ agentId: args.agentId, cwd: args.cwd, sessionId: args.resumeSessionId ?? "created", connectionToken: args.connectionToken });
const deferred = () => { let resolve!: (value:any) => void; let reject!: (error:Error) => void; const promise = new Promise((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject}; };
const prompts = () => mocks.invoke.mock.calls.filter(call=>call[0]==="send_prompt");

beforeEach(async () => {
  mocks.invoke.mockResolvedValue(undefined);
  await state().disconnect();
  mocks.invoke.mockReset(); mocks.handlers.clear();
  mocks.invoke.mockImplementation(async (command,args) => command === "connect_agent" ? ready(args) : command === "send_prompt" ? "EndTurn" : undefined);
  useAgentsStore.setState({ selectedAgentId:"codex",customEditing:false,loading:false });
  useSessionStore.setState({cwd:"/workspace",catalog,drafts:{},draftTarget:{agentId:"codex",cwd:"/workspace",sessionId:"first"},
    connected:false,connecting:false,submitting:false,recoveryRequired:false,busy:false,switching:false,configuring:false,
    permission:null,error:null,draft:"",sessionId:null,savedSessionId:"first",loadSessionSupported:null,lines:[],metadata:null,
    configError:false,catalogError:false,recentWorkspaces:[],workspaceError:false,sessionListSupported:null,sessionListIncomplete:false});
});

describe("draft-first conversation navigation", () => {
  it("opens New without a process, keeps repeated New drafts and restores each conversation's text", async () => {
    state().setDraft("history draft");
    await state().newConversation();
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(state()).toMatchObject({savedSessionId:null,draft:"",connected:false,lines:[]});
    state().setDraft("new draft"); await state().newConversation();
    expect(state().draft).toBe("new draft");
    await state().openConversation("first");
    expect(state()).toMatchObject({connected:true,sessionId:"first",draft:"history draft"});
    await state().newConversation();
    expect(state()).toMatchObject({connected:false,savedSessionId:null,draft:"new draft"});
  });
  it("disconnects an idle session before opening another history entry", async () => {
    await state().connect("resume"); state().setDraft("first text");
    mocks.invoke.mockClear();
    await state().openConversation("second");
    expect(mocks.invoke.mock.calls.map(call=>call[0])).toEqual(["disconnect_agent","connect_agent"]);
    expect(state()).toMatchObject({connected:true,sessionId:"second",draft:""});
    state().setDraft("second text"); await state().openConversation("first");
    expect(state().draft).toBe("first text");
  });
  it.each([{busy:true},{connecting:true},{submitting:true},{configuring:true},{permission:{requestId:1,title:"Ask",detail:"",options:[]}}])("guards navigation during active operations: %j", async patch => {
    state().setDraft("keep text"); useSessionStore.setState(patch);
    await state().newConversation(); await state().openConversation("second"); await state().selectWorkspace("/other");
    expect(state()).toMatchObject({draft:"keep text",savedSessionId:"first",cwd:"/workspace"});
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("restores the last draft/selection independently for workspaces and stable agent IDs", async () => {
    state().setDraft("codex first"); await state().selectWorkspace("/other"); state().setDraft("other folder");
    await state().selectWorkspace("/workspace"); expect(state().draft).toBe("codex first");
    useAgentsStore.setState({selectedAgentId:"custom-stable"}); await state().reloadForAgent("custom-stable");
    expect(state().draft).toBe(""); state().setDraft("custom text");
    useAgentsStore.setState({selectedAgentId:"codex"}); await state().reloadForAgent("codex");
    expect(state().draft).toBe("codex first");
    await state().selectWorkspace("/other"); expect(state().draft).toBe("other folder");
  });
  it("guards old drafts during the gap between agent selection and context reload", async () => {
    state().setDraft("belongs to codex");await state().connect("resume");
    mocks.invoke.mockClear();useAgentsStore.setState({selectedAgentId:"copilot"});
    await state().newConversation();await state().openConversation("second");await state().selectWorkspace("/other");await state().send();
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(state()).toMatchObject({cwd:"/workspace",draft:"belongs to codex",draftTarget:{agentId:"codex"},sessionId:"first"});
    await state().disconnect();await state().connect("new");
    expect(mocks.invoke.mock.calls.map(call=>call[0])).toEqual(["disconnect_agent"]);
  });
  it("keeps an unassigned draft when the first workspace is chosen", async () => {
    useSessionStore.setState({cwd:null,savedSessionId:null,draftTarget:null});state().setDraft("before folder");
    await state().selectWorkspace("/workspace");
    expect(state()).toMatchObject({draft:"before folder",savedSessionId:null});
  });
});

describe("first submission handshake", () => {
  it("connects a New target and sends exactly once using the authoritative acknowledgment", async () => {
    await state().newConversation(); state().setDraft("first message");
    await state().send();
    const commands=mocks.invoke.mock.calls;
    expect(commands.map(call=>call[0])).toEqual(["connect_agent","send_prompt"]);
    expect(commands[0][1]).toMatchObject({resumeSessionId:null});
    expect(prompts()).toHaveLength(1);
    expect(prompts()[0][1]).toEqual({text:"first message"});
    expect(state()).toMatchObject({sessionId:"created",draft:"",submitting:false});
    await state().newConversation(); expect(state().draft).toBe("");
  });
  it("uses the selected saved target for an offline first Send", async () => {
    state().setDraft("resume message");await state().send();
    expect(mocks.invoke.mock.calls[0][1]).toMatchObject({resumeSessionId:"first"});
    expect(prompts()).toHaveLength(1);
  });
  it("blocks repeated submissions even if a ready event arrives before the command response", async () => {
    const pending=deferred();let args:any;
    mocks.invoke.mockImplementation((cmd,payload)=>cmd==="connect_agent"?(args=payload,pending.promise):Promise.resolve("EndTurn"));
    await state().bindEvents(); state().setDraft("once");const sending=state().send();
    mocks.handlers.get("acp://status")!({payload:{connectionToken:args.connectionToken,connected:true,busy:false,cwd:"/workspace",sessionId:"first"}});
    await state().send();expect(prompts()).toHaveLength(0);
    pending.resolve(ready(args));await sending;expect(prompts()).toHaveLength(1);
  });
  it("keeps a handshake permission decision explicit before the first prompt", async () => {
    const pending=deferred();let args:any;
    mocks.invoke.mockImplementation((cmd,payload)=>cmd==="connect_agent"?(args=payload,pending.promise):Promise.resolve());
    await state().bindEvents();state().setDraft("needs permission");const sending=state().send();
    mocks.handlers.get("acp://permission")!({payload:{connectionToken:args.connectionToken,requestId:4,title:"Initialize permission",options:[]}});
    pending.resolve(ready(args));await sending;
    expect(prompts()).toHaveLength(0);expect(state()).toMatchObject({draft:"needs permission",submitting:false,permission:{requestId:4}});
  });
  it("retains connection failures and never dispatches a prompt", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("Authentication unavailable"));state().setDraft("keep login draft");
    await state().send();expect(state()).toMatchObject({draft:"keep login draft",submitting:false,connected:false});
    expect(prompts()).toHaveLength(0);
  });
  it("does not dispatch an original or edited draft after the user edits during connection", async () => {
    const pending=deferred();let args:any;
    mocks.invoke.mockImplementation((cmd,payload)=>cmd==="connect_agent"?(args=payload,pending.promise):Promise.resolve());
    state().setDraft("original");const sending=state().send();state().setDraft("revised while connecting");
    pending.resolve(ready(args));await sending;
    expect(prompts()).toHaveLength(0);expect(state()).toMatchObject({draft:"revised while connecting",connected:true,submitting:false});
  });
  it("invalidates pending submission when connection is cancelled and another draft opens", async () => {
    const pending=deferred();let args:any;
    mocks.invoke.mockImplementation((cmd,payload)=>cmd==="connect_agent"?(args=payload,pending.promise):Promise.resolve());
    state().setDraft("cancelled draft");const sending=state().send();await state().disconnect();await state().newConversation();state().setDraft("replacement");
    pending.resolve(ready(args));await sending;
    expect(prompts()).toHaveLength(0);expect(state().draft).toBe("replacement");
  });
  it("rejects mismatched acknowledgments instead of sending into an unintended session", async () => {
    mocks.invoke.mockImplementation(async(cmd,args)=>cmd==="connect_agent"?{...ready(args),sessionId:"wrong-session"}:undefined);
    state().setDraft("guarded text");await state().send();
    expect(prompts()).toHaveLength(0);expect(state().draft).toBe("guarded text");
    expect(state().error).toContain("unexpected connected session");
    expect(mocks.invoke).toHaveBeenCalledWith("disconnect_agent");
  });
  it("requires an explicit New after stale Resume and retains its unsent text", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("session/load failed: unknown session id"));state().setDraft("recovery text");
    await state().send();expect(state()).toMatchObject({recoveryRequired:true,draft:"recovery text"});
    const count=mocks.invoke.mock.calls.length;await state().send();expect(mocks.invoke.mock.calls).toHaveLength(count);
    await state().newConversation();expect(state().draft).toBe("recovery text");await state().send();
    expect(prompts()).toHaveLength(1);
    const connects=mocks.invoke.mock.calls.filter(call=>call[0]==="connect_agent");
    expect(connects[connects.length-1][1]).toMatchObject({resumeSessionId:null});
  });
  it("never overwrites a separate New draft when recovering an expired conversation", async () => {
    state().setDraft("history text");await state().newConversation();state().setDraft("separate New text");
    await state().openConversation("first");await state().disconnect();
    mocks.invoke.mockRejectedValueOnce(new Error("session/load failed: unknown session id"));await state().send();
    await state().newConversation();
    expect(state()).toMatchObject({draft:"history text",recoveryRequired:true});
    expect(state().error).toContain("A separate New conversation draft exists.");
    state().setDraft("");await state().newConversation();expect(state().draft).toBe("separate New text");
  });
  it("keeps an unsupported saved target explicit instead of creating another session", async () => {
    useSessionStore.setState({loadSessionSupported:false});state().setDraft("unsent");
    await state().openConversation("second");await state().send();
    expect(mocks.invoke).not.toHaveBeenCalled();expect(state()).toMatchObject({savedSessionId:"first",draft:"unsent"});
  });
});

it("rejects late status, stream, permission, metadata and discovery events from a stopped connection", async () => {
  await state().bindEvents();const first=await state().connect("resume");
  await state().newConversation();const second=await state().connect("new");state().setDraft("new live draft");
  expect(first?.connectionToken).not.toBe(second?.connectionToken);
  const before={draft:state().draft,sessionId:state().sessionId,lines:state().lines,metadata:state().metadata,catalog:state().catalog};
  for(const [event,payload] of [
    ["acp://status",{connected:false,busy:false,cwd:"/other",error:"old failure"}],
    ["acp://stream",{kind:"agent_message",text:"old text"}],
    ["acp://permission",{requestId:5,title:"old Ask",options:[]}],
    ["acp://metadata",{agentId:"codex",cwd:"/workspace",sessionId:"first",commands:[]}],
    ["acp://sessions",{agentId:"codex",cwd:"/workspace",sessions:[],supported:false,incomplete:true}],
  ] as const) mocks.handlers.get(event)!({payload:{...payload,connectionToken:first?.connectionToken}});
  expect(state()).toMatchObject(before);expect(state().permission).toBeNull();expect(state().connected).toBe(true);
  expect(readDraft(state().drafts,{agentId:"codex",cwd:"/workspace",sessionId:null})).toBe("");
});
