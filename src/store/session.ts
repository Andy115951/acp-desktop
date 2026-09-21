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
  PREFS_KEY_SESSION_BY_CWD,
  isPlausibleCwd,
  isSessionLoadFailedError,
  removeSessionByCwd,
  upsertSessionByCwd,
  type SessionByCwd,
} from "../lib/sessionPrefs";

export type StreamLine = {
  id: string;
  kind: string;
  text: string;
};

export type PermissionRequest = {
  requestId: number;
  title: string;
  detail: string;
  options: { id: string; name: string; kind: string }[];
};

const PREFS_FILE = "prefs.json";

let prefsStore: Store | null = null;

async function getPrefsStore(): Promise<Store> {
  if (!prefsStore) {
    prefsStore = await Store.load(PREFS_FILE);
  }
  return prefsStore;
}

async function loadSavedSessionId(cwd: string): Promise<string | null> {
  try {
    const store = await getPrefsStore();
    const map = (await store.get<SessionByCwd>(PREFS_KEY_SESSION_BY_CWD)) ?? {};
    return map[cwd] ?? null;
  } catch {
    return null;
  }
}

async function saveSessionPrefs(cwd: string, sessionId: string): Promise<void> {
  try {
    const store = await getPrefsStore();
    const map = (await store.get<SessionByCwd>(PREFS_KEY_SESSION_BY_CWD)) ?? {};
    await store.set(
      PREFS_KEY_SESSION_BY_CWD,
      upsertSessionByCwd(map, cwd, sessionId),
    );
    await store.save();
  } catch {
    // Prefs are best-effort; never block the session on store failure.
  }
}

async function clearSavedSessionId(cwd: string): Promise<void> {
  try {
    const store = await getPrefsStore();
    const map = (await store.get<SessionByCwd>(PREFS_KEY_SESSION_BY_CWD)) ?? {};
    const next = removeSessionByCwd(map, cwd);
    if (next === map) return;
    await store.set(PREFS_KEY_SESSION_BY_CWD, next);
    await store.save();
  } catch {
    // Prefs are best-effort.
  }
}

