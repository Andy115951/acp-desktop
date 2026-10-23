import { isPlausibleCwd } from "./sessionPrefs";

export const WORKSPACE_HISTORY_KEY = "recentWorkspaces.v1";
export const WORKSPACE_HISTORY_LIMIT = 20;
export type RecentWorkspace = { cwd: string; lastOpenedAt: number };
export type WorkspaceHistory = { version: 1; workspaces: RecentWorkspace[] };

export function readWorkspaceHistory(value: unknown, lastCwd: unknown): WorkspaceHistory {
  if (value == null) return { version: 1, workspaces: isPlausibleCwd(lastCwd) ? [{ cwd: lastCwd, lastOpenedAt: 0 }] : [] };
  if (typeof value !== "object" || !("version" in value) || value.version !== 1 ||
      !("workspaces" in value) || !Array.isArray(value.workspaces)) throw new Error("Unsupported workspace history");
  const workspaces: RecentWorkspace[] = [];
  for (const entry of value.workspaces) {
    if (!entry || !isPlausibleCwd(entry.cwd) || typeof entry.lastOpenedAt !== "number" ||
        !Number.isFinite(entry.lastOpenedAt) || entry.lastOpenedAt < 0 || workspaces.some((item) => item.cwd === entry.cwd)) continue;
    workspaces.push({ cwd: entry.cwd, lastOpenedAt: entry.lastOpenedAt });
  }
  return { version: 1, workspaces: workspaces.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt).slice(0, WORKSPACE_HISTORY_LIMIT) };
}

export function visitWorkspace(history: WorkspaceHistory, cwd: string, now: number): WorkspaceHistory {
  if (!isPlausibleCwd(cwd)) throw new Error("Workspace must be an absolute path");
  return { version: 1, workspaces: [{ cwd, lastOpenedAt: now }, ...history.workspaces.filter((entry) => entry.cwd !== cwd)]
    .slice(0, WORKSPACE_HISTORY_LIMIT) };
}
