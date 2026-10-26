import { describe, expect, it } from "vitest";
import { parseLaunchFields } from "./customAgents";
import { sessionCatalogKey, readSessionCatalog, rememberSession } from "./sessionCatalog";
import { mergeSessionMetadata } from "./sessionMetadata";
import { resumeIdForAgent } from "./agentSwitch";

describe("custom launch fields", () => {
  it("preserves spaces, empty arguments and shell-looking text as literal data", () => {
    const args = ["two words", "", "$(touch /tmp/nope)", "'quotes'", "NAME=value"];
    expect(parseLaunchFields(JSON.stringify(args), '{"PROFILE":"$HOME/a b"}')).toEqual({ args, env: { PROFILE: "$HOME/a b" } });
  });
  it("rejects non-string or unstructured arguments and environment without echoing values", () => {
    for (const [args, env] of [['"secret"', '{}'], ['[1]', '{}'], ['[]', 'null'], ['[]', '[]'], ['[]', '{"key":9}']]) {
      expect(() => parseLaunchFields(args, env)).toThrow("Invalid launch fields");
    }
  });
  it("keeps custom agents and built-ins separate even when their executable and session ID match", () => {
    const first = "custom-735c7f1b-aa34-4a24-bc43-dda44a4ff160";
    const second = "custom-735c7f1b-aa34-4a24-bc43-dda44a4ff161";
    const ids = [first, second, "grok"];
    const catalogs = new Map(ids.map((id) => [sessionCatalogKey(id), readSessionCatalog(null, {})]));
    catalogs.set(sessionCatalogKey(first), rememberSession(catalogs.get(sessionCatalogKey(first))!, "/workspace", "same-id", 1));
    expect(catalogs.get(sessionCatalogKey(second))!.sessions).toEqual([]);
    expect(catalogs.get(sessionCatalogKey("grok"))!.sessions).toEqual([]);
    expect(resumeIdForAgent(second, "/workspace", (key) => key === `${first}.sessionByCwd` ? { "/workspace": "same-id" } : null)).toBeNull();
    expect(mergeSessionMetadata({ agentId: first, cwd: "/workspace", sessionId: "same-id", commands: [{ name: "review", description: "", inputHint: null }] },
      { agentId: second, cwd: "/workspace", sessionId: "same-id", usage: { used: "1", size: "2" } }).commands).toBeUndefined();
  });
});
