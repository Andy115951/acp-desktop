import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatTranscript } from "../ChatTranscript";
import { appendStreamLine, sealTranscript, isNearTranscriptBottom, type StreamLine } from "./transcript";

function event(id: string, kind: string, text: string): StreamLine {
  return { id, kind, text };
}

describe("ACP conversation assembly", () => {
  it("joins exact text and retains one stable message identity over a long stream", () => {
    const chunks = Array.from({ length: 5000 }, (_, i) => i % 2 ? "中文\n" : " hello 🦊 ");
    let lines: StreamLine[] = [];
    chunks.forEach((text, i) => { lines = appendStreamLine(lines, event(`${i}`, "agent_message", text)); });
    expect(lines).toHaveLength(1);
    expect(lines[0].id).toBe("0");
    expect(lines[0].text).toBe(chunks.join(""));
  });

  it("keeps thought, reply, tool, result and turn boundaries in order", () => {
    const sequence = [
      ["user", "go"], ["agent_thought", "think"], ["agent_thought", "ing"],
      ["agent_message", "Before"], ["tool_call", "run"], ["tool_call_update", "done"],
      ["agent_message", "After"], ["stop", "EndTurn"], ["user", "next"],
      ["agent_message", "Second turn"],
    ];
    const lines = sequence.reduce((all, [kind, text], i) => appendStreamLine(all, event(`${i}`, kind, text)), [] as StreamLine[]);
    expect(lines.map(({ kind, text }) => [kind, text])).toEqual([
      ["user", "go"], ["agent_thought", "thinking"], ["agent_message", "Before"],
      ["tool_call", "run"], ["tool_call_update", "done"], ["agent_message", "After"],
      ["stop", "EndTurn"], ["user", "next"], ["agent_message", "Second turn"],
    ]);
  });

  it("seals messages at permission/disconnect boundaries even without a tool notification", () => {
    const before = appendStreamLine([], event("a", "agent_message", "Before"));
    const sealed = sealTranscript(before);
    const after = appendStreamLine(sealed, event("b", "agent_message", "After"));
    expect(before[0].streaming).toBe(true);
    expect(after.map(({ text }) => text)).toEqual(["Before", "After"]);
  });

  it("aggregates replay chunks without mixing user and assistant messages", () => {
    const lines = [
      event("1", "user_message", "a\n"), event("2", "user_message", "b"),
      event("3", "agent_message", "c"), event("4", "agent_message", "d"),
      event("5", "user_message", "next"),
    ].reduce(appendStreamLine, [] as StreamLine[]);
    expect(lines.map(({ text }) => text)).toEqual(["a\nb", "cd", "next"]);
  });
});

describe("conversation presentation", () => {
  it("renders one assistant article for chunks, escapes vendor HTML, and localizes app labels", () => {
    const lines = appendStreamLine(appendStreamLine([], event("1", "agent_message", "<script>")), event("2", "agent_message", "alert(1)</script>"));
    const markup = renderToStaticMarkup(createElement(ChatTranscript, { lines, locale: "zh-CN", resetKey: "a" }));
    expect(markup.match(/<article/g)).toHaveLength(1);
    expect(markup).toContain("助手");
    expect(markup).not.toContain("alert(1)");
    expect(markup).not.toContain("<script>");
  });

  it("only follows output when near the bottom", () => {
    expect(isNearTranscriptBottom(760, 1000, 240)).toBe(true);
    expect(isNearTranscriptBottom(735, 1000, 240)).toBe(true);
    expect(isNearTranscriptBottom(120, 1000, 240)).toBe(false);
  });
});
