import { bindDraft, lastConversation, readDraft, rememberDraft, type ConversationDrafts, type DraftTarget } from "../lib/conversationDrafts";
import { mergeSessionMetadata, type SessionMetadata } from "../lib/sessionMetadata";
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { Store } from "@tauri-apps/plugin-store";
import {
  isNoPendingPermissionError,
  isStalePermissionError,
  shouldDismissAskOnDisconnect,
} from "../lib/permissionHotkey";
import { useAgentsStore } from "./agents";
import {
  PREFS_KEY_LAST_CWD,
  isPlausibleCwd,
  isSessionLoadFailedError,
  recoverableSessionLoadMessage,
  shouldPersistConnectedSessionId,
} from "../lib/sessionPrefs";
import { sessionPatchAfterClear } from "../lib/sessionUiGates";
import { appendStreamLine, sealTranscript, recordToolDecision, type StreamLine, type ToolData } from "../lib/transcript";

import { sessionPatchAfterAgentSwitch } from "../lib/agentSwitch";
import { invalidateSession, mergeDiscoveredSessions, rememberSession, sessionsForWorkspace, validSessionTitle, type DiscoveredSession, type SessionCatalog } from "../lib/sessionCatalog";
import { editKnownSession, importKnownSessions, loadSessionCatalog, loadWorkspaceHistory, markSessionUnavailable, saveKnownSession, saveWorkspaceVisit } from "./sessionRepository";

import { visitWorkspace, type RecentWorkspace } from "../lib/workspaceHistory";

const emptyCatalog = (): SessionCatalog => ({ version: 1, sessions: [] });

async function loadCatalogContext(agentId: string, cwd: string | null) {
  try {
    const catalog = await loadSessionCatalog(agentId);
    return { catalog, catalogError: false, savedSessionId: cwd ? sessionsForWorkspace(catalog, cwd)[0]?.sessionId ?? null : null };
  } catch {
    return { catalog: emptyCatalog(), catalogError: true, savedSessionId: null };
  }
}

export type PermissionRequest = {
  requestId: number;
  title: string;
  detail: string;
  options: { id: string; name: string; kind: string }[];
  tool?: ToolData;
};

const PREFS_FILE = "prefs.json";

let prefsStore: Store | null = null;

async function getPrefsStore(): Promise<Store> {
  if (!prefsStore) {
    prefsStore = await Store.load(PREFS_FILE);
  }
  return prefsStore;
}

/** Current UI-selected agent (fallback grok). */
function currentAgentId(): string {
  return useAgentsStore.getState().selectedAgentId || "grok";
}

async function loadLastCwd(): Promise<string | null> {
  try {
    const store = await getPrefsStore();
    const value = await store.get<unknown>(PREFS_KEY_LAST_CWD);
    return isPlausibleCwd(value) ? value.trim() : null;
  } catch {
    return null;
  }
}

type ConnectedSession = { agentId: string; cwd: string; sessionId: string; connectionToken: string };

type SessionState = {
  drafts: ConversationDrafts;
  draftTarget: DraftTarget | null;
  connecting: boolean;
  submitting: boolean;
  recoveryRequired: boolean;
  newConversation: () => Promise<void>;
  openConversation: (sessionId: string) => Promise<void>;
  cwd: string | null;
  catalog: SessionCatalog;
  catalogError: boolean;
  sessionListSupported: boolean | null;
  sessionListIncomplete: boolean;
  metadata: SessionMetadata | null;
  configuring: boolean;
  configError: boolean;
  setConfig: (id: string, value: string) => Promise<void>;
  insertCommand: (name: string) => void;
  recentWorkspaces: RecentWorkspace[];
  workspaceError: boolean;
  selectWorkspace: (cwd: string) => Promise<void>;
  renameSavedSession: (title: string) => Promise<boolean>;
  archiveSavedSession: () => Promise<boolean>;
  restoreSavedSession: (sessionId: string) => Promise<boolean>;
  switching: boolean;
  selectSavedSession: (sessionId: string) => void;
  connected: boolean;
  busy: boolean;
  error: string | null;
  sessionId: string | null;
  savedSessionId: string | null;
  loadSessionSupported: boolean | null;
  lines: StreamLine[];
  permission: PermissionRequest | null;
  draft: string;
  setDraft: (v: string) => void;
  pickFolder: () => Promise<void>;
  hydrateFromPrefs: () => Promise<void>;
  reloadForAgent: (agentId: string) => Promise<void>;
  connect: (mode?: "new" | "resume") => Promise<ConnectedSession | null>;
  disconnect: () => Promise<void>;
  send: () => Promise<void>;
  cancel: () => Promise<void>;
  respondPermission: (optionId: string | null) => Promise<void>;
  clearTranscript: () => void;
  bindEvents: () => Promise<() => void>;
};

