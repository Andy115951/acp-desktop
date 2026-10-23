import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownMessage, safeWebUrl } from "../MarkdownMessage";
import { ToolCard } from "../ToolCard";
import { appendStreamLine, recordToolDecision, type StreamLine } from "./transcript";

describe("safe conversation Markdown", () => {
  it("renders GFM and fenced code, with code/message content kept as literal text", () => {
    const html = renderToStaticMarkup(createElement(MarkdownMessage, { locale: "en", text:
      '## Heading\n\n**bold**\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n```html\n<script>literal</script>\n```' }));
    expect(html).toContain("<h2>Heading</h2>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<table>");
    expect(html).toContain("&lt;script&gt;literal&lt;/script&gt;");
    expect(html).toContain("Copy code");
  });
  it("blocks executable/local links, raw HTML, and remote image loads", () => {
    const html = renderToStaticMarkup(createElement(MarkdownMessage, { locale: "en", text:
      '[web](https://example.com) [bad](javascript:alert%281%29) [file](file:///tmp/test) ![remote](https://example.com/track.png)\n\n<script>alert(1)</script>\n<iframe src="https://example.com"></iframe>' }));
    expect(html).toContain('href="https://example.com/"');
    for (const unsafe of ['href="javascript:', 'href="file:', '<script', '<iframe', '<img', 'track.png']) {
      expect(html).not.toContain(unsafe);
    }
  });
  it.each(["javascript:alert(1)", "data:text/html,bad", "file:///tmp/test", "//example.com", "/local", "https://user:secret@example.com"])("rejects %s", (url) => {
    expect(safeWebUrl(url)).toBeUndefined();
  });
});

describe("tool lifecycle", () => {
  const initial: StreamLine = { id: "tool-row", kind: "tool_call", text: "Edit file", tool: {
    id: "call-1", title: "Edit file", status: "Pending", rawInput: { command: "echo hello" },
    locations: [{ path: "/workspace/file.ts", line: 3 }],
  } };
  it("updates one stable card, retaining absent fields and replacing supplied collections", () => {
    let lines = appendStreamLine([], initial);
    lines = recordToolDecision(lines, "call-1", "allowed");
    lines = appendStreamLine(lines, { id: "update", kind: "tool_call_update", text: "done", tool: {
      id: "call-1", status: "Completed", content: [{ type: "content", content: { type: "text", text: "output" } }],
    } });
    expect(lines).toHaveLength(1);
    expect(lines[0].id).toBe("tool-row");
    expect(lines[0].tool).toMatchObject({ ...initial.tool, status: "Completed", decision: "allowed" });
    lines = appendStreamLine(lines, { id: "clear", kind: "tool_call_update", text: "", tool: { id: "call-1", content: [] } });
    expect(lines[0].tool?.content).toEqual([]);
  });
  it("handles updates before the initial notification and ignores null patch fields", () => {
    let lines = appendStreamLine([], { ...initial, tool: { id: "call-1", status: "InProgress" } });
    lines = appendStreamLine(lines, initial);
    lines = appendStreamLine(lines, { id: "partial", kind: "tool_call_update", text: "", tool: JSON.parse('{"id":"call-1","title":null,"rawInput":null,"status":"Completed"}') });
    expect(lines[0].tool?.title).toBe("Edit file");
    expect(lines[0].tool?.rawInput).toEqual({ command: "echo hello" });
  });
  it("does not merge across turns and seals text when an earlier tool gets updated", () => {
    let lines = appendStreamLine([], initial);
    lines = appendStreamLine(lines, { id: "text1", kind: "agent_message", text: "Before" });
    lines = appendStreamLine(lines, { ...initial, id: "update", tool: { id: "call-1", status: "Completed" } });
    lines = appendStreamLine(lines, { id: "text2", kind: "agent_message", text: "After" });
    lines = appendStreamLine(lines, { id: "stop", kind: "stop", text: "EndTurn" });
    lines = appendStreamLine(lines, initial);
    expect(lines.filter((line) => line.tool)).toHaveLength(2);
    expect(lines.filter((line) => line.kind === "agent_message").map((line) => line.text)).toEqual(["Before", "After"]);
  });
  it("keeps cancellation history, localizes statuses, and escapes tool output", () => {
    const lines = recordToolDecision(appendStreamLine([], initial), "call-1", "cancelled");
    const html = renderToStaticMarkup(createElement(ToolCard, { locale: "zh-CN", tool: { ...lines[0].tool!, rawOutput: "<script>bad</script>" } }));
    expect(html).toContain("已取消");
    expect(html).toContain("echo hello");
    expect(html).toContain("/workspace/file.ts:3");
    expect(html).toContain("&lt;script&gt;bad&lt;/script&gt;");
  });
});
