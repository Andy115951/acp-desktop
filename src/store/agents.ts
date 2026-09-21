import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export type AgentInfo = {
  id: string;
  name: string;
  binary: string;
  available: boolean;
};

export type AgentOverride = {
  mode: string;
  command: string[];
  usingOverride: boolean;
  fakeAgentPath: string | null;
};

type AgentsState = {
  agents: AgentInfo[];
  loading: boolean;
  error: string | null;
  override: AgentOverride | null;
  refresh: () => Promise<void>;
  setFakeAgent: (enabled: boolean) => Promise<void>;
};

export const useAgentsStore = create<AgentsState>((set) => ({
  agents: [],
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
      set({ agents, override, loading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message, loading: false });
    }
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