async function saveLastCwd(cwd: string): Promise<void> {
  try {
    const store = await getPrefsStore();
    await store.set(PREFS_KEY_LAST_CWD, cwd);
    await store.save();
  } catch {
    // Prefs are best-effort.
  }
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

type SessionState = {
  cwd: string | null;
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
  connect: (mode?: "new" | "resume") => Promise<void>;
  disconnect: () => Promise<void>;
  send: () => Promise<void>;
  cancel: () => Promise<void>;
  respondPermission: (optionId: string | null) => Promise<void>;
  clearTranscript: () => void;
  bindEvents: () => Promise<() => void>;
};

let lineCounter = 0;

export const useSessionStore = create<SessionState>((set, get) => ({
  cwd: null,
  connected: false,
  busy: false,
  error: null,
  sessionId: null,
  savedSessionId: null,
  loadSessionSupported: null,
  lines: [],
  permission: null,
  draft: "",
  setDraft: (v) => set({ draft: v }),
  clearTranscript: () => set({ lines: [] }),
  pickFolder: async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      const savedSessionId = await loadSavedSessionId(selected);
      set({
        cwd: selected,
        error: null,
        savedSessionId,
        sessionId: null,
        loadSessionSupported: null,
      });
      void saveLastCwd(selected);
    }
  },
  hydrateFromPrefs: async () => {
    // Best-effort restore so Resume/Connect work after relaunch.
    if (get().cwd) return;
    const lastCwd = await loadLastCwd();
    if (!lastCwd) return;
    const savedSessionId = await loadSavedSessionId(lastCwd);
    // Bail if the user picked a folder while we were reading prefs.
    if (get().cwd) return;
    set({
      cwd: lastCwd,
      savedSessionId,
      error: null,
    });
  },
  connect: async (mode = "new") => {
    const cwd = get().cwd;
    if (!cwd) {
      set({ error: "Pick a workspace folder first." });
      return;
    }
    // Host now awaits handshake, but still guard double-clicks while busy /
    // already connected so we never stack a second connect_agent.
    if (get().busy || get().connected) {
      return;
    }
    const resumeSessionId =
      mode === "resume" ? get().savedSessionId ?? undefined : undefined;
    if (mode === "resume" && !resumeSessionId) {
      set({ error: "No saved session for this folder." });
      return;
    }
    if (mode === "resume" && get().loadSessionSupported === false) {
      set({
        error:
          "Agent does not advertise loadSession; Resume is unavailable. Use New session.",
      });
      return;
    }
    set({
      error: null,
      busy: true,
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
    try {
      const agentId = useAgentsStore.getState().selectedAgentId || "grok";
      await invoke("connect_agent", {
        agentId,
        cwd,
        resumeSessionId: resumeSessionId ?? null,
      });
      // connected / sessionId / replay lines come from acp://status + acp://stream
      set({ busy: false });
    } catch (e) {
      set({
        connected: false,
        busy: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },
  disconnect: async () => {
    try {
      await invoke("disconnect_agent");
    } finally {
      set({
        connected: false,
        busy: false,
        sessionId: null,
        permission: null,
      });
    }
  },
  send: async () => {
    const text = get().draft.trim();
    if (!text) return;
    // Ask modal owns the turn; never queue a second prompt underneath it.
    if (get().permission || !get().connected || get().busy) return;
    set({
      draft: "",
      busy: true,
      error: null,
      lines: [
        ...get().lines,
        { id: `u-${++lineCounter}`, kind: "user", text },
      ],
    });
    try {
      const stop = await invoke<string>("send_prompt", { text });
      set({
        busy: false,
        lines: [
          ...get().lines,
          { id: `stop-${++lineCounter}`, kind: "stop", text: `stop: ${stop}` },
        ],
      });
    } catch (e) {
      set({
        busy: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  },
  cancel: async () => {
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
    try {
      await invoke("respond_permission", {
        requestId: perm.requestId,
        optionId,
      });
      set({ permission: null });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // Cancel / Disconnect already cleared the host oneshot — dismiss quietly.
      if (isNoPendingPermissionError(message)) {
        set({ permission: null });
        return;
      }
      // Stale id: host kept the real Ask — leave modal up, no red banner.
      if (isStalePermissionError(message)) {
        return;
      }
      set({ error: message });
    }
  },
  bindEvents: async () => {
    const unsubs: UnlistenFn[] = [];
    unsubs.push(
      await listen<{ kind: string; text: string }>("acp://stream", (ev) => {
        // Functional update avoids lost lines when multiple stream events
        // arrive back-to-back (e.g. session/load replay + follow-ups).
        set((state) => ({
          lines: [
            ...state.lines,
            {
              id: `s-${++lineCounter}`,
              kind: ev.payload.kind,
              text: ev.payload.text,
            },
          ],
        }));
      }),
    );
    unsubs.push(
      await listen<{
        requestId: number;
        title: string;
        detail: string;
        options: { id: string; name: string; kind: string }[];
      }>("acp://permission", (ev) => {
        set({
          permission: {
            requestId: ev.payload.requestId,
            title: ev.payload.title,
            detail: ev.payload.detail,
            options: ev.payload.options,
          },
        });
      }),
    );
    unsubs.push(
      await listen<{
        connected: boolean;
        cwd?: string | null;
        sessionId?: string | null;
        busy: boolean;
        error?: string | null;
        loadSessionSupported?: boolean | null;
      }>("acp://status", (ev) => {
        const cwd = ev.payload.cwd ?? get().cwd;
        const sessionId = ev.payload.sessionId ?? null;
        const loadSessionSupported =
          ev.payload.loadSessionSupported ?? get().loadSessionSupported;

        if (
          ev.payload.connected &&
          sessionId &&
          cwd &&
          !ev.payload.error
        ) {
          void saveSessionPrefs(cwd, sessionId).then(() => {
            set({ savedSessionId: sessionId });
          });
        }

        // Corrupt / unknown resume id: drop the stale prefs entry so Resume
        // does not keep failing; New session remains available.
        const loadFailed =
          !!ev.payload.error && isSessionLoadFailedError(ev.payload.error);
        if (loadFailed && cwd) {
          void clearSavedSessionId(cwd).then(() => {
            set({ savedSessionId: null });
          });
        }

        set({
          connected: ev.payload.connected,
          cwd: cwd ?? get().cwd,
          sessionId: sessionId ?? (ev.payload.connected ? get().sessionId : null),
          busy: ev.payload.busy,
          error: ev.payload.error ?? null,
          loadSessionSupported,
          // Agent exit / Disconnect via status: drop stale Ask so Allow cannot
          // hit a torn-down oneshot after the modal was left open.
          ...(shouldDismissAskOnDisconnect(ev.payload.connected)
            ? { permission: null }
            : {}),
          ...(loadFailed ? { savedSessionId: null } : {}),
        });
      }),
    );
    return () => {
      unsubs.forEach((u) => u());
    };
  },
}));
