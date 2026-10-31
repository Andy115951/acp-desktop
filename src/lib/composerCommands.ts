import type { AgentCommand } from "./sessionMetadata";

/** Complete only a command token, never arguments, selected text or a path. */
export function composerCommands(draft: string, commands: readonly AgentCommand[], start: number, end: number): AgentCommand[] {
  if (start !== draft.length || end !== start || !/^\/[^\s/]*$/u.test(draft)) return [];
  const query = draft.slice(1).toLowerCase();
  return commands.filter(command => command.name.toLowerCase().startsWith(query));
}

export function commandPickerKey(event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "repeat" | "isComposing" | "keyCode">, composing: boolean): "next" | "previous" | "insert" | "dismiss" | null {
  if (composing || event.isComposing || event.keyCode === 229 || event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return null;
  if (event.key === "ArrowDown") return "next";
  if (event.key === "ArrowUp") return "previous";
  if (event.key === "Enter") return "insert";
  if (event.key === "Escape") return "dismiss";
  return null;
}
