import { useEffect, useRef, useState } from "react";
import { SettingsPanel } from "./SettingsPanel";
import { ChatIcon } from "./ChatIcon";
import { MessageComposer } from "./MessageComposer";
import { CustomAgents } from "./CustomAgents";
import { AgentSessionInfo } from "./AgentSessionInfo";
import { PermissionCard } from "./PermissionCard";
import { ErrorNotice } from "./ErrorNotice";
import { ChatTranscript } from "./ChatTranscript";
import { SessionHistory } from "./SessionHistory";
import { WorkspacePicker } from "./WorkspacePicker";
import { sessionDisplayTitle } from "./lib/sessionSearch";
import { permissionHotkeyAction } from "./lib/permissionHotkey";
import {
  canCancelPrompt,
  canConnectNewSession,
  canConnectSelectedAgent,
  canResumeSession,
  canSendPrompt,
} from "./lib/sessionUiGates";
import { agentAuthHint, agentDetailHint } from "./lib/agentHints";
import { shouldDisconnectOnAgentSwitch } from "./lib/agentSwitch";
import { t, type Locale } from "./lib/i18n";
import { useAgentsStore } from "./store/agents";
import { useSessionStore } from "./store/session";
import { useUiStore } from "./store/ui";
import type { Theme } from "./lib/theme";

