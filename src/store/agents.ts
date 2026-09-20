import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export type AgentInfo = {
  id: string;
  name: string;
  binary: string;
  available: boolean;
};

type AgentsState = {
  agents: AgentInfo[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

export const useAgentsStore = create<AgentsState>((set) => ({
  agents: [],
  loading: false,
  error: null,
  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const agents = await invoke<AgentInfo[]>("detect_agents");
      set({ agents, loading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message, loading: false });
    }
  },
}));
