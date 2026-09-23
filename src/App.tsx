import { useEffect, useRef } from "react";
import { PermissionCard } from "./PermissionCard";
import { permissionHotkeyAction } from "./lib/permissionHotkey";
import {
  canCancelPrompt,
  canConnectNewSession,
  canConnectSelectedAgent,
  canResumeSession,
  canSendPrompt,
  draftEnterShouldSend,
} from "./lib/sessionUiGates";
import { agentAuthHint } from "./lib/agentHints";
import { shouldDisconnectOnAgentSwitch } from "./lib/agentSwitch";
import { t, type Locale } from "./lib/i18n";
import { useAgentsStore } from "./store/agents";
import { useSessionStore } from "./store/session";
import { useUiStore } from "./store/ui";

export default function App() {
  const {
    agents,
    selectedAgentId,
    loading,
    error: detectError,
    override,
    refresh,
    selectAgent,
    setFakeAgent,
  } = useAgentsStore();
  const {
    cwd,
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
  const usingFake = !!override?.usingOverride;
  const canConnectAgent = canConnectSelectedAgent(
    selected?.connectable,
    selected?.available,
    usingFake,
  );
  const uiGates = {
    cwd,
    connected,
    busy,
    permissionOpen: !!permission,
    draftTrimmed: !!draft.trim(),
    savedSessionId,
    loadSessionSupported,
    canConnectAgent,
  };
  const canResume = canResumeSession(uiGates);
  const canConnectNew = canConnectNewSession(uiGates);
  const canSend = canSendPrompt(uiGates);
  const canCancel = canCancelPrompt(uiGates);
  const authHint = agentAuthHint(selectedAgentId, usingFake, locale);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-8">
      <header className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
              {t(locale, "badge.acpClient")}
            </p>
            <h1 className="text-2xl font-semibold tracking-tight text-white">
              acp-desktop
            </h1>
          </div>
          <label className="flex items-center gap-1.5 text-xs text-slate-400">
            {t(locale, "language.label")}
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value as Locale)}
              className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200"
              aria-label={t(locale, "language.label")}
            >
              <option value="en">English</option>
              <option value="zh-CN">简体中文</option>
            </select>
          </label>
        </div>
        <p className="text-sm text-slate-400">
          {t(locale, "header.taglineBefore")}
          <code className="text-slate-300">session/load</code>
          {t(locale, "header.taglineAfter")}
        </p>
      </header>

      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-slate-200">
            {t(locale, "agents.title")}
          </h2>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-slate-400">
              {t(locale, "agents.switch")}
              <select
                value={selectedAgentId}
                disabled={busy}
                onChange={(e) => selectAgent(e.target.value)}
                className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200"
              >
                {agents
                  .filter((a) => a.connectable)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                      {a.available ? "" : t(locale, "agents.missingSuffix")}
                    </option>
                  ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={loading}
              className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:border-slate-500 disabled:opacity-50"
            >
              {loading
                ? t(locale, "agents.checking")
                : t(locale, "agents.refresh")}
            </button>
          </div>
        </div>
        {detectError ? (
          <p className="mb-2 text-sm text-red-300">{detectError}</p>
        ) : null}
        {authHint ? (
          <p className="mb-3 rounded-md border border-sky-900/50 bg-sky-950/30 px-3 py-2 text-xs text-sky-200/90">
            {authHint}
          </p>
        ) : null}
        <ul className="divide-y divide-slate-800">
          {agents.map((agent) => {
            const available = agent.available;
            const selectedRow = agent.id === selectedAgentId;
            const clickable = agent.connectable;
            return (
              <li key={agent.id}>
                <button
                  type="button"
                  disabled={!clickable}
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
                    {agent.detail ? (
                      <p className="pl-4 pt-0.5 text-xs text-amber-200/80">
                        {agent.detail}
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
      </section>

      <section className="rounded-xl border border-amber-900/50 bg-amber-950/20 p-4 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-amber-100">
              {t(locale, "dev.title")}
            </h2>
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
              checked={usingFake}
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
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
        <h2 className="text-sm font-medium text-slate-200">
          {usingFake
            ? t(locale, "session.fakeTitle")
            : t(locale, "session.agentTitle", {
                name: selected?.name ?? "Agent",
              })}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void pickFolder()}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:border-slate-500"
          >
            {t(locale, "session.pickFolder")}
          </button>
          {!connected ? (
            <>
              {savedSessionId ? (
                <>
                  <button
                    type="button"
                    onClick={() => void connect("resume")}
                    disabled={!canResume}
                    title={
                      loadSessionSupported === false
                        ? t(locale, "session.resumeTitleUnsupported")
                        : busy
                          ? t(locale, "session.resumeTitleBusy")
                          : t(locale, "session.resumeTitleId", {
                              id: savedSessionId,
                            })
                    }
                    className="rounded-md bg-violet-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                  >
                    {t(locale, "session.resume")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void connect("new")}
                    disabled={!canConnectNew}
                    className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                  >
                    {t(locale, "session.newSession")}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => void connect("new")}
                  disabled={!canConnectNew}
                  className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                >
                  {t(locale, "session.connect")}
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              onClick={() => void disconnect()}
              className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-200"
            >
              {t(locale, "session.disconnect")}
            </button>
          )}
          <button
            type="button"
            onClick={clearTranscript}
            className="rounded-md border border-slate-800 px-3 py-1.5 text-xs text-slate-400"
          >
            {t(locale, "session.clear")}
          </button>
        </div>
        <p className="text-xs text-slate-500 break-all">
          {t(locale, "session.cwd")}: {cwd ?? "—"}{" "}
          {sessionId
            ? `· ${t(locale, "session.session")} ${sessionId}`
            : ""}{" "}
          {savedSessionId && !sessionId
            ? `· ${t(locale, "session.saved")} ${savedSessionId}`
            : ""}{" "}
          {connected
            ? `· ${t(locale, "session.connected")}`
            : `· ${t(locale, "session.idle")}`}
          {loadSessionSupported === false
            ? ` · ${t(locale, "session.loadUnsupported")}`
            : loadSessionSupported === true
              ? ` · ${t(locale, "session.loadOk")}`
              : ""}
        </p>
        {loadSessionSupported === false ? (
          <p className="rounded-md border border-amber-900/60 bg-amber-950/40 px-3 py-2 text-sm text-amber-200">
            {t(locale, "session.resumeDisabledBefore")}
            <code>loadSession</code>
            {t(locale, "session.resumeDisabledAfter")}
          </p>
        ) : null}
        {error ? (
          <p className="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        ) : null}

        <div className="h-64 overflow-y-auto rounded-lg border border-slate-800 bg-black/30 p-3 text-sm space-y-2">
          {lines.length === 0 && !permission ? (
            <p className="text-slate-600">
              {t(locale, "session.transcriptEmpty")}
            </p>
          ) : (
            lines.map((line) => (
              <div key={line.id} className="whitespace-pre-wrap">
                <span className="mr-2 text-[10px] uppercase tracking-wide text-slate-500">
                  {line.kind}
                </span>
                <span
                  className={
                    line.kind === "user"
                      ? "text-sky-200"
                      : line.kind === "agent_thought"
                        ? "text-violet-300/80 italic"
                        : line.kind === "status"
                          ? "text-amber-200/90"
                          : "text-slate-100"
                  }
                >
                  {line.text}
                </span>
              </div>
            ))
          )}
          {permission ? (
            <div ref={permissionCardRef}>
              <PermissionCard
                permission={permission}
                allowButtonRef={allowButtonRef}
                onRespond={(id) => void respondPermission(id)}
                locale={locale}
              />
            </div>
          ) : null}
        </div>

        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (!draftEnterShouldSend(!!permission, e.key, e.shiftKey)) return;
              e.preventDefault();
              void send();
            }}
            disabled={!connected || busy || !!permission}
            placeholder={
              connected
                ? usingFake
                  ? t(locale, "session.placeholderConnectedFake")
                  : t(locale, "session.placeholderConnected", {
                      name: selected?.name ?? "agent",
                    })
                : t(locale, "session.placeholderIdle")
            }
            className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={!canSend}
            className="rounded-md bg-sky-700 px-3 py-2 text-sm text-white disabled:opacity-40"
          >
            {t(locale, "session.send")}
          </button>
          <button
            type="button"
            onClick={() => void cancel()}
            disabled={!canCancel}
            title={
              permission
                ? t(locale, "session.cancelTitleAsk")
                : busy
                  ? t(locale, "session.cancelTitleBusy")
                  : undefined
            }
            className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-300 disabled:opacity-40"
          >
            {t(locale, "session.cancel")}
          </button>
        </div>
      </section>
    </main>
  );
}
