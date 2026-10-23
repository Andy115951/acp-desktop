import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentSessionInfo } from "../AgentSessionInfo";
import { mergeSessionMetadata, type SessionMetadata } from "./sessionMetadata";

const metadata: SessionMetadata = { agentId: "a", cwd: "/one", sessionId: "s", commands: [{ name: "review", description: "<script>untrusted</script>", inputHint: "files" }] };
describe("session metadata presentation", () => {
  it("does not carry reports across different sessions, agents or workspaces", () => {
    for (const patch of [{ sessionId: "other" }, { agentId: "other" }, { cwd: "/other" }]) {
      expect(mergeSessionMetadata(metadata, { agentId: "a", cwd: "/one", sessionId: "s", ...patch, usage: { used: "1", size: "2" } }).commands).toBeUndefined();
    }
  });
  it("distinguishes missing information from an explicitly empty command report", () => {
    const unknown = renderToStaticMarkup(createElement(AgentSessionInfo, { metadata: null, locale: "en", disabled: false, onCommand: () => {} }));
    expect(unknown).toContain("Context usage has not been reported");
    expect(unknown).toContain("Commands have not been reported");
    expect(unknown).not.toContain("0 /");
    const empty = renderToStaticMarkup(createElement(AgentSessionInfo, { metadata: { ...metadata, commands: [] }, locale: "zh-CN", disabled: true, onCommand: () => {} }));
    expect(empty).toContain("当前没有可用命令");
  });
  it("escapes provider text and renders exact counts with disabled insertion", () => {
    const html = renderToStaticMarkup(createElement(AgentSessionInfo, { metadata: { ...metadata, usage: { used: "0", size: "18446744073709551615" } }, locale: "en", disabled: true, onCommand: () => {} }));
    expect(html).toContain("0 / 18446744073709551615 tokens");
    expect(html).toContain('aria-label="Insert /review"');
    expect(html).toContain('disabled=""');
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("USD");
  });
});
