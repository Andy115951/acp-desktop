import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SessionHistory } from "../SessionHistory";
import { readSessionCatalog, rememberSession } from "./sessionCatalog";
import { WorkspacePicker } from "../WorkspacePicker";

describe("saved session picker", () => {
  const catalog = rememberSession(readSessionCatalog(null, { "/one": "first", "/two": "other-workspace" }), "/one", "second", 1);
  it("shows only the workspace's IDs and marks the selected one", () => {
    const html = renderToStaticMarkup(createElement(SessionHistory, {
      catalog, cwd: "/one", savedSessionId: "first", disabled: false, failed: false, locale: "en", onSelect: () => {},
    }));
    expect(html).toContain('value="first" selected=""');
    expect(html).toContain('value="second"');
    expect(html).not.toContain("other-workspace");
    expect(html).toContain("Sessions known to this app");
  });
  it("localizes disabled, empty and storage-failure states", () => {
    const html = renderToStaticMarkup(createElement(SessionHistory, {
      catalog, cwd: "/empty", savedSessionId: null, disabled: true, failed: true, locale: "zh-CN", onSelect: () => {},
    }));
    expect(html).toContain('disabled=""');
    expect(html).toContain("此工作区暂无保存的会话");
    expect(html).toContain("请先断开连接");
    expect(html).toContain('role="alert"');
    expect(html).toContain("无法读取或保存会话元数据");
  });
  it("shows archives separately with a restore action and no vendor-delete action", () => {
    const html = renderToStaticMarkup(createElement(SessionHistory, {
      catalog: { version: 1, sessions: [{ ...catalog.sessions[0], title: "Archived name", archivedAt: 1 }] },
      cwd: "/one", savedSessionId: null, disabled: false, failed: false, locale: "en", onSelect: () => {},
      onRename: async () => true, onArchive: async () => true, onRestore: async () => true,
    }));
    expect(html).toContain("No saved sessions for this workspace");
    expect(html).toContain("Archived sessions (1)");
    expect(html).toContain("Restore Archived name");
    expect(html).toContain("conversation history stays intact");
    expect(html).not.toContain("Delete");
  });
  it("distinguishes advertised, unsupported and incomplete discovery", () => {
    const props = { catalog, cwd: "/one", savedSessionId: "first", disabled: false, failed: false, locale: "en" as const, onSelect: () => {} };
    expect(renderToStaticMarkup(createElement(SessionHistory, { ...props, listSupported: false }))).toContain("does not advertise session listing");
    const partial = renderToStaticMarkup(createElement(SessionHistory, { ...props, listSupported: true, listIncomplete: true }));
    expect(partial).toContain("Sessions discovered from your agent");
    expect(partial).toContain("Some agent sessions could not be retrieved or saved");
  });
});

describe("recent workspace picker", () => {
  it("includes the current folder once and escapes paths as text", () => {
    const html = renderToStaticMarkup(createElement(WorkspacePicker, {
      cwd: "/current", workspaces: [{ cwd: "/current", lastOpenedAt: 1 }, { cwd: "/<script>", lastOpenedAt: 0 }],
      disabled: false, failed: false, locale: "en", onSelect: () => {},
    }));
    expect(html.match(/value="\/current"/g)).toHaveLength(1);
    expect(html).toContain('value="/current" selected=""');
    expect(html).not.toContain("<script>");
  });
  it("shows localized empty and storage-failure states with selection disabled", () => {
    const html = renderToStaticMarkup(createElement(WorkspacePicker, {
      cwd: null, workspaces: [], disabled: false, failed: true, locale: "zh-CN", onSelect: () => {},
    }));
    expect(html).toContain('disabled=""');
    expect(html).toContain("暂无最近工作区");
    expect(html).toContain("无法读取或保存工作区快捷记录");
  });
});