export default function App() {
  // Overlay title bars are macOS-only; other platforms retain native decorations.
  const macOS = typeof navigator !== "undefined" && navigator.platform.startsWith("Mac");
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
    newConversation,
    openConversation,
    connecting,
    submitting,
    recoveryRequired,
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
    draftTarget,
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
  const { locale, hydrateLocale, setLocale, theme, setTheme } = useUiStore();
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(min-width: 900px)").matches);
  const [composerFocus, setComposerFocus] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsCloseRef = useRef<HTMLButtonElement>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const settingsReturnRef = useRef<HTMLElement | null>(null);
  const sidebarToggleRef = useRef<HTMLButtonElement>(null);
  const agentSettingsRef = useRef<HTMLDetailsElement>(null);
  const previousSidebarOpen = useRef(sidebarOpen);
  const focusComposerOnClose = useRef(false);
  useEffect(() => {
    if (previousSidebarOpen.current && !sidebarOpen && !focusComposerOnClose.current) sidebarToggleRef.current?.focus();
    focusComposerOnClose.current = false;
    previousSidebarOpen.current = sidebarOpen;
  }, [sidebarOpen]);
  const closeSidebar = () => setSidebarOpen(false);
  const openSettings = (trigger: HTMLElement, focusAgents = false) => {
    if (useSessionStore.getState().permission) return;
    settingsReturnRef.current = trigger;
    setSettingsOpen(true);
    if (focusAgents && agentSettingsRef.current) agentSettingsRef.current.open = true;
    requestAnimationFrame(() => {
      if (!document.hasFocus() || useSessionStore.getState().permission) return;
      if (focusAgents) agentSettingsRef.current?.querySelector("summary")?.focus();
      else settingsCloseRef.current?.focus();
    });
  };
  const closeSettings = () => {
    setSettingsOpen(false);
    if (!document.hasFocus() || useSessionStore.getState().permission) return;
    const trigger = settingsReturnRef.current;
    (trigger?.getClientRects().length ? trigger : settingsTriggerRef.current)?.focus();
  };


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
    // Incoming permission always takes precedence over the settings surface.
    setSettingsOpen(false);
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
  const canConnectAgent = !loading && canConnectSelectedAgent(
    selected?.connectable,
    selected?.available,
    usingFake,
  );
  // The selected agent changes before its old process finishes disconnecting.
  // Keep that old context inert until reload binds the new draft identity.
  const agentChanging = !!draftTarget && draftTarget.agentId !== selectedAgentId;
  const uiGates = {
    cwd,
    connected,
    busy: busy || connecting || submitting || switching || configuring || customEditing || agentChanging,
    permissionOpen: !!permission,
    draftTrimmed: !!draft.trim(),
    savedSessionId,
    loadSessionSupported,
    canConnectAgent,
    recoveryRequired,
  };
  const canResume = canResumeSession(uiGates);
  const canConnectNew = canConnectNewSession(uiGates);
  const canSend = canSendPrompt(uiGates);
  const canCancel = !agentChanging && !connecting && !configuring && canCancelPrompt(uiGates);
  const authHint = agentAuthHint(selectedAgentId, usingFake, locale);

  const selectedEntry = catalog.sessions.find((entry) => entry.cwd === cwd && entry.sessionId === (sessionId ?? savedSessionId));
  const conversationId = sessionId ?? savedSessionId;
  const conversationTitle = conversationId ? sessionDisplayTitle(conversationId, selectedEntry?.title) : t(locale, "navigation.newConversation");
  const workspaceName = cwd?.split(/[\\/]/).filter(Boolean).slice(-1)[0];
  const contextLocked = agentChanging || busy || connecting || submitting || configuring || !!permission || switching || customEditing;
  const canNavigate = !contextLocked;
  const focusConversation = () => {
    if (window.matchMedia("(max-width: 760px)").matches) {
      focusComposerOnClose.current = true;
      setSidebarOpen(false);
    }
    setComposerFocus(value => value + 1);
  };
  const startConversation = () => { if (!canNavigate) return; void newConversation(); focusConversation(); };
  const openSavedConversation = (id: string) => { if (!canNavigate) return; void openConversation(id); focusConversation(); };
  const preparationHint = !cwd ? "connection.chooseWorkspace"
    : loading ? "connection.checking"
    : !canConnectAgent ? "connection.missingAgent"
    : agentChanging || switching || customEditing ? "connection.finishEditing"
    : savedSessionId && loadSessionSupported !== false ? "connection.readySaved" : "connection.ready";

  return (
    <main className="chat-shell" data-sidebar-open={sidebarOpen} data-macos={macOS}>
      <aside id="chat-sidebar" className="chat-sidebar" aria-label={t(locale, "layout.sidebar")} hidden={!sidebarOpen}>
        <div className="sidebar-brand" data-tauri-drag-region={macOS ? "deep" : undefined}>
          <span className="brand-mark" aria-hidden="true"><ChatIcon name="chat" /></span>
          <span>ACP <span className="font-normal text-ui-muted">Desktop</span></span>
          <button type="button" className="icon-button ml-auto" onClick={closeSidebar} aria-label={t(locale, "layout.hideSidebar")}>
            <ChatIcon name="panel" />
          </button>
        </div>
        <div className="sidebar-scroll">
          <button type="button" className="new-chat-button" onClick={startConversation} disabled={!canNavigate}>
            <ChatIcon name="plus" /> {t(locale, "navigation.newConversation")}
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
            <SessionHistory key={JSON.stringify([selectedAgentId, cwd])} catalog={agentChanging ? { version: 1, sessions: [] } : catalog} cwd={cwd} savedSessionId={agentChanging ? null : savedSessionId}
              disabled={contextLocked} editingDisabled={connected || contextLocked} failed={catalogError} variant="list"
              locale={locale} onSelect={openSavedConversation} onRename={renameSavedSession}
              onArchive={archiveSavedSession} onRestore={restoreSavedSession}
              listSupported={sessionListSupported} listIncomplete={sessionListIncomplete} />
          </section>
        </div>
        <div className="sidebar-footer">
          <button type="button" className="settings-launch" disabled={!!permission} aria-controls="app-settings" aria-expanded={settingsOpen}
            onClick={(event) => openSettings(event.currentTarget)}><ChatIcon name="settings" />{t(locale, "settings.title")}</button>
          <span className="text-xs text-ui-faint">{t(locale, "badge.acpClient")}</span>
        </div>
      </aside>

      <section className="conversation-pane" aria-label={t(locale, "chat.transcript")}>
        <header className="conversation-header" data-tauri-drag-region={macOS ? "deep" : undefined}>
          <button ref={sidebarToggleRef} type="button" className="icon-button" aria-controls="chat-sidebar" aria-expanded={sidebarOpen}
            aria-label={t(locale, sidebarOpen ? "layout.hideSidebar" : "layout.showSidebar")} onClick={() => setSidebarOpen(!sidebarOpen)}>
            <ChatIcon name="panel" />
          </button>
          <div className="conversation-heading">
            <h1 title={conversationTitle}>{conversationTitle}</h1>
            <p title={cwd ?? undefined}>{workspaceName ?? t(locale, "layout.noWorkspace")}</p>
          </div>
          <label className="agent-switcher">
            <span className="sr-only">{t(locale, "agents.switch")}</span>
            <span className={`connection-dot ${connected ? "is-connected" : ""}`} aria-hidden="true" />
            <select value={selectedAgentId} disabled={contextLocked}
              onChange={(e) => selectAgent(e.target.value)}>
              {agents.filter((a) => a.connectable).map((a) => <option key={a.id} value={a.id}>{a.name}{a.available ? "" : t(locale, "agents.missingSuffix")}</option>)}
            </select>
          </label>
          <button ref={settingsTriggerRef} type="button" className="icon-button" disabled={!!permission}
            aria-controls="app-settings" aria-expanded={settingsOpen} aria-label={t(locale, "settings.title")}
            onClick={(event) => openSettings(event.currentTarget)}><ChatIcon name="settings" /></button>
          <button type="button" className="icon-button clear-conversation" onClick={clearTranscript} title={t(locale, "session.clear")} aria-label={t(locale, "session.clear")}><ChatIcon name="clear" /></button>
        </header>

        <div className="connection-toolbar">
          <span className={`connection-status ${busy ? "is-working" : ""}`} role="status">
            {t(locale, permission ? "layout.awaitingPermission" : configuring ? "layout.configuring" : connecting ? "connection.connecting" : busy ? "layout.working" : connected ? "session.connected" : "session.idle")}
            {usingFake && <span className="fixture-badge">{t(locale, "session.fakeTitle")}</span>}
          </span>
          <div className="connection-actions">
            {!cwd && <button type="button" className="subtle-button" onClick={() => void pickFolder()} disabled={contextLocked}>{t(locale, "session.pickFolder")}</button>}
            {connecting ? <button type="button" className="subtle-button" onClick={() => void disconnect()}>{t(locale, "navigation.cancelConnection")}</button> : connected ? <button type="button" className="subtle-button" disabled={agentChanging || switching} onClick={() => void disconnect()}>{t(locale, "session.disconnect")}</button> : <>
              {savedSessionId && <button type="button" className="subtle-button" onClick={() => void connect("resume")} disabled={!canResume}
                aria-describedby={!busy ? "connection-help" : undefined}
                title={loadSessionSupported === false ? t(locale, "session.resumeTitleUnsupported") : t(locale, "connection.resumeHelp")}>{t(locale, "connection.connectResume")}</button>}
              {savedSessionId ? <button type="button" className="subtle-button" onClick={startConversation} disabled={!canNavigate}
                title={t(locale, "navigation.newHelp")}>{t(locale, "navigation.newConversation")}</button>
                : <button type="button" className="connect-button" onClick={() => void connect("new")} disabled={!canConnectNew || recoveryRequired}
                  aria-describedby={!busy ? "connection-help" : undefined}
                  title={t(locale, canConnectNew ? "connection.newHelp" : preparationHint, { name: selected?.name ?? t(locale, "chat.agent") })}>{t(locale, "session.connect")}</button>}

            </>}
          </div>
        </div>
        {!connected && !busy && <div className="connection-guidance" id="connection-help" role="status">
          <p>{t(locale, preparationHint, { name: selected?.name ?? t(locale, "chat.agent") })}</p>
          {!loading && !canConnectAgent && <button type="button" className="subtle-button" onClick={(event) => openSettings(event.currentTarget, true)}>{t(locale, "layout.agentSettings")}</button>}
          {cwd && canConnectAgent && selected?.detailCode === "npx_fallback" && !usingFake &&
            <p className="connection-download-hint">{t(locale, "connection.firstDownload")}</p>}
        </div>}
        {error && <div className="conversation-notice"><ErrorNotice error={error} locale={locale} /></div>}
        {detectError && !settingsOpen && <div className="conversation-notice"><ErrorNotice error={detectError} locale={locale} /></div>}
        {configError && <p className="conversation-notice text-xs text-ui-warning" role="alert">{t(locale, "config.failed")}</p>}
        {customEditing && !settingsOpen && <div className="conversation-notice settings-edit-notice" role="status">
          <p>{t(locale, "settings.resumeEditing")}</p><button type="button" className="subtle-button" onClick={(event) => openSettings(event.currentTarget, true)}>{t(locale, "layout.agentSettings")}</button>
        </div>}
        {loadSessionSupported === false && <p className="conversation-notice text-xs text-ui-warning">{t(locale, "session.resumeDisabledBefore")}<code>loadSession</code>{t(locale, "session.resumeDisabledAfter")}</p>}

        <ChatTranscript lines={lines} locale={locale} resetKey={`${selectedAgentId}:${cwd}:${sessionId}`} fill
          agentName={selected?.name} emptyState={<div className="chat-welcome">
            <div className="welcome-mark" aria-hidden="true"><ChatIcon name="chat" /></div>
            <p className="welcome-eyebrow">ACP DESKTOP</p>
            <h2>{t(locale, connected ? "layout.readyTitle" : "layout.welcomeTitle")}</h2>
            <p>{t(locale, connected ? "layout.readyDescription" : "layout.welcomeDescription", { name: selected?.name ?? "Agent" })}</p>
            {connected ? <div className="welcome-context"><ChatIcon name="folder" /><span>{workspaceName ?? t(locale, "layout.noWorkspace")}</span><span aria-hidden="true">·</span><span>{selected?.name ?? "Agent"}</span></div>
              : <ol className="connection-checklist" aria-label={t(locale, "connection.steps")}>
                <li data-ready={!!cwd}><span className="step-number" aria-hidden="true">1</span><div><span>{t(locale, "layout.workspace")}</span><strong title={cwd ?? undefined}>{workspaceName ?? t(locale, "session.pickFolder")}</strong></div></li>
                <li data-ready={canConnectAgent}><span className="step-number" aria-hidden="true">2</span><div><span>{t(locale, "chat.agent")}</span><strong>{selected?.name ?? t(locale, "connection.chooseAgent")}{selected && !canConnectAgent && !loading ? ` · ${t(locale, "agents.missing")}` : ""}</strong></div></li>
                <li><span className="step-number" aria-hidden="true">3</span><div><span>{t(locale, "session.send")}</span><strong>{t(locale, "connection.startConversation")}</strong></div></li>
              </ol>}
          </div>}>
          {permission && <div ref={permissionCardRef}><PermissionCard permission={permission} allowButtonRef={allowButtonRef} onRespond={(id) => void respondPermission(id)} locale={locale} /></div>}
        </ChatTranscript>

        <footer className="composer-dock">
          {connected && <details className="session-options">
            <summary>{t(locale, "layout.sessionOptions")}{configError && <span className="ml-2 text-ui-warning">{t(locale, "layout.configFailed")}</span>}</summary>
            <div className="session-options-content"><AgentSessionInfo metadata={metadata?.sessionId === sessionId ? metadata : null} locale={locale}
              disabled={agentChanging || busy || connecting || submitting || configuring || switching || !!permission} onCommand={insertCommand} configFailed={configError} onConfigure={(id, value) => void setConfig(id, value)} /></div>
          </details>}
          <MessageComposer draft={draft} locale={locale}
            disabled={agentChanging || switching || !!permission} working={busy || configuring} connecting={connecting} focusToken={composerFocus}
            permissionOpen={!!permission} canSend={canSend} canCancel={canCancel} connected={connected}
            agentName={selected?.name ?? "Agent"}
            placeholder={connected ? usingFake ? t(locale, "session.placeholderConnectedFake") : t(locale, "session.placeholderConnected", { name: selected?.name ?? "agent" }) : t(locale, "navigation.placeholderDraft")}
            onDraftChange={setDraft} onSend={send} onCancel={cancel} />
        </footer>
      </section>
      <SettingsPanel macOS={macOS} open={settingsOpen && !permission} locale={locale} onClose={closeSettings} closeRef={settingsCloseRef}>
        {configError && <p className="settings-notice text-xs text-ui-warning" role="alert">{t(locale, "config.failed")}</p>}
        {error && <ErrorNotice error={error} locale={locale} />}
        {detectError && <ErrorNotice error={detectError} locale={locale} />}
        <section className="settings-appearance" aria-label={t(locale, "settings.appearance")}><h3>{t(locale, "settings.appearance")}</h3>
          <div className="sidebar-preferences">
            <label htmlFor="theme-select" className="text-xs text-ui-muted">{t(locale, "theme.label")}</label>
            <select id="theme-select" className="locale-select theme-select" value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
              <option value="system">{t(locale, "theme.system")}</option>
              <option value="light">{t(locale, "theme.light")}</option>
              <option value="dark">{t(locale, "theme.dark")}</option>
            </select>
          </div>
          <div className="sidebar-preferences">
            <label htmlFor="settings-language" className="text-xs text-ui-muted">{t(locale, "language.label")}</label>
            <select id="settings-language" value={locale} onChange={(e) => setLocale(e.target.value as Locale)} aria-label={t(locale, "language.label")} className="locale-select">
              <option value="en">English</option><option value="zh-CN">简体中文</option>
            </select>
          </div>
        </section>
          <details ref={agentSettingsRef} className="sidebar-details">
            <summary>{t(locale, "layout.agentSettings")}</summary>
            <button type="button" onClick={() => void refresh()} disabled={loading || contextLocked} className="subtle-button my-3">
              {loading ? t(locale, "agents.checking") : t(locale, "agents.refresh")}
            </button>

        {authHint ? (
          <p className="mb-3 rounded-md border border-ui-link/50 bg-ui-info-bg/30 px-3 py-2 text-xs text-ui-link">
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
                  disabled={!clickable || contextLocked}
                  onClick={() => selectAgent(agent.id)}
                  className={`flex w-full items-center justify-between gap-3 py-2.5 text-left ${
                    available ? "text-ui-primary" : "text-ui-faint"
                  } ${
                    selectedRow
                      ? "rounded-md bg-ui-surface-hover/80 px-2 -mx-2"
                      : ""
                  } ${clickable ? "hover:bg-ui-surface-hover/40" : "cursor-default"}`}
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
                          <span className="ml-2 text-xs font-normal text-ui-faint">
                            {t(locale, "agents.later")}
                          </span>
                        ) : selectedRow ? (
                          <span className="ml-2 text-xs font-normal text-ui-link">
                            {t(locale, "agents.selected")}
                          </span>
                        ) : null}
                      </span>
                    </div>
                    <p className="pl-4 text-xs text-ui-faint">
                      <code>{agent.binary}</code>
                    </p>
                    {detail ? (
                      <p className="pl-4 pt-0.5 text-xs text-ui-warning">
                        {detail}
                      </p>
                    ) : null}
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      available
                        ? "bg-ui-accent-surface text-ui-success ring-1 ring-ui-success"
                        : "bg-ui-code text-ui-faint ring-1 ring-ui-border"
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
        <CustomAgents locale={locale} disabled={connected || agentChanging || busy || connecting || submitting || configuring || switching || !!permission} />

          </details>
          <details className="sidebar-details">
            <summary>{t(locale, "layout.sessionDetails")}</summary>
            <p className="mt-3 break-all text-xs leading-6 text-ui-muted">
              {t(locale, "session.cwd")}: {cwd ?? "—"}<br />
              {t(locale, "session.session")}: {sessionId ?? savedSessionId ?? "—"}
            </p>
            {loadSessionSupported !== null && <p className="mt-2 text-xs text-ui-muted">{t(locale, loadSessionSupported ? "session.loadOk" : "session.loadUnsupported")}</p>}
          </details>
      <details className="sidebar-details space-y-3">
        <summary className="cursor-pointer text-xs text-ui-faint">{t(locale, "dev.title")}</summary>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs text-ui-warning">
              {t(locale, "dev.blurbBefore")}
              <code className="text-ui-warning">
                session/request_permission
              </code>
              {t(locale, "dev.blurbAfter")}
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs text-ui-warning">
            <input
              type="checkbox"
              checked={!!override?.usingOverride}
              disabled={connected || contextLocked}
              onChange={(e) => {
                void setFakeAgent(e.target.checked).catch(() => undefined);
              }}
              className="rounded border-ui-warning"
            />
            {t(locale, "dev.useFake")}
          </label>
        </div>
        <p className="text-xs text-ui-warning break-all">
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
      </SettingsPanel>
    </main>
  );
}
