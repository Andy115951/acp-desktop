import { useLayoutEffect, useRef } from "react";
import { ChatIcon } from "./ChatIcon";
import { draftEnterShouldSend } from "./lib/sessionUiGates";
import { t, type Locale } from "./lib/i18n";

function fitContent(input: HTMLTextAreaElement) {
  input.style.height = "auto";
  input.style.height = `${input.scrollHeight}px`;
}

export function MessageComposer({ draft, locale, disabled, working, permissionOpen, canSend, canCancel, connected, connecting = false, focusToken = 0, agentName, placeholder, focusShortcut, onDraftChange, onSend, onCancel }: {
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
  onDraftChange: (text: string) => void;
  onSend: () => Promise<void>;
  onCancel: () => Promise<void>;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
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
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, []);
  const submit = () => {
    if (!canSend) return;
    void onSend();
    // Keep the explicit Send action in the composing flow. Do not refocus on
    // asynchronous replies, permission decisions or background startup.
    inputRef.current?.focus();
  };
  return <>
    <div className="composer-box">
      <textarea ref={inputRef} rows={2} value={draft} onChange={(event) => onDraftChange(event.target.value)}
        onCompositionStart={() => { composingRef.current = true; }}
        onCompositionEnd={() => { composingRef.current = false; }}
        onBlur={() => { composingRef.current = false; }}
        onKeyDown={(event) => {
          if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
          if (!canSend || !draftEnterShouldSend(permissionOpen, event.key, event.shiftKey, composingRef.current || event.nativeEvent.isComposing, event.nativeEvent.keyCode)) return;
          event.preventDefault(); submit();
        }}
        disabled={disabled} title={focusShortcut} placeholder={placeholder} aria-label={t(locale, "chat.message")} aria-describedby="composer-help" />
      <div className="composer-actions">
        <span className="composer-agent"><span className={`connection-dot ${connected ? "is-connected" : ""}`} aria-hidden="true" />{agentName}</span>
        {canCancel ? <button type="button" className="stop-button" onClick={() => void onCancel()} title={t(locale, permissionOpen ? "session.cancelTitleAsk" : "session.cancelTitleBusy")}><ChatIcon name="stop" />{t(locale, "session.cancel")}</button>
          : <button type="button" className="send-button" onClick={submit} disabled={!canSend} aria-label={t(locale, "session.send")} title={t(locale, "session.send")}><ChatIcon name="send" /></button>}
      </div>
    </div>
    <p id="composer-help" className="composer-help">{t(locale, connecting ? "navigation.connectingDraft" : !connected ? "navigation.firstSend" : working && !disabled ? "chat.draftWhileWorking" : "chat.composerHelp")}</p>
  </>;
}
