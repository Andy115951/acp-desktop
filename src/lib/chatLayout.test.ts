import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SessionHistory } from "../SessionHistory";
import { ChatTranscript } from "../ChatTranscript";
import type { SessionCatalog } from "./sessionCatalog";

const base = { cwd: "/workspace", createdAt: 1, updatedAt: 1, unavailable: false };
const catalog: SessionCatalog = { version: 1, sessions: [
  { ...base, sessionId: "one", title: "First conversation" },
  { ...base, sessionId: "two", title: "<script>literal title</script>" },
  { ...base, sessionId: "foreign", title: "Other workspace", cwd: "/other" },
  { ...base, sessionId: "archived", title: "Archived conversation", archivedAt: 2 },
] };

describe("conversation sidebar", () => {
  it("renders current-workspace session rows, marks selection and escapes agent titles", () => {
    const html = renderToStaticMarkup(createElement(SessionHistory, {
      catalog, cwd: "/workspace", savedSessionId: "two", disabled: false, failed: false,
      locale: "en", variant: "list", onSelect: () => {},
    }));
    expect(html).toContain("First conversation");
    expect(html).toContain('aria-current="true"');
    expect(html).toContain("&lt;script&gt;literal title&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("Other workspace");
    expect(html).not.toContain("Archived conversation");
    expect(html).not.toContain("<select");
  });
  it("keeps session rows disabled while the connection locks context changes", () => {
    const html = renderToStaticMarkup(createElement(SessionHistory, {
      catalog, cwd: "/workspace", savedSessionId: "one", disabled: true, failed: false,
      locale: "zh-CN", variant: "list", onSelect: () => {},
    }));
    expect(html.match(/<button[^>]*disabled=""/g)).toHaveLength(2);
    expect(html).toContain("已保存的会话");
  });
});

describe("conversation empty state", () => {
  it("shows welcome content only without messages or a permission child", () => {
    const render = (lines: {id: string; kind: string; text: string}[], child?: string) =>
      renderToStaticMarkup(createElement(ChatTranscript, {
        lines, locale: "en", resetKey: "fixture", fill: true,
        emptyState: createElement("h2", null, "Welcome"), agentName: "Test agent",
      }, child));
    expect(render([])).toContain("Welcome");
    expect(render([], "Permission requested")).not.toContain("Welcome");
    const html = render([{ id: "one", kind: "agent_message", text: "A reply" }]);
    expect(html).toContain("Test agent");
    expect(html).toContain("A reply");
    expect(html).not.toContain("Welcome");
  });
});
