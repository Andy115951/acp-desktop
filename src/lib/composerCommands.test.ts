import { describe, expect, it } from "vitest";
import { commandPickerKey, composerCommands } from "./composerCommands";

const commands = [
  { name: "review", description: "Review changes", inputHint: "files" },
  { name: "restart", description: "Restart", inputHint: null },
  { name: "help", description: "Help", inputHint: null },
];
const key = (key: string, patch = {}) => ({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, repeat: false, isComposing: false, keyCode: 0, ...patch });
describe("composer command completion", () => {
  it("shows only reported name prefixes, preserving their order and literal input hints", () => {
    expect(composerCommands("/", commands, 1, 1)).toEqual(commands);
    expect(composerCommands("/RE", commands, 3, 3)).toEqual(commands.slice(0, 2));
    expect(composerCommands("/files", commands, 6, 6)).toEqual([]);
    expect(composerCommands("/unknown", [], 8, 8)).toEqual([]);
  });
  it("leaves arguments, paths, multiline drafts, selection and middle-of-text editing alone", () => {
    for (const draft of ["hi /review", "/review ", "/review files", "/tmp/file", "//", "/\n", " /review", "/\t"]) {
      expect(composerCommands(draft, commands, draft.length, draft.length)).toEqual([]);
    }
    expect(composerCommands("/review", commands, 0, 7)).toEqual([]);
    expect(composerCommands("/review", commands, 3, 3)).toEqual([]);
  });
  it("uses Enter only for insertion and keeps Tab and Space available for ordinary editing", () => {
    expect(commandPickerKey(key("ArrowDown"), false)).toBe("next");
    expect(commandPickerKey(key("ArrowUp"), false)).toBe("previous");
    expect(commandPickerKey(key("Enter"), false)).toBe("insert");
    expect(commandPickerKey(key("Escape"), false)).toBe("dismiss");
    for (const value of ["Tab", " ", "a", "r"]) expect(commandPickerKey(key(value), false)).toBeNull();
  });
  it("never captures IME confirmation, modified chords or repeat events", () => {
    for (const value of ["ArrowDown", "ArrowUp", "Enter", "Escape"]) {
      expect(commandPickerKey(key(value), true)).toBeNull();
      for (const patch of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }, { metaKey: true }, { ctrlKey: true }, { altKey: true }, { shiftKey: true }]) {
        expect(commandPickerKey(key(value, patch), false)).toBeNull();
      }
    }
  });
});
