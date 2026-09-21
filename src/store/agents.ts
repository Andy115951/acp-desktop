import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export type AgentInfo = {
  id: string;
  name: string;
  binary: string;
  available: boolean;
  /** Host can connect_agent this id (false for M4 placeholders). */
  connectable: boolean;
};

export type AgentOverride = {
  mode: string;
  command: string[];
  usingOverride: boolean;
  fakeAgentPath: string | null;
};

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
      const [agents, override] = await Promise.all([
        invoke<AgentInfo[]>("detect_agents"),
        invoke<AgentOverride>("get_agent_override"),
      ]);
      const selected = get().selectedAgentId;
      const stillValid = agents.some((a) => a.id === selected);
      set({
        agents,
        override,
        loading: false,
        selectedAgentId: stillValid ? selected : "grok",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message, loading: false });
    }
  },
  selectAgent: (id) => {
    const agent = get().agents.find((a) => a.id === id);
    // Only select connectable agents (or leave selection if list empty / unknown).
    if (agent && !agent.connectable) return;
    set({ selectedAgentId: id });
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
