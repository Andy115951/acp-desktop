import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MessageComposer } from "../MessageComposer";
const props = {
  draft: "next message", locale: "en" as const, disabled: false, working: false,
  permissionOpen: false, canSend: true, canCancel: false, connected: true,
  agentName: "Codex", placeholder: "Message Codex…", onDraftChange: () => {},
  onSend: async () => {}, onCancel: async () => {},
};
describe("conversation composer states", () => {
  it("keeps the draft editable while work runs and exposes Stop instead of another Send", () => {
    const html = renderToStaticMarkup(createElement(MessageComposer, { ...props, working: true, canSend: false, canCancel: true }));
    expect(html).not.toMatch(/<textarea[^>]*disabled/);
    expect(html).toContain("next message");
    expect(html).toContain("Keep writing your next message");
    expect(html).toContain('class="stop-button"');
    expect(html).not.toContain('class="send-button"');
  });
  it("keeps the composer locked while a permission decision owns the interaction", () => {
    const html = renderToStaticMarkup(createElement(MessageComposer, { ...props, disabled: true, permissionOpen: true, canSend: false, canCancel: true }));
    expect(html).toMatch(/<textarea[^>]*disabled/);
    expect(html).not.toContain("Keep writing your next message");
  });
  it("uses localized composing help while configuration or a reply is in progress", () => {
    const html = renderToStaticMarkup(createElement(MessageComposer, { ...props, locale: "zh-CN", working: true, canSend: false }));
    expect(html).toContain("可以继续准备下一条消息");
    expect(html).toMatch(/<button[^>]*class="send-button"[^>]*disabled/);
  });
});
