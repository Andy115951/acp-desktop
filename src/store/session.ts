import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";

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

type SessionState = {
  cwd: string | null;
  connected: boolean;
  busy: boolean;
  error: string | null;
  sessionId: string | null;
  lines: StreamLine[];
  permission: PermissionRequest | null;
  draft: string;
  setDraft: (v: string) => void;
  pickFolder: () => Promise<void>;
  connect: () => Promise<void>;
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
  lines: [],
  permission: null,
  draft: "",
  setDraft: (v) => set({ draft: v }),
  clearTranscript: () => set({ lines: [] }),
  pickFolder: async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") {
      set({ cwd: selected, error: null });
    }
  },
  connect: async () => {
    const cwd = get().cwd;
    if (!cwd) {
      set({ error: "Pick a workspace folder first." });
      return;
    }
    set({ error: null, busy: true });
    try {
      await invoke("connect_grok", { cwd });
      set({ connected: true, busy: false });
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
      await invoke("disconnect_grok");
    } finally {
      set({ connected: false, busy: false, sessionId: null, permission: null });
    }
  },
  send: async () => {
    const text = get().draft.trim();
    if (!text) return;
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
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },
  bindEvents: async () => {
    const unsubs: UnlistenFn[] = [];
    unsubs.push(
      await listen<{ kind: string; text: string }>("acp://stream", (ev) => {
        set({
          lines: [
            ...get().lines,
            {
              id: `s-${++lineCounter}`,
              kind: ev.payload.kind,
              text: ev.payload.text,
            },
          ],
        });
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
      }>("acp://status", (ev) => {
        set({
          connected: ev.payload.connected,
          cwd: ev.payload.cwd ?? get().cwd,
          sessionId: ev.payload.sessionId ?? get().sessionId,
          busy: ev.payload.busy,
          error: ev.payload.error ?? null,
        });
      }),
    );
    return () => {
      unsubs.forEach((u) => u());
    };
  },
}));