let lineCounter = 0;
let draftRevision = 0;
let connectionGeneration = 0;
let contextGeneration = 0;
let startupInterventionRevision = 0;
export const getStartupInterventionRevision = () => startupInterventionRevision;
let connectionAgentId: string | null = null;
let activeConnectionToken: string | null = null;
const acceptsEvent = (event: { connectionToken?: string }) => !event.connectionToken || event.connectionToken === activeConnectionToken;
let catalogRevision = 0;

function targetFor(state: SessionState): DraftTarget {
  return state.draftTarget ?? { agentId: currentAgentId(), cwd: state.cwd, sessionId: state.sessionId ?? state.savedSessionId };
}
function parkedDrafts(state: SessionState): ConversationDrafts {
  return rememberDraft(state.drafts, targetFor(state), state.draft);
}
function pendingAgentContext(state: SessionState): boolean {
  return !!state.draftTarget && state.draftTarget.agentId !== currentAgentId();
}
function navigationBlocked(state: SessionState): boolean {
  return pendingAgentContext(state) || state.busy || state.connecting || state.submitting || state.configuring || !!state.permission || state.switching || useAgentsStore.getState().customEditing;
}

type CatalogEdit = { type: "rename"; title: string } | { type: "archive" } | { type: "restore"; sessionId: string };

async function editSavedEntry(action: CatalogEdit): Promise<boolean> {
  const state = useSessionStore.getState();
  if (state.connected || navigationBlocked(state) || !state.cwd) return false;
  const sessionId = action.type === "restore" ? action.sessionId : state.savedSessionId;
  const entry = state.catalog.sessions.find((item) => item.cwd === state.cwd && item.sessionId === sessionId);
  if (!entry || (action.type === "restore" ? entry.archivedAt == null : entry.archivedAt != null || entry.unavailable)) return false;
  if (action.type === "rename" && !validSessionTitle(action.title)) return false;
  const agentId = currentAgentId();
  const generation = ++contextGeneration;
  ++catalogRevision;
  useSessionStore.setState({ switching: true });
  try {
    const change = action.type === "rename" ? { title: action.title }
      : { archivedAt: action.type === "archive" ? Date.now() : null };
    const catalog = await editKnownSession(agentId, state.cwd, entry.sessionId, change);
    if (generation !== contextGeneration || currentAgentId() !== agentId || useSessionStore.getState().cwd !== state.cwd) return false;
    const savedSessionId = action.type === "archive" ? sessionsForWorkspace(catalog, state.cwd)[0]?.sessionId ?? null
      : action.type === "restore" && !entry.unavailable ? entry.sessionId : state.savedSessionId;
    const drafts = parkedDrafts(state);
    const target = { agentId, cwd: state.cwd, sessionId: savedSessionId };
    useSessionStore.setState({ catalog, catalogError: false, savedSessionId, drafts,
      ...(savedSessionId !== state.savedSessionId ? { draftTarget: target, lines: [], draft: readDraft(drafts, target), error: null, sessionId: null } : {}) });
    return true;
  } catch {
    if (generation === contextGeneration) useSessionStore.setState({ catalogError: true });
    return false;
  } finally {
    if (generation === contextGeneration) useSessionStore.setState({ switching: false });
  }
}

async function loadRecentWorkspaces() {
  try { return { recentWorkspaces: (await loadWorkspaceHistory()).workspaces, workspaceError: false }; }
  catch { return { recentWorkspaces: [], workspaceError: true }; }
}

