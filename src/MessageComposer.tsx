import { useLayoutEffect, useRef } from "react";
import { ChatIcon } from "./ChatIcon";
import { draftEnterShouldSend } from "./lib/sessionUiGates";
import { t, type Locale } from "./lib/i18n";

function fitContent(input: HTMLTextAreaElement) {
  input.style.height = "auto";
  input.style.height = `${input.scrollHeight}px`;
}

export function MessageComposer({ draft, locale, disabled, working, permissionOpen, canSend, canCancel, connected, agentName, placeholder, onDraftChange, onSend, onCancel }: {
  draft: string;
  locale: Locale;
  disabled: boolean;
  working: boolean;
  permissionOpen: boolean;
  canSend: boolean;
  canCancel: boolean;
  connected: boolean;
  agentName: string;
  placeholder: string;
  onDraftChange: (text: string) => void;
  onSend: () => Promise<void>;
  onCancel: () => Promise<void>;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  useLayoutEffect(() => {
    if (inputRef.current) fitContent(inputRef.current);
  }, [draft, disabled]);
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    let previousWidth = input.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const width = input.getBoundingClientRect().width;
      // Ignore our own height changes. Reflow wrapped text after a sidebar or
      // window resize, including a composer revealed from a hidden pane.
      if (width > 0 && width !== previousWidth) fitContent(input);
      previousWidth = width;
    });
    observer.observe(input);
    return () => observer.disconnect();
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
          if (!canSend || !draftEnterShouldSend(permissionOpen, event.key, event.shiftKey, composingRef.current || event.nativeEvent.isComposing, event.nativeEvent.keyCode)) return;
          event.preventDefault(); submit();
        }}
        disabled={disabled} placeholder={placeholder} aria-label={t(locale, "chat.message")} aria-describedby="composer-help" />
      <div className="composer-actions">
        <span className="composer-agent"><span className={`connection-dot ${connected ? "is-connected" : ""}`} aria-hidden="true" />{agentName}</span>
        {canCancel ? <button type="button" className="stop-button" onClick={() => void onCancel()} title={t(locale, permissionOpen ? "session.cancelTitleAsk" : "session.cancelTitleBusy")}><ChatIcon name="stop" />{t(locale, "session.cancel")}</button>
          : <button type="button" className="send-button" onClick={submit} disabled={!canSend} aria-label={t(locale, "session.send")} title={t(locale, "session.send")}><ChatIcon name="send" /></button>}
      </div>
    </div>
    <p id="composer-help" className="composer-help">{t(locale, working && !disabled ? "chat.draftWhileWorking" : "chat.composerHelp")}</p>
  </>;
}
