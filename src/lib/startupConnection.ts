import { canConnectSelectedAgent } from "./sessionUiGates";
import { getAgentSelectionRevision, useAgentsStore } from "../store/agents";
import { getStartupInterventionRevision, useSessionStore } from "../store/session";
import { useUiStore } from "../store/ui";

/** Bind events before starting a connection, and never override a user's startup actions. */
export async function prepareStartup(isCancelled: () => boolean, onBound: (cleanup: () => void) => void, onRestored: (id: string) => void = () => {}): Promise<void> {
  const agentRevision = getAgentSelectionRevision();
  const sessionRevision = getStartupInterventionRevision();
  const cleanup = await useSessionStore.getState().bindEvents();
  if (isCancelled()) { cleanup(); return; }
  onBound(cleanup);
  try {
    await useAgentsStore.getState().refresh();
    if (isCancelled()) return;
    if (agentRevision === getAgentSelectionRevision()) onRestored(useAgentsStore.getState().selectedAgentId);
    await useSessionStore.getState().hydrateFromPrefs();
    if (isCancelled() || !useUiStore.getState().autoConnect || agentRevision !== getAgentSelectionRevision()
      || sessionRevision !== getStartupInterventionRevision()) return;
    const agent = useAgentsStore.getState();
    const session = useSessionStore.getState();
    const selected = agent.agents.find(item => item.id === agent.selectedAgentId);
    const fake = !agent.selectedAgentId.startsWith("custom-") && !!agent.override?.usingOverride;
    if (!agent.restoredAgentId || agent.restoredAgentId !== agent.selectedAgentId || agent.loading || agent.error
      || agent.customEditing || !canConnectSelectedAgent(selected?.connectable, selected?.available, fake)
      || !session.cwd || session.switching || session.connected || session.busy || session.connecting
      || session.submitting || session.configuring || session.permission || session.draft || session.recoveryRequired
      || session.draftTarget?.agentId !== agent.selectedAgentId || session.draftTarget.cwd !== session.cwd) return;
    void session.connect(session.savedSessionId ? "resume" : "new");
  } catch (error) {
    throw error;
  }
}
