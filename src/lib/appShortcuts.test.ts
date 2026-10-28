import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { appShortcut, canRunShortcut, shortcutAria, shortcutLabel, type ShortcutEvent } from "./appShortcuts";
import { ShortcutReference } from "../ShortcutReference";
import { permissionEventAction } from "./permissionHotkey";
const key = (key: string, overrides: Partial<ShortcutEvent> = {}): ShortcutEvent => ({ key, metaKey: true, ctrlKey: false, shiftKey: true, altKey: false, repeat: false, isComposing: false, keyCode: 0, ...overrides });
const idle = { permission: false, settings: false, customEditing: false, localEditor: false, canNavigate: true, contextChanging: false, cwd: true };
describe("app-local shortcut contract", () => {
  it("matches only exact platform chords", () => {
    expect(appShortcut(key("o"), true)).toBe("new");
    expect(appShortcut(key("L"), true)).toBe("composer");
    expect(appShortcut(key("F"), true)).toBe("search");
    expect(appShortcut(key(",", {shiftKey:false}), true)).toBe("settings");
    expect(appShortcut(key("o", {metaKey:false,ctrlKey:true}), false)).toBe("new");
    for (const overrides of [{metaKey:false},{ctrlKey:true},{altKey:true},{shiftKey:false},{repeat:true},{isComposing:true},{keyCode:229}]) expect(appShortcut(key("o", overrides), true)).toBeNull();
    expect(appShortcut(key("o"),false)).toBeNull();
    expect(appShortcut(key(","),true)).toBeNull();
    for(const k of ["a","r","Enter","Escape","n","f","l","o"]) expect(appShortcut(key(k,{metaKey:false,shiftKey:false}),true)).toBeNull();
  });
  it("keeps permission, modal and editing surfaces in control", () => {
    for (const action of ["new","composer","search","settings"] as const) {
      expect(canRunShortcut(action,idle)).toBe(true);
      for(const lock of ["permission","settings","localEditor"] as const) expect(canRunShortcut(action,{...idle,[lock]:true})).toBe(false);
    }
    for(const action of ["new","composer","search"] as const) expect(canRunShortcut(action,{...idle,customEditing:true})).toBe(false);
    expect(canRunShortcut("settings",{...idle,customEditing:true})).toBe(true);
    expect(canRunShortcut("new",{...idle,canNavigate:false})).toBe(false);
    expect(canRunShortcut("composer",{...idle,canNavigate:false})).toBe(true);
    expect(canRunShortcut("search",{...idle,cwd:false})).toBe(false);
    expect(canRunShortcut("composer",{...idle,contextChanging:true})).toBe(false);
  });
  it("shows localized help using the same platform chord labels", () => {
    const html=renderToStaticMarkup(createElement(ShortcutReference,{locale:"zh-CN",macOS:true}));
    expect(html).toContain("键盘快捷键");expect(html).toContain("聚焦消息输入框");
    expect(html).toContain(shortcutLabel("new",true));expect(html).not.toContain("autofocus");
    expect(shortcutLabel("search",false)).toBe("Ctrl+Shift+F");expect(shortcutAria("new",true)).toBe("Meta+Shift+O");
  });
});
describe("permission event isolation", () => {
  const options=[{id:"allow",name:"Allow",kind:"AllowOnce"}];
  it("ignores modified, repeating, composing and already-consumed decisions",()=>{
    const plain={...key("Enter",{metaKey:false,shiftKey:false}),defaultPrevented:false};
    expect(permissionEventAction(plain,options)).toEqual({type:"allow",optionId:"allow"});
    for(const flag of ["metaKey","ctrlKey","altKey","shiftKey","repeat","isComposing","defaultPrevented"] as const) expect(permissionEventAction({...plain,[flag]:true},options)).toBeNull();
    expect(permissionEventAction({...plain,keyCode:229},options)).toBeNull();
  });
});
