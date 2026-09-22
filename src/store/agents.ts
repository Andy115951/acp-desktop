import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { Store } from "@tauri-apps/plugin-store";
import { PREFS_KEY_SELECTED_AGENT } from "../lib/sessionPrefs";
import {
  canSelectAgentId,
  pickConnectableAgentId,
} from "../lib/agentSwitch";

export type AgentInfo = {
  id: string;
  name: string;
  binary: string;
  available: boolean;
  /** Host can connect_agent this id (false for unwired placeholders). */
  connectable: boolean;
};

export type AgentOverride = {
  mode: string;
  command: string[];
  usingOverride: boolean;
  fakeAgentPath: string | null;
};

const PREFS_FILE = "prefs.json";
let prefsStore: Store | null = null;

async function getPrefsStore(): Promise<Store> {
  if (!prefsStore) {
    prefsStore = await Store.load(PREFS_FILE);
  }
  return prefsStore;
}

async function loadSelectedAgentId(): Promise<string | null> {
  try {
    const store = await getPrefsStore();
    const value = await store.get<unknown>(PREFS_KEY_SELECTED_AGENT);
    return typeof value === "string" && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

async function saveSelectedAgentId(id: string): Promise<void> {
  try {
    const store = await getPrefsStore();
    await store.set(PREFS_KEY_SELECTED_AGENT, id);
    await store.save();
  } catch {
    // Prefs are best-effort.
  }
}

type AgentsState = {
  agents: AgentInfo[];
  /** Selected agent id for connect_agent (default grok). */
  selectedAgentId: string;
  loading: boolean;
  error: string | null;
  override: AgentOverride | null;
  refresh: () => Promise<void>;
  selectAgent: (id: string) => void;
  setFakeAgent: (enabled: boolean) => Promise<void>;
};

export const useAgentsStore = create<AgentsState>((set, get) => ({
  agents: [],
  selectedAgentId: "grok",
  loading: false,
  error: null,
  override: null,
  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const [agents, override, savedId] = await Promise.all([
        invoke<AgentInfo[]>("detect_agents"),
        invoke<AgentOverride>("get_agent_override"),
        loadSelectedAgentId(),
      ]);
      const preferred = savedId ?? get().selectedAgentId;
      set({
        agents,
        override,
        loading: false,
        selectedAgentId: pickConnectableAgentId(agents, preferred),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message, loading: false });
    }
  },
  selectAgent: (id) => {
    // Only select connectable agents (or leave selection if list empty / unknown).
    if (!canSelectAgentId(get().agents, id)) return;
    if (get().selectedAgentId === id) return;
    set({ selectedAgentId: id });
    void saveSelectedAgentId(id);
  },
  setFakeAgent: async (enabled) => {
    set({ error: null });
    try {
      const override = await invoke<AgentOverride>("set_fake_agent", {
        enabled,
      });
      set({ override });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message });
      throw err;
    }
  },
}));
