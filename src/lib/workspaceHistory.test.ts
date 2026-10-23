import { describe, expect, it } from "vitest";
import { readWorkspaceHistory, visitWorkspace, WORKSPACE_HISTORY_LIMIT } from "./workspaceHistory";

describe("recent workspace metadata", () => {
  it("migrates the last folder without inventing an opening time", () => {
    expect(readWorkspaceHistory(null, "/path with spaces/中文")).toEqual({ version: 1, workspaces: [{ cwd: "/path with spaces/中文", lastOpenedAt: 0 }] });
    expect(readWorkspaceHistory(null, "relative").workspaces).toEqual([]);
  });
  it("keeps visits unique, most-recent first and bounded", () => {
    let history = readWorkspaceHistory(null, "/legacy");
    for (let index = 0; index < 30; index++) history = visitWorkspace(history, `/folder-${index}`, index + 1);
    history = visitWorkspace(history, "/folder-15", 40);
    expect(history.workspaces).toHaveLength(WORKSPACE_HISTORY_LIMIT);
    expect(history.workspaces[0].cwd).toBe("/folder-15");
    expect(history.workspaces.filter((entry) => entry.cwd === "/folder-15")).toHaveLength(1);
    expect(history.workspaces.some((entry) => entry.cwd === "/legacy")).toBe(false);
  });
  it("rejects unknown schemas and relative visits; filters invalid stored records", () => {
    expect(() => readWorkspaceHistory({ version: 2, workspaces: [] }, "/old")).toThrow();
    expect(() => visitWorkspace(readWorkspaceHistory(null, null), "relative", 0)).toThrow();
    expect(readWorkspaceHistory({ version: 1, workspaces: [null, { cwd: "bad", lastOpenedAt: 2 }, { cwd: "/good", lastOpenedAt: 1 }, { cwd: "/good", lastOpenedAt: 2 }] }, null).workspaces).toEqual([{ cwd: "/good", lastOpenedAt: 1 }]);
  });
});
