import { useId, useLayoutEffect, useRef, useState } from "react";
import { ChatIcon } from "./ChatIcon";
import { draftEnterShouldSend } from "./lib/sessionUiGates";
import { t, type Locale } from "./lib/i18n";
import { commandPickerKey, composerCommands } from "./lib/composerCommands";
import type { AgentCommand } from "./lib/sessionMetadata";

function fitContent(input: HTMLTextAreaElement) {
  input.style.height = "auto";
  input.style.height = `${input.scrollHeight}px`;
}

export function MessageComposer({ draft, locale, disabled, working, permissionOpen, canSend, canCancel, connected, connecting = false, focusToken = 0, agentName, placeholder, focusShortcut, commands = [], contextKey = "", onDraftChange, onSend, onCancel }: {
  draft: string;
  locale: Locale;
  disabled: boolean;
  working: boolean;
  permissionOpen: boolean;
  canSend: boolean;
  canCancel: boolean;
  connected: boolean;
  connecting?: boolean;
  focusToken?: number;
  agentName: string;
  placeholder: string;
  focusShortcut?: string;
  commands?: readonly AgentCommand[];
  contextKey?: string;
  onDraftChange: (text: string) => void;
  onSend: () => Promise<void>;
  onCancel: () => Promise<void>;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const [composing, setComposing] = useState(false);
  const [focused, setFocused] = useState(false);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [active, setActive] = useState({ query: "", name: "" });
  const listId = useId();
  const queryKey = JSON.stringify([contextKey, draft]);
  const suggestions = connected && !disabled && !working && !connecting && !permissionOpen && focused && !composing && dismissed !== queryKey
    ? composerCommands(draft, commands, selection.start, selection.end) : [];
  const activeIndex = Math.max(0, active.query === queryKey ? suggestions.findIndex(command => command.name === active.name) : 0);
  const readSelection = () => {
    const input = inputRef.current;
    if (input) setSelection({ start: input.selectionStart, end: input.selectionEnd });
  };
  const insertSuggestion = (name: string) => {
    if (composingRef.current || !suggestions.some(command => command.name === name)) return;
    onDraftChange(`/${name} `);
    inputRef.current?.focus({ preventScroll: true });
  };
  useLayoutEffect(() => {
    if (suggestions.length) document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [listId, activeIndex, queryKey, suggestions.length]);
  const focusedToken = useRef(0);
  useLayoutEffect(() => {
    if (!focusToken || focusToken === focusedToken.current || disabled) return;
    focusedToken.current = focusToken;
    // Navigation was explicitly requested; never activate a background app.
    if (document.hasFocus()) inputRef.current?.focus();
  }, [focusToken, disabled]);
  useLayoutEffect(() => {
    if (inputRef.current) fitContent(inputRef.current);
  }, [draft, disabled]);
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    // Native selection changes (including accessibility/programmatic select)
    // do not always produce React's synthetic onSelect event.
    input.addEventListener("select", readSelection);
    let previousWidth = input.getBoundingClientRect().width;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      const width = input.getBoundingClientRect().width;
      // Ignore our own height changes. Reflow wrapped text after a sidebar or
      // window resize, including a composer revealed from a hidden pane.
      if (width > 0 && width !== previousWidth) {
        // Refit outside observer delivery to avoid resize-loop warnings when
        // opening/closing a narrow sidebar also changes transcript scrollbars.
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => fitContent(input));
      }
      previousWidth = width;
    });
    observer.observe(input);
    return () => { input.removeEventListener("select", readSelection); cancelAnimationFrame(frame); observer.disconnect(); };
  }, []);
  const submit = () => {
    if (!canSend) return;
    void onSend();
    // Keep the explicit Send action in the composing flow. Do not refocus on
    // asynchronous replies, permission decisions or background startup.
    inputRef.current?.focus();
  };
  return <>
    <div className="composer-container">
      {suggestions.length > 0 && <div className="command-picker">
        <p id={`${listId}-help`} className="command-picker-help">{t(locale, "composer.commandsHelp")}</p>
        <div id={listId} role="listbox" aria-label={t(locale, "composer.commands")} className="command-picker-list">
          {suggestions.map((command, index) => <button type="button" role="option" tabIndex={-1}
            id={`${listId}-${index}`} key={command.name} aria-selected={index === activeIndex}
            onMouseDown={event => event.preventDefault()} onClick={() => insertSuggestion(command.name)}>
            <strong>/{command.name}</strong><span>{command.description}</span>
            {command.inputHint && <small>{command.inputHint}</small>}
          </button>)}
        </div>
      </div>}
      <div className="composer-box">
        <textarea ref={inputRef} rows={2} value={draft} onChange={(event) => { setDismissed(null); onDraftChange(event.target.value); readSelection(); }}
          onFocus={() => { setFocused(true); readSelection(); }} onSelect={readSelection}
          onCompositionStart={() => { composingRef.current = true; setComposing(true); }}
          onCompositionEnd={() => { composingRef.current = false; setComposing(false); readSelection(); }}
          onBlur={() => { composingRef.current = false; setComposing(false); setFocused(false); }}
          onKeyDown={(event) => {
            const action = suggestions.length ? commandPickerKey(event.nativeEvent, composingRef.current) : null;
            if (action) {
              event.preventDefault(); event.stopPropagation();
              if (action === "dismiss") setDismissed(queryKey);
              else if (action === "insert") insertSuggestion(suggestions[activeIndex].name);
              else {
                const index = (activeIndex + (action === "next" ? 1 : -1) + suggestions.length) % suggestions.length;
                setActive({ query: queryKey, name: suggestions[index].name });
              }
              return;
            }
            if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
            if (!canSend || !draftEnterShouldSend(permissionOpen, event.key, event.shiftKey, composingRef.current || event.nativeEvent.isComposing, event.nativeEvent.keyCode)) return;
            event.preventDefault(); submit();
          }}
          disabled={disabled} title={focusShortcut} placeholder={placeholder} aria-label={t(locale, "chat.message")}
          aria-autocomplete={commands.length ? "list" : undefined} aria-haspopup={commands.length ? "listbox" : undefined}
          aria-controls={suggestions.length ? listId : undefined} aria-activedescendant={suggestions.length ? `${listId}-${activeIndex}` : undefined}
          aria-describedby={suggestions.length ? `composer-help ${listId}-help` : "composer-help"} />
        <div className="composer-actions">
          <span className="composer-agent"><span className={`connection-dot ${connected ? "is-connected" : ""}`} aria-hidden="true" />{agentName}</span>
          {canCancel ? <button type="button" className="stop-button" onClick={() => void onCancel()} title={t(locale, permissionOpen ? "session.cancelTitleAsk" : "session.cancelTitleBusy")}><ChatIcon name="stop" />{t(locale, "session.cancel")}</button>
            : <button type="button" className="send-button" onClick={submit} disabled={!canSend} aria-label={t(locale, "session.send")} title={t(locale, "session.send")}><ChatIcon name="send" /></button>}
        </div>
      </div>
    </div>
    <p id="composer-help" className="composer-help">{t(locale, connecting ? "navigation.connectingDraft" : !connected ? "navigation.firstSend" : working && !disabled ? "chat.draftWhileWorking" : "chat.composerHelp")}
      {connected && !working && !disabled && !permissionOpen && commands.length > 0 && <> · {t(locale, "composer.commandsHint")}</>}</p>
  </>;
}
