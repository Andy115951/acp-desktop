import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SessionHistory } from "../SessionHistory";
import { readSessionCatalog, rememberSession } from "./sessionCatalog";

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
});
