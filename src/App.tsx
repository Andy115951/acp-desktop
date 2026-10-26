import { useEffect, useRef, useState } from "react";
import { ChatIcon } from "./ChatIcon";
import { CustomAgents } from "./CustomAgents";
import { AgentSessionInfo } from "./AgentSessionInfo";
import { PermissionCard } from "./PermissionCard";
import { ErrorNotice } from "./ErrorNotice";
import { ChatTranscript } from "./ChatTranscript";
import { SessionHistory } from "./SessionHistory";
import { WorkspacePicker } from "./WorkspacePicker";
import { permissionHotkeyAction } from "./lib/permissionHotkey";
import {
  canCancelPrompt,
  canConnectNewSession,
  canConnectSelectedAgent,
  canResumeSession,
  canSendPrompt,
  draftEnterShouldSend,
} from "./lib/sessionUiGates";
import { agentAuthHint, agentDetailHint } from "./lib/agentHints";
import { shouldDisconnectOnAgentSwitch } from "./lib/agentSwitch";
import { t, type Locale } from "./lib/i18n";
import { useAgentsStore } from "./store/agents";
import { useSessionStore } from "./store/session";
import { useUiStore } from "./store/ui";

export default function App() {
  const {
    agents,
    selectedAgentId,
    customEditing,
    loading,
    error: detectError,
    override,
    refresh,
    selectAgent,
    setFakeAgent,
  } = useAgentsStore();
  const {
    cwd,
    catalog,
    catalogError,
    configuring,
    configError,
    setConfig,
    metadata,
    insertCommand,
    sessionListSupported,
    sessionListIncomplete,
    switching,
    selectSavedSession,
    recentWorkspaces,
    workspaceError,
    selectWorkspace,
    renameSavedSession,
    archiveSavedSession,
    restoreSavedSession,
    connected,
    busy,
    error,
    sessionId,
    savedSessionId,
    loadSessionSupported,
    lines,
    permission,
    draft,
    setDraft,
    pickFolder,
    hydrateFromPrefs,
    connect,
    disconnect,
    send,
    cancel,
    respondPermission,
    clearTranscript,
    bindEvents,
  } = useSessionStore();
  const { locale, hydrateLocale, setLocale } = useUiStore();
  const composingRef = useRef(false);
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(min-width: 900px)").matches);
  const sidebarToggleRef = useRef<HTMLButtonElement>(null);
  const previousSidebarOpen = useRef(sidebarOpen);
  useEffect(() => {
    if (previousSidebarOpen.current && !sidebarOpen) sidebarToggleRef.current?.focus();
    previousSidebarOpen.current = sidebarOpen;
  }, [sidebarOpen]);
  const closeSidebar = () => setSidebarOpen(false);

  useEffect(() => {
    void hydrateLocale();
  }, [hydrateLocale]);

  // Detect agents (and selectedAgentId prefs) before restoring lastCwd /
  // Resume — parallel hydrate raced detect and could stamp the wrong vendor’s
  // session id onto the Switch selection.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await refresh();
      if (!cancelled) await hydrateFromPrefs();
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh, hydrateFromPrefs]);

  // Per-vendor histories: on agent switch, drop live session + reload Resume id.
  const prevAgentRef = useRef(selectedAgentId);
  useEffect(() => {
    if (prevAgentRef.current === selectedAgentId) return;
    prevAgentRef.current = selectedAgentId;
    const run = async () => {
      const session = useSessionStore.getState();
      if (shouldDisconnectOnAgentSwitch(session.connected, session.busy)) {
        await session.disconnect();
      }
      await session.reloadForAgent(selectedAgentId);
    };
    void run();
  }, [selectedAgentId]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void bindEvents().then((fn) => {
      cleanup = fn;
    });
    return () => cleanup?.();
  }, [bindEvents]);

  useEffect(() => {
    if (!permission) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const action = permissionHotkeyAction(e.key, permission.options);
      if (!action) return;
      e.preventDefault();
      if (action.type === "cancel") {
        void respondPermission(null);
      } else {
        void respondPermission(action.optionId);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [permission, respondPermission]);

  const allowButtonRef = useRef<HTMLButtonElement | null>(null);
  const permissionCardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!permission) return;
    // Focus first Allow* (else first option) so Mac E2E keys land on the card.
    allowButtonRef.current?.focus();
    // Keep the inline Ask card in view inside the transcript scroll region.
    permissionCardRef.current?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [permission]);

  const selected = agents.find((a) => a.id === selectedAgentId);
  const usingFake = !selectedAgentId.startsWith("custom-") && !!override?.usingOverride;
  const canConnectAgent = canConnectSelectedAgent(
    selected?.connectable,
    selected?.available,
    usingFake,
  );
  const uiGates = {
    cwd,
    connected,
    busy: busy || switching || configuring || customEditing,
    permissionOpen: !!permission,
    draftTrimmed: !!draft.trim(),
    savedSessionId,
    loadSessionSupported,
    canConnectAgent,
  };
  const canResume = canResumeSession(uiGates);
  const canConnectNew = canConnectNewSession(uiGates);
  const canSend = canSendPrompt(uiGates);
  const canCancel = !configuring && canCancelPrompt(uiGates);
  const authHint = agentAuthHint(selectedAgentId, usingFake, locale);

  const selectedEntry = catalog.sessions.find((entry) => entry.cwd === cwd && entry.sessionId === (sessionId ?? savedSessionId));
  const workspaceName = cwd?.split(/[\\/]/).filter(Boolean).slice(-1)[0];
  const contextLocked = connected || busy || !!permission || switching || customEditing;

  return (
    <main className="chat-shell" data-sidebar-open={sidebarOpen}>
      <aside id="chat-sidebar" className="chat-sidebar" aria-label={t(locale, "layout.sidebar")} hidden={!sidebarOpen}>
        <div className="sidebar-brand">
          <span className="brand-mark" aria-hidden="true"><ChatIcon name="chat" /></span>
          <span>ACP <span className="font-normal text-slate-400">Desktop</span></span>
          <button type="button" className="icon-button ml-auto" onClick={closeSidebar} aria-label={t(locale, "layout.hideSidebar")}>
            <ChatIcon name="panel" />
          </button>
        </div>
        <div className="sidebar-scroll">
          <button type="button" className="new-chat-button" onClick={() => void connect("new")} disabled={!canConnectNew}>
            <ChatIcon name="plus" /> {t(locale, "session.newSession")}
          </button>
          <section className="sidebar-section" aria-label={t(locale, "session.cwd")}>
            <div className="sidebar-section-heading">
              <span>{t(locale, "layout.workspace")}</span>
              <button type="button" className="icon-button" onClick={() => void pickFolder()} disabled={contextLocked} title={t(locale, "session.pickFolder")} aria-label={t(locale, "session.pickFolder")}><ChatIcon name="folder" /></button>
            </div>
            <WorkspacePicker cwd={cwd} workspaces={recentWorkspaces} failed={workspaceError}
              disabled={contextLocked} locale={locale} onSelect={(path) => void selectWorkspace(path)} />
          </section>
          <section className="sidebar-section history-section" aria-label={t(locale, "history.label")}>
            <SessionHistory catalog={catalog} cwd={cwd} savedSessionId={savedSessionId}
              disabled={contextLocked} failed={catalogError} variant="list"
              locale={locale} onSelect={selectSavedSession} onRename={renameSavedSession}
              onArchive={archiveSavedSession} onRestore={restoreSavedSession}
              listSupported={sessionListSupported} listIncomplete={sessionListIncomplete} />
          </section>
          <details className="sidebar-details">
            <summary>{t(locale, "layout.agentSettings")}</summary>
            <button type="button" onClick={() => void refresh()} disabled={loading || switching || customEditing} className="subtle-button my-3">
              {loading ? t(locale, "agents.checking") : t(locale, "agents.refresh")}
            </button>
        {detectError ? (
          <ErrorNotice error={detectError} locale={locale} />
        ) : null}
        {authHint ? (
          <p className="mb-3 rounded-md border border-sky-900/50 bg-sky-950/30 px-3 py-2 text-xs text-sky-200/90">
            {authHint}
          </p>
        ) : null}
        <ul className="divide-y divide-slate-800">
          {agents.map((agent) => {
            const detail = agentDetailHint(agent, locale);
            const available = agent.available;
            const selectedRow = agent.id === selectedAgentId;
            const clickable = agent.connectable;
            return (
              <li key={agent.id}>
                <button
                  type="button"
                  disabled={!clickable || busy || configuring || !!permission || switching || customEditing}
                  onClick={() => selectAgent(agent.id)}
                  className={`flex w-full items-center justify-between gap-3 py-2.5 text-left ${
                    available ? "text-slate-100" : "text-slate-500"
                  } ${
                    selectedRow
                      ? "rounded-md bg-slate-800/80 px-2 -mx-2"
                      : ""
                  } ${clickable ? "hover:bg-slate-800/40" : "cursor-default"}`}
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${
                          available ? "bg-emerald-400" : "bg-slate-600"
                        }`}
                      />
                      <span className="font-medium">
                        {agent.name}
                        {!agent.connectable ? (
                          <span className="ml-2 text-xs font-normal text-slate-600">
                            {t(locale, "agents.later")}
                          </span>
                        ) : selectedRow ? (
                          <span className="ml-2 text-xs font-normal text-sky-400">
                            {t(locale, "agents.selected")}
                          </span>
                        ) : null}
                      </span>
                    </div>
                    <p className="pl-4 text-xs text-slate-500">
                      <code>{agent.binary}</code>
                    </p>
                    {detail ? (
                      <p className="pl-4 pt-0.5 text-xs text-amber-200/80">
                        {detail}
                      </p>
                    ) : null}
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      available
                        ? "bg-emerald-950 text-emerald-300 ring-1 ring-emerald-800"
                        : "bg-slate-950 text-slate-500 ring-1 ring-slate-800"
                    }`}
                  >
                    {available
                      ? t(locale, "agents.available")
                      : t(locale, "agents.missing")}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <CustomAgents locale={locale} disabled={connected || busy || switching || !!permission} />

          </details>
          <details className="sidebar-details">
            <summary>{t(locale, "layout.sessionDetails")}</summary>
            <p className="mt-3 break-all text-xs leading-6 text-slate-400">
              {t(locale, "session.cwd")}: {cwd ?? "—"}<br />
              {t(locale, "session.session")}: {sessionId ?? savedSessionId ?? "—"}
            </p>
            {loadSessionSupported !== null && <p className="mt-2 text-xs text-slate-400">{t(locale, loadSessionSupported ? "session.loadOk" : "session.loadUnsupported")}</p>}
          </details>
      <details className="sidebar-details space-y-3">
        <summary className="cursor-pointer text-xs text-slate-500">{t(locale, "dev.title")}</summary>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs text-amber-200/70">
              {t(locale, "dev.blurbBefore")}
              <code className="text-amber-100/90">
                session/request_permission
              </code>
              {t(locale, "dev.blurbAfter")}
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs text-amber-100">
            <input
              type="checkbox"
              checked={!!override?.usingOverride}
              disabled={connected || busy}
              onChange={(e) => {
                void setFakeAgent(e.target.checked).catch(() => undefined);
              }}
              className="rounded border-amber-700"
            />
            {t(locale, "dev.useFake")}
          </label>
        </div>
        <p className="text-xs text-amber-200/60 break-all">
          {t(locale, "dev.mode")}: {override?.mode ?? "…"} ·{" "}
          {t(locale, "dev.cmd")}:{" "}
          <code>{override?.command?.join(" ") ?? "—"}</code>
          {override?.fakeAgentPath
            ? ` · ${t(locale, "dev.binary")} ${override.fakeAgentPath}`
            : usingFake
              ? ` · ${t(locale, "dev.binaryMissing")}`
              : ""}
        </p>
      </details>
        </div>
        <div className="sidebar-footer">
          <span className="text-xs text-slate-500">{t(locale, "badge.acpClient")}</span>
          <select value={locale} onChange={(e) => setLocale(e.target.value as Locale)} aria-label={t(locale, "language.label")} className="locale-select">
            <option value="en">English</option><option value="zh-CN">简体中文</option>
          </select>
        </div>
      </aside>

      <section className="conversation-pane" aria-label={t(locale, "chat.transcript")}>
        <header className="conversation-header">
          <button ref={sidebarToggleRef} type="button" className="icon-button" aria-controls="chat-sidebar" aria-expanded={sidebarOpen}
            aria-label={t(locale, sidebarOpen ? "layout.hideSidebar" : "layout.showSidebar")} onClick={() => setSidebarOpen(!sidebarOpen)}>
            <ChatIcon name="panel" />
          </button>
          <div className="conversation-heading">
            <h1 title={selectedEntry?.title ?? undefined}>{selectedEntry?.title ?? t(locale, "session.newSession")}</h1>
            <p title={cwd ?? undefined}>{workspaceName ?? t(locale, "layout.noWorkspace")}</p>
          </div>
          <label className="agent-switcher">
            <span className="sr-only">{t(locale, "agents.switch")}</span>
            <span className={`connection-dot ${connected ? "is-connected" : ""}`} aria-hidden="true" />
            <select value={selectedAgentId} disabled={busy || switching || configuring || customEditing || !!permission}
              onChange={(e) => selectAgent(e.target.value)}>
              {agents.filter((a) => a.connectable).map((a) => <option key={a.id} value={a.id}>{a.name}{a.available ? "" : t(locale, "agents.missingSuffix")}</option>)}
            </select>
          </label>
          <button type="button" className="icon-button clear-conversation" onClick={clearTranscript} title={t(locale, "session.clear")} aria-label={t(locale, "session.clear")}><ChatIcon name="clear" /></button>
        </header>

        <div className="connection-toolbar">
          <span className={`connection-status ${busy ? "is-working" : ""}`} role="status">
            {t(locale, permission ? "layout.awaitingPermission" : configuring ? "layout.configuring" : busy ? "layout.working" : connected ? "session.connected" : "session.idle")}
            {usingFake && <span className="fixture-badge">{t(locale, "session.fakeTitle")}</span>}
          </span>
          <div className="flex items-center gap-2">
            {!cwd && <button type="button" className="subtle-button" onClick={() => void pickFolder()} disabled={contextLocked}>{t(locale, "session.pickFolder")}</button>}
            {connected ? <button type="button" className="subtle-button" onClick={() => void disconnect()}>{t(locale, "session.disconnect")}</button> : <>
              {savedSessionId && <button type="button" className="subtle-button" onClick={() => void connect("resume")} disabled={!canResume}
                title={loadSessionSupported === false ? t(locale, "session.resumeTitleUnsupported") : undefined}>{t(locale, "session.resume")}</button>}
              <button type="button" className="connect-button" onClick={() => void connect("new")} disabled={!canConnectNew}>{t(locale, savedSessionId ? "session.newSession" : "session.connect")}</button>
            </>}
          </div>
        </div>
        {error && <div className="conversation-notice"><ErrorNotice error={error} locale={locale} /></div>}
        {detectError && !sidebarOpen && <div className="conversation-notice"><ErrorNotice error={detectError} locale={locale} /></div>}
        {loadSessionSupported === false && <p className="conversation-notice text-xs text-amber-200">{t(locale, "session.resumeDisabledBefore")}<code>loadSession</code>{t(locale, "session.resumeDisabledAfter")}</p>}

        <ChatTranscript lines={lines} locale={locale} resetKey={`${selectedAgentId}:${cwd}:${sessionId}`} fill
          agentName={selected?.name} emptyState={<div className="chat-welcome">
            <div className="welcome-mark" aria-hidden="true"><ChatIcon name="chat" /></div>
            <p className="welcome-eyebrow">ACP DESKTOP</p>
            <h2>{t(locale, connected ? "layout.readyTitle" : "layout.welcomeTitle")}</h2>
            <p>{t(locale, connected ? "layout.readyDescription" : "layout.welcomeDescription", { name: selected?.name ?? "Agent" })}</p>
            <div className="welcome-context"><ChatIcon name="folder" /><span>{workspaceName ?? t(locale, "layout.noWorkspace")}</span><span aria-hidden="true">·</span><span>{selected?.name ?? "Agent"}</span></div>
          </div>}>
          {permission && <div ref={permissionCardRef}><PermissionCard permission={permission} allowButtonRef={allowButtonRef} onRespond={(id) => void respondPermission(id)} locale={locale} /></div>}
        </ChatTranscript>

        <footer className="composer-dock">
          {connected && <details className="session-options">
            <summary>{t(locale, "layout.sessionOptions")}{configError && <span className="ml-2 text-amber-200">{t(locale, "layout.configFailed")}</span>}</summary>
            <div className="session-options-content"><AgentSessionInfo metadata={metadata?.sessionId === sessionId ? metadata : null} locale={locale}
              disabled={busy || configuring || switching || !!permission} onCommand={insertCommand} configFailed={configError} onConfigure={(id, value) => void setConfig(id, value)} /></div>
          </details>}
          <div className="composer-box">
            <textarea rows={2} value={draft} onChange={(e) => setDraft(e.target.value)}
              onCompositionStart={() => { composingRef.current = true; }} onCompositionEnd={() => { composingRef.current = false; }} onBlur={() => { composingRef.current = false; }}
              onKeyDown={(e) => {
                if (!canSend || !draftEnterShouldSend(!!permission, e.key, e.shiftKey, composingRef.current || e.nativeEvent.isComposing, e.nativeEvent.keyCode)) return;
                e.preventDefault(); void send();
              }}
              disabled={!connected || busy || configuring || switching || !!permission}
              placeholder={connected ? usingFake ? t(locale, "session.placeholderConnectedFake") : t(locale, "session.placeholderConnected", { name: selected?.name ?? "agent" }) : t(locale, "session.placeholderIdle")}
              aria-label={t(locale, "chat.message")} aria-describedby="composer-help" />
            <div className="composer-actions">
              <span className="composer-agent"><span className={`connection-dot ${connected ? "is-connected" : ""}`} aria-hidden="true" />{selected?.name ?? "Agent"}</span>
              {canCancel ? <button type="button" className="stop-button" onClick={() => void cancel()} title={t(locale, permission ? "session.cancelTitleAsk" : "session.cancelTitleBusy")}><ChatIcon name="stop" />{t(locale, "session.cancel")}</button>
                : <button type="button" className="send-button" onClick={() => void send()} disabled={!canSend} aria-label={t(locale, "session.send")} title={t(locale, "session.send")}><ChatIcon name="send" /></button>}
            </div>
          </div>
          <p id="composer-help" className="composer-help">{t(locale, "chat.composerHelp")}</p>
        </footer>
      </section>
    </main>
  );
}
