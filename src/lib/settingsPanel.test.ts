import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SettingsPanel } from "../SettingsPanel";

const render = (open: boolean, locale: "en" | "zh-CN" = "en") => renderToStaticMarkup(createElement(SettingsPanel, {
  open, locale, macOS: true, onClose: () => {}, closeRef: createRef<HTMLButtonElement>(),
  children: createElement("input", { "aria-label": "Unfinished profile", defaultValue: "Keep this edit" }),
}));
describe("advanced settings surface", () => {
  it("keeps unfinished content mounted but hidden before an explicit open", () => {
    const html=render(false);
    expect(html).toMatch(/class="settings-layer" hidden=""/);
    expect(html).toContain('value="Keep this edit"');
    expect(html).not.toContain("autofocus");
  });
  it("labels an open modal and preserves the macOS header drag area", () => {
    const html=render(true);
    expect(html).not.toMatch(/class="settings-layer" hidden/);
    expect(html).toContain('role="dialog" aria-modal="true" aria-labelledby="settings-title"');
    expect(html).toContain('aria-label="Close settings"');
    expect(html).toContain('data-tauri-drag-region="deep"');
  });
  it("localizes its title and close control", () => {
    const html=render(true,"zh-CN");
    expect(html).toContain('id="settings-title">设置');
    expect(html).toContain('aria-label="关闭设置"');
  });
});
