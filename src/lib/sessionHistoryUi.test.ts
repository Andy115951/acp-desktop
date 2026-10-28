import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SessionHistory } from "../SessionHistory";
import { readSessionCatalog, rememberSession } from "./sessionCatalog";
import { WorkspacePicker } from "../WorkspacePicker";

describe("saved session picker", () => {
  it("offers a localized accessible search that stays usable while history navigation is locked", () => {
    const html = renderToStaticMarkup(createElement(SessionHistory, {
      catalog: readSessionCatalog(null, {"/one":"untitled-full-id"}), cwd:"/one", savedSessionId:"untitled-full-id",
      disabled:true, failed:false, locale:"zh-CN", variant:"list", onSelect:()=>{},
    }));
    expect(html).toContain('type="search"');
    expect(html).toContain('aria-label="搜索对话"');
    expect(html).toContain('aria-label="匹配 1 条，共 1 条对话"');
    expect(html).toMatch(/<input[^>]*type="search"[^>]*>/);
    expect(html.match(/<input[^>]*type="search"[^>]*>/)?.[0]).not.toContain("disabled");
    expect(html).toContain('aria-current="true"');
    expect(html).toContain('title="untitled-full-id"');
  });
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
    expect(html).toContain("请等待当前操作结束");
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