export const useSessionStore = create<SessionState>((set, get) => ({
  drafts: {}, draftTarget: null, connecting: false, submitting: false, recoveryRequired: false,
  newConversation: async () => {
    ++startupInterventionRevision;
    const state = get();
    if (navigationBlocked(state)) return;
    const agentId = currentAgentId();
    const cwd = state.cwd;
    const drafts = parkedDrafts(state);
    const target = { agentId, cwd, sessionId: null };
    const newDraft = readDraft(drafts, target);
    if (state.recoveryRequired && state.draft && newDraft && newDraft !== state.draft) {
      set({ error: "A separate New conversation draft exists. Copy or clear this failed Resume draft before opening New conversation." });
      return;
    }
    const generation = ++contextGeneration;
    set({ switching: true });
    try {
      if (state.connected) await get().disconnect();
      if (generation !== contextGeneration || currentAgentId() !== agentId || get().cwd !== cwd) return;
      ++draftRevision; ++connectionGeneration; activeConnectionToken = null;
      set({ drafts, draftTarget: target, draft: readDraft(drafts, target) || (state.recoveryRequired ? state.draft : ""),
        savedSessionId: null, sessionId: null, connected: false, busy: false, recoveryRequired: false,
        metadata: null, configError: false, configuring: false, loadSessionSupported: null,
        error: null, lines: [], permission: null });
    } catch (error) {
      if (generation === contextGeneration) set({ error: String(error) });
    } finally {
      if (generation === contextGeneration) set({ switching: false });
    }
  },
  openConversation: async (sessionId) => {
    ++startupInterventionRevision;
    const state = get();
    if (navigationBlocked(state) || !state.cwd) return;
    if (!sessionsForWorkspace(state.catalog, state.cwd).some(entry => entry.sessionId === sessionId)) return;
    if (state.connected && state.sessionId === sessionId) return;
    if (state.loadSessionSupported === false) {
      set({ error: "Agent does not advertise loadSession; Resume is unavailable. Choose New conversation." });
      return;
    }
    const generation = ++contextGeneration;
    const agentId = currentAgentId();
    const cwd = state.cwd;
    const drafts = parkedDrafts(state);
    const target = { agentId, cwd, sessionId };
    set({ switching: true });
    try {
      if (state.connected) await get().disconnect();
      if (generation !== contextGeneration || currentAgentId() !== agentId || get().cwd !== cwd) return;
      ++draftRevision; ++connectionGeneration; activeConnectionToken = null;
      set({ drafts, draftTarget: target, draft: readDraft(drafts, target), savedSessionId: sessionId,
        sessionId: null, lines: [], error: null, permission: null, recoveryRequired: false });
    } catch (error) {
      if (generation === contextGeneration) set({ error: String(error) });
      return;
    } finally {
      if (generation === contextGeneration) set({ switching: false });
    }
    if (generation === contextGeneration && currentAgentId() === agentId && get().cwd === cwd) await get().connect("resume");
  },
  cwd: null,
  catalog: emptyCatalog(),
  catalogError: false,
  sessionListSupported: null,
  sessionListIncomplete: false, metadata: null, configuring: false, configError: false,
  recentWorkspaces: [],
  workspaceError: false,
  renameSavedSession: (title) => editSavedEntry({ type: "rename", title }),
  archiveSavedSession: () => editSavedEntry({ type: "archive" }),
  restoreSavedSession: (sessionId) => editSavedEntry({ type: "restore", sessionId }),
  selectWorkspace: async (cwd) => {
    ++startupInterventionRevision;
    if (navigationBlocked(get()) || !isPlausibleCwd(cwd) || get().cwd === cwd) return;
    const generation = ++contextGeneration;
    const agentId = currentAgentId();
    const previous = get();
    const drafts = parkedDrafts(previous);
    set({ switching: true });
    try {
      if (previous.connected) await get().disconnect();
      if (generation !== contextGeneration || currentAgentId() !== agentId) return;
      const context = await loadCatalogContext(agentId, cwd);
      if (generation !== contextGeneration || currentAgentId() !== agentId) return;
      let recentWorkspaces: RecentWorkspace[];
      let workspaceError = false;
      try { recentWorkspaces = (await saveWorkspaceVisit(cwd)).workspaces; }
      catch {
        recentWorkspaces = visitWorkspace({ version: 1, workspaces: get().recentWorkspaces }, cwd, Date.now()).workspaces;
        workspaceError = true;
      }
      if (generation !== contextGeneration || currentAgentId() !== agentId) return;
      context.savedSessionId = lastConversation(drafts, agentId, cwd, context.savedSessionId, sessionsForWorkspace(context.catalog, cwd).map(entry => entry.sessionId));
      const target = { agentId, cwd, sessionId: context.savedSessionId };
      // A draft written before the first folder choice starts a new conversation.
      if (!previous.cwd && previous.draft) { context.savedSessionId = null; target.sessionId = null; }
      ++draftRevision; ++connectionGeneration; activeConnectionToken = null;
      set({ ...context, drafts, draftTarget: target, recentWorkspaces, workspaceError, cwd, error: null, sessionId: null, recoveryRequired: false, sessionListSupported: null, sessionListIncomplete: false, metadata: null, configuring: false, configError: false,
        loadSessionSupported: null, lines: [], permission: null, draft: !previous.cwd && previous.draft ? previous.draft : readDraft(drafts, target) });
    } catch (error) {
      if (generation === contextGeneration) set({ error: String(error) });
    } finally {
      if (generation === contextGeneration) set({ switching: false });
    }
  },
  switching: false,
  selectSavedSession: (sessionId) => {
    ++startupInterventionRevision;
    const state = get();
    if (state.connected || navigationBlocked(state) || !state.cwd) return;
    if (!sessionsForWorkspace(state.catalog, state.cwd).some((entry) => entry.sessionId === sessionId)) return;
    const drafts = parkedDrafts(state);
    const target = { agentId: currentAgentId(), cwd: state.cwd, sessionId };
    ++draftRevision; ++connectionGeneration; activeConnectionToken = null;
    set({ drafts, draftTarget: target, savedSessionId: sessionId, sessionId: null, lines: [], error: null, permission: null,
      recoveryRequired: false, draft: readDraft(drafts, target) });
  },
  connected: false,
  busy: false,
  error: null,
  sessionId: null,
  savedSessionId: null,
  loadSessionSupported: null,
  lines: [],
  permission: null,
  draft: "",
  setDraft: (v) => { ++startupInterventionRevision; ++draftRevision; set({ draft: v, draftTarget: targetFor(get()) }); },
  setConfig: async (id, value) => {
    const state = get();
    const option = state.metadata?.configOptions?.find(option => option.id === id);
    if (!state.connected || navigationBlocked(state) || !state.sessionId
      || state.metadata?.sessionId !== state.sessionId || !option?.writable || option.currentValue === value
      || !option.choices.some(choice => choice.value === value)) return;
    const generation = connectionGeneration;
    const sessionId = state.sessionId;
    set({ configuring: true, busy: true, configError: false });
    try {
      await invoke("set_session_config", { sessionId, configId: id, value });
    } catch {
      if (generation === connectionGeneration && get().sessionId === sessionId) set({ configError: true });
    } finally {
      if (generation === connectionGeneration && get().sessionId === sessionId) set({ configuring: false, busy: false });
    }
  },
  insertCommand: (name) => {
    const state = get();
    if (!state.connected || navigationBlocked(state) || state.metadata?.sessionId !== state.sessionId
      || !state.metadata?.commands?.some(command => command.name === name)) return;
    set({ draft: `/${name} ${state.draft}` });
  },
  clearTranscript: () => set(sessionPatchAfterClear()),
  pickFolder: async () => {
    ++startupInterventionRevision;
    if (navigationBlocked(get())) return;
    const generation = ++contextGeneration;
    const agentId = currentAgentId();
    set({ switching: true });
    let selected: string | string[] | null = null;
    try { selected = await open({ directory: true, multiple: false }); }
    catch (error) {
      if (generation === contextGeneration) set({ error: String(error) });
    } finally {
      if (generation === contextGeneration) set({ switching: false });
    }
    if (generation === contextGeneration && currentAgentId() === agentId && typeof selected === "string") {
      await get().selectWorkspace(selected);
    }
  },
  hydrateFromPrefs: async () => {
    if (get().cwd || get().switching) return;
    const generation = ++contextGeneration;
    set({ switching: true });
    try {
      const [lastCwd, workspaces] = await Promise.all([loadLastCwd(), loadRecentWorkspaces()]);
      if (generation !== contextGeneration) return;
      // Initial agent detection can finish during prefs I/O. Retry the read
      // for the current agent without mixing either vendor's metadata.
      while (generation === contextGeneration && !get().cwd) {
        const agentId = currentAgentId();
        const context = await loadCatalogContext(agentId, lastCwd);
        if (generation !== contextGeneration) return;
        if (currentAgentId() !== agentId) continue;
        const unassignedDraft = get().draft;
        if (unassignedDraft) context.savedSessionId = null;
        const target = { agentId, cwd: lastCwd, sessionId: context.savedSessionId };
        const drafts = parkedDrafts(get());
        set({ ...context, ...workspaces, drafts, draftTarget: target, draft: unassignedDraft || readDraft(drafts, target), cwd: lastCwd, error: null });
        break;
      }
    } finally {
      if (generation === contextGeneration) set({ switching: false });
    }
  },
  reloadForAgent: async (agentId: string) => {
    if (!get().cwd) { await get().hydrateFromPrefs(); return; }
    const generation = ++contextGeneration;
    const cwd = get().cwd;
    if (!cwd) return;
    const previous = get();
    const drafts = previous.switching ? previous.drafts : parkedDrafts(previous);
    const previousTarget = targetFor(previous);
    set({ ...sessionPatchAfterAgentSwitch(null), draftTarget: previousTarget, drafts, catalog: emptyCatalog(), switching: true, draft: "", recoveryRequired: false, sessionListSupported: null, sessionListIncomplete: false, metadata: null, configuring: false, configError: false });
    const context = await loadCatalogContext(agentId, cwd);
    if (generation !== contextGeneration || currentAgentId() !== agentId || get().cwd !== cwd) return;
    context.savedSessionId = lastConversation(drafts, agentId, cwd, context.savedSessionId, sessionsForWorkspace(context.catalog, cwd).map(entry => entry.sessionId));
    const target = { agentId, cwd, sessionId: context.savedSessionId };
    ++draftRevision; ++connectionGeneration; activeConnectionToken = null;
    set({ ...context, draftTarget: target, draft: readDraft(drafts, target), switching: false });
  },
  connect: async (mode = "new") => {
    const cwd = get().cwd;
    if (!cwd) {
      set({ error: "Pick a workspace folder first." });
      return null;
    }
    // Host now awaits handshake, but still guard double-clicks while busy /
    // already connected so we never stack a second connect_agent.
    if (get().connected || navigationBlocked(get())) {
      return null;
    }
    const resumeSessionId =
      mode === "resume" ? get().savedSessionId ?? undefined : undefined;
    if (mode === "resume" && !resumeSessionId) {
      set({ error: "No saved session for this folder." });
      return null;
    }
    if (mode === "resume" && get().loadSessionSupported === false) {
      set({
        error:
          "Agent does not advertise loadSession; Resume is unavailable. Choose New conversation.",
      });
      return null;
    }
    set({
      error: null,
      busy: true, connecting: true,
      sessionId: null,
      sessionListSupported: null,
      sessionListIncomplete: false, metadata: null, configuring: false, configError: false,
      // Clear prior transcript on New or Resume so old turns never mix with
      // a fresh session/new or session/load. Status marker distinguishes an
      // empty connect from "events never arrived".
      lines:
        mode === "resume"
          ? [
              {
                id: `resume-${++lineCounter}`,
                kind: "status",
                text: "Resuming session…",
              },
            ]
          : [
              {
                id: `new-${++lineCounter}`,
                kind: "status",
                text: "New session…",
              },
            ],
    });
    const generation = ++connectionGeneration;
    const agentId = currentAgentId();
    connectionAgentId = agentId;
    const connectionToken = crypto.randomUUID();
    activeConnectionToken = connectionToken;
    try {
      const ready = await invoke<ConnectedSession>("connect_agent", {
        agentId,
        cwd,
        resumeSessionId: resumeSessionId ?? null,
        connectionToken,
      });
      if (generation !== connectionGeneration) return null;
      if (currentAgentId() !== agentId || get().cwd !== cwd) return null;
      if (!ready || ready.agentId !== agentId || ready.cwd !== cwd || ready.connectionToken !== connectionToken || !ready.sessionId
        || (resumeSessionId && ready.sessionId !== resumeSessionId)) {
        // Stop the unexpected live process before allowing another connection.
        activeConnectionToken = null;
        await invoke("disconnect_agent").catch(() => {});
        throw new Error("Agent returned an unexpected connected session.");
      }
      const target = { agentId, cwd, sessionId: ready.sessionId };
      set({ drafts: bindDraft(get().drafts, targetFor(get()), target, get().draft), draftTarget: target,
        connected: true, sessionId: ready.sessionId, savedSessionId: ready.sessionId, recoveryRequired: false });
      set({ busy: false });
      return ready;
    } catch (e) {
      if (generation !== connectionGeneration) return null;
      const raw = e instanceof Error ? e.message : String(e);
      // Invoke rejection path: status may also fire, but always drop a dead
      // Resume id here so the button cannot retry the same stale session.
      if (isSessionLoadFailedError(raw) && cwd) {
        if (resumeSessionId) {
          ++catalogRevision;
          set({ catalog: invalidateSession(get().catalog, cwd, resumeSessionId) });
          void markSessionUnavailable(agentId, cwd, resumeSessionId).catch(() => {
            if (generation === connectionGeneration) set({ catalogError: true });
          });
        }
        set({
          connected: false,
          busy: false,
          savedSessionId: null, recoveryRequired: true,
          error: recoverableSessionLoadMessage(raw),
        });
        return null;
      }
      set({
        connected: false,
        busy: false,
        error: raw,
      });
      return null;
    } finally {
      if (generation === connectionGeneration) set({ connecting: false });
    }
  },
  disconnect: async () => {
    const generation = ++connectionGeneration;
    activeConnectionToken = null;
    set({ connecting: false, submitting: false });
    try {
      await invoke("disconnect_agent");
    } finally {
      if (generation !== connectionGeneration) return;
      set({
        connected: false,
        busy: false,
        sessionId: null,
        metadata: null, configuring: false, configError: false,
        permission: null,
        lines: recordToolDecision(get().lines, get().permission?.tool?.id, "cancelled"),
      });
    }
  },
  send: async () => {
    const text = get().draft;
    if (!text.trim()) return;
    // Ask modal owns the turn; never queue a second prompt underneath it.
    if (navigationBlocked(get())) return;
    if (!get().connected) {
      if (!get().cwd || get().recoveryRequired) return;
      const revision = draftRevision;
      const agentId = currentAgentId();
      const cwd = get().cwd;
      const connection = get().connect(get().savedSessionId ? "resume" : "new");
      const generation = connectionGeneration;
      set({ submitting: true });
      const ready = await connection;
      if (generation !== connectionGeneration) return;
      set({ submitting: false });
      if (!ready || get().error || !get().connected || navigationBlocked(get()) || currentAgentId() !== agentId || get().cwd !== cwd
        || get().sessionId !== ready.sessionId || draftRevision !== revision || get().draft !== text) return;
    }
    const generation = connectionGeneration;
    const sentDraftRevision = ++draftRevision;
    set({
      draft: "",
      busy: true, submitting: true,
      error: null,
      lines: [
        ...get().lines,
        { id: `u-${++lineCounter}`, kind: "user", text },
      ],
    });
    try {
      const stop = await invoke<string>("send_prompt", { text });
      if (generation !== connectionGeneration) return;
      set({
        busy: false,
        lines: [
          ...get().lines,
          { id: `stop-${++lineCounter}`, kind: "stop", text: `stop: ${stop}` },
        ],
      });
    } catch (e) {
      if (generation !== connectionGeneration) return;
      set({
        busy: false,
        error: e instanceof Error ? e.message : String(e),
        lines: sealTranscript(get().lines),
        // Restore a failed submission only if the user has not edited (even
        // typed and cleared) the next draft while the request was running.
        ...(draftRevision === sentDraftRevision && !get().draft ? { draft: text } : {}),
      });
    } finally {
      if (generation === connectionGeneration) set({ submitting: false });
    }
  },
  cancel: async () => {
    set({ lines: recordToolDecision(get().lines, get().permission?.tool?.id, "cancelled") });
    // Host cancel_prompt clears the pending Ask oneshot. Do not also call
    // respond_permission here — that would race and surface "no pending".
    if (get().permission) {
      set({ permission: null });
    }
    try {
      await invoke("cancel_prompt");
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },
  respondPermission: async (optionId) => {
    const perm = get().permission;
    if (!perm) return;
    const generation = connectionGeneration;
    try {
      await invoke("respond_permission", {
        requestId: perm.requestId,
        optionId,
      });
      if (generation !== connectionGeneration) return;
      const option = perm.options.find((candidate) => candidate.id === optionId);
      const decision = optionId === null ? "cancelled" : option?.kind.startsWith("Allow") ? "allowed" : "rejected";
      set((state) => ({
        // Do not dismiss a newer request that arrived while invoke resolved.
        ...(state.permission?.requestId === perm.requestId ? { permission: null } : {}),
        lines: recordToolDecision(state.lines, perm.tool?.id, decision),
      }));
    } catch (e) {
      if (generation !== connectionGeneration) return;
      const message = e instanceof Error ? e.message : String(e);
      // Cancel / Disconnect already cleared the host oneshot — dismiss quietly.
      if (isNoPendingPermissionError(message)) {
        set((state) => ({
          ...(state.permission?.requestId === perm.requestId ? { permission: null } : {}),
          lines: recordToolDecision(state.lines, perm.tool?.id, "cancelled"),
        }));
        return;
      }
      // Stale id: host kept the real Ask — leave modal up, no red banner.
      if (isStalePermissionError(message)) {
        return;
      }
      set({ error: `respond_permission failed: ${message}` });
    }
  },
  bindEvents: async () => {
    const unsubs: UnlistenFn[] = [];
    unsubs.push(await listen<SessionMetadata & { connectionToken?: string }>("acp://metadata", (ev) => {
        if (!acceptsEvent(ev.payload)) return;
      const update = ev.payload;
      const state = get();
      if (update.agentId !== currentAgentId() || update.agentId !== connectionAgentId || update.cwd !== state.cwd
        || (!state.connected && !state.busy) || (state.sessionId && state.sessionId !== update.sessionId)) return;
      set({ metadata: mergeSessionMetadata(state.metadata, update), ...(update.configOptions ? { configError: false } : {}) });
    }));
    unsubs.push(
      await listen<{ kind: string; text: string; tool?: ToolData; connectionToken?: string }>("acp://stream", (ev) => {
        if (!acceptsEvent(ev.payload)) return;
        // Functional update preserves back-to-back chunks and replay order.
        set((state) => ({
          lines: appendStreamLine(state.lines, {
            id: `s-${++lineCounter}`,
            kind: ev.payload.kind,
            text: ev.payload.text,
            tool: ev.payload.tool,
          }),
        }));
      }),
    );
    unsubs.push(
      await listen<{
        connectionToken?: string;
        requestId: number;
        title: string;
        detail: string;
        options: { id: string; name: string; kind: string }[];
        tool?: ToolData;
      }>("acp://permission", (ev) => {
        if (!acceptsEvent(ev.payload)) return;
        set((state) => ({
          lines: ev.payload.tool ? appendStreamLine(state.lines, {
            id: `tool-${++lineCounter}`, kind: "tool_call", text: ev.payload.title, tool: ev.payload.tool,
          }) : sealTranscript(state.lines),
          permission: {
            requestId: ev.payload.requestId,
            title: ev.payload.title,
            detail: ev.payload.detail,
            options: ev.payload.options,
            tool: ev.payload.tool,
          },
        }));
      }),
    );
    unsubs.push(
      await listen<{
        connectionToken?: string; agentId: string; cwd: string; supported: boolean; incomplete: boolean; sessions: DiscoveredSession[];
      }>("acp://sessions", (ev) => {
        if (!acceptsEvent(ev.payload)) return;
        const { agentId, cwd, supported, incomplete, sessions } = ev.payload;
        if (agentId !== currentAgentId() || agentId !== connectionAgentId || cwd !== get().cwd || (!get().connected && !get().busy)) return;
        const generation = connectionGeneration;
        const revision = ++catalogRevision;
        set({ sessionListSupported: supported, sessionListIncomplete: incomplete,
          catalog: mergeDiscoveredSessions(get().catalog, cwd, sessions) });
        if (!sessions.length) return;
        void importKnownSessions(agentId, cwd, sessions).then((catalog) => {
          if (generation === connectionGeneration && revision === catalogRevision && agentId === currentAgentId() && cwd === get().cwd) set({ catalog });
        }).catch(() => {
          if (generation === connectionGeneration && agentId === currentAgentId() && cwd === get().cwd) set({ sessionListIncomplete: true, catalogError: true });
        });
      }),
    );
    unsubs.push(
      await listen<{
        connectionToken?: string;
        connected: boolean;
        cwd?: string | null;
        sessionId?: string | null;
        busy: boolean;
        error?: string | null;
        loadSessionSupported?: boolean | null;
      }>("acp://status", (ev) => {
        if (!acceptsEvent(ev.payload)) return;
        const cwd = ev.payload.cwd ?? get().cwd;
        const sessionId = ev.payload.sessionId ?? null;
        const loadSessionSupported =
          ev.payload.loadSessionSupported ?? get().loadSessionSupported;

        // Persist only after handshake completes (!busy). Mid-Resume status
        // used to emit sessionId while busy and re-save a dead id over clear.
        if (
          shouldPersistConnectedSessionId({
            connected: !!ev.payload.connected,
            sessionId,
            busy: !!ev.payload.busy,
            error: ev.payload.error,
          }) &&
          cwd &&
          sessionId
        ) {
          const agentId = connectionAgentId ?? currentAgentId();
          const generation = connectionGeneration;
          const revision = ++catalogRevision;
          if (currentAgentId() === agentId) {
            const target = { agentId, cwd, sessionId };
            set({ savedSessionId: sessionId, drafts: bindDraft(get().drafts, targetFor(get()), target, get().draft), draftTarget: target,
              catalog: rememberSession(get().catalog, cwd, sessionId, Date.now()) });
          }
          void saveKnownSession(agentId, cwd, sessionId).then((catalog) => {
            if (generation === connectionGeneration && revision === catalogRevision && currentAgentId() === agentId && get().cwd === cwd) {
              set({ catalog, catalogError: false });
            }
          }).catch(() => {
            if (generation === connectionGeneration && revision === catalogRevision && currentAgentId() === agentId && get().cwd === cwd) set({ catalogError: true });
          });
        }

        // Corrupt / unknown resume id: drop the stale prefs entry so Resume
        // does not keep failing; an explicit New conversation is required.
        const loadFailed =
          !!ev.payload.error && isSessionLoadFailedError(ev.payload.error);
        const statusError = loadFailed
          ? recoverableSessionLoadMessage(ev.payload.error!)
          : (ev.payload.error ?? null);
        if (loadFailed && cwd) {
          const agentId = connectionAgentId ?? currentAgentId();
          const failedId = get().savedSessionId;
          const generation = connectionGeneration;
          if (failedId) {
            ++catalogRevision;
            set({ catalog: invalidateSession(get().catalog, cwd, failedId) });
            void markSessionUnavailable(agentId, cwd, failedId).catch(() => {
              if (generation === connectionGeneration && currentAgentId() === agentId) set({ catalogError: true });
            });
          }
        }

        set({
          ...(!ev.payload.connected ? { metadata: null, configuring: false, configError: false } : {}),
          connected: ev.payload.connected,
          cwd: cwd ?? get().cwd,
          sessionId: sessionId ?? (ev.payload.connected ? get().sessionId : null),
          busy: ev.payload.busy,
          error: statusError,
          loadSessionSupported,
          ...(!ev.payload.connected || !ev.payload.busy || statusError
            ? { lines: !ev.payload.connected
                ? recordToolDecision(get().lines, get().permission?.tool?.id, "cancelled")
                : sealTranscript(get().lines) }
            : {}),
          // Agent exit / Disconnect via status: drop stale Ask so Allow cannot
          // hit a torn-down oneshot after the modal was left open.
          ...(shouldDismissAskOnDisconnect(ev.payload.connected)
            ? { permission: null }
            : {}),
          ...(loadFailed ? { savedSessionId: null, recoveryRequired: true } : {}),
        });
      }),
    );
    return () => {
      unsubs.forEach((u) => u());
    };
  },
}));
