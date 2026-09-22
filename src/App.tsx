import { useEffect, useRef } from "react";
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
import { useAgentsStore } from "./store/agents";
import { useSessionStore } from "./store/session";

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

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void hydrateFromPrefs();
  }, [hydrateFromPrefs]);

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
  useEffect(() => {
    if (!permission) return;
    // Focus first Allow* (else first option) so Mac E2E keys land on the card.
    allowButtonRef.current?.focus();
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
  const authHint = agentAuthHint(selectedAgentId, usingFake);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-8">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
          ACP client
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          acp-desktop
        </h1>
        <p className="text-sm text-slate-400">
          ACP host path: last folder restores on launch; switch Grok / Codex
          in the Agents list (histories stay per-vendor). Connect via host
          APIs, stream a turn, approve tools with Ask, resume via{" "}
          <code className="text-slate-300">session/load</code>.
        </p>
      </header>

      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-slate-200">Agents</h2>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-slate-400">
              Switch
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
                      {a.available ? "" : " (missing)"}
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
              {loading ? "Checking…" : "Refresh"}
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
            const selected = agent.id === selectedAgentId;
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
                    selected
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
                            later
                          </span>
                        ) : selected ? (
                          <span className="ml-2 text-xs font-normal text-sky-400">
                            selected
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
                    {available ? "available" : "missing"}
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
              Dev: fake ACP agent
            </h2>
            <p className="text-xs text-amber-200/70">
              Deterministic{" "}
              <code className="text-amber-100/90">session/request_permission</code>{" "}
              for permission-card E2E (process env only; not persisted).
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
            Use fake agent
          </label>
        </div>
        <p className="text-xs text-amber-200/60 break-all">
          mode: {override?.mode ?? "…"} · cmd:{" "}
          <code>{override?.command?.join(" ") ?? "—"}</code>
          {override?.fakeAgentPath
            ? ` · binary ${override.fakeAgentPath}`
            : usingFake
              ? " · binary missing (cargo build -p fake-acp-agent)"
              : ""}
        </p>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
        <h2 className="text-sm font-medium text-slate-200">
          {usingFake
            ? "Fake agent session"
            : `${selected?.name ?? "Agent"} session`}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void pickFolder()}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:border-slate-500"
          >
            Pick folder
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
                        ? "Agent does not advertise loadSession"
                        : busy
                          ? "Busy…"
                          : `Resume session ${savedSessionId}`
                    }
                    className="rounded-md bg-violet-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                  >
                    Resume
                  </button>
                  <button
                    type="button"
                    onClick={() => void connect("new")}
                    disabled={!canConnectNew}
                    className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                  >
                    New session
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => void connect("new")}
                  disabled={!canConnectNew}
                  className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                >
                  Connect
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              onClick={() => void disconnect()}
              className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-200"
            >
              Disconnect
            </button>
          )}
          <button
            type="button"
            onClick={clearTranscript}
            className="rounded-md border border-slate-800 px-3 py-1.5 text-xs text-slate-400"
          >
            Clear
          </button>
        </div>
        <p className="text-xs text-slate-500 break-all">
          cwd: {cwd ?? "—"} {sessionId ? `· session ${sessionId}` : ""}{" "}
          {savedSessionId && !sessionId
            ? `· saved ${savedSessionId}`
            : ""}{" "}
          {connected ? "· connected" : "· idle"}
          {loadSessionSupported === false
            ? " · loadSession unsupported"
            : loadSessionSupported === true
              ? " · loadSession ok"
              : ""}
        </p>
        {loadSessionSupported === false ? (
          <p className="rounded-md border border-amber-900/60 bg-amber-950/40 px-3 py-2 text-sm text-amber-200">
            Resume disabled: agent did not advertise{" "}
            <code>loadSession</code>. Use New session.
          </p>
        ) : null}
        {error ? (
          <p className="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        ) : null}

        <div className="h-64 overflow-y-auto rounded-lg border border-slate-800 bg-black/30 p-3 text-sm space-y-2">
          {lines.length === 0 ? (
            <p className="text-slate-600">Transcript appears here…</p>
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
                  ? "Message fake agent…"
                  : `Message ${selected?.name ?? "agent"}…`
                : "Connect first"
            }
            className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={!canSend}
            className="rounded-md bg-sky-700 px-3 py-2 text-sm text-white disabled:opacity-40"
          >
            Send
          </button>
          <button
            type="button"
            onClick={() => void cancel()}
            disabled={!canCancel}
            title={
              permission
                ? "Cancel prompt and clear pending Ask"
                : busy
                  ? "Cancel in-flight prompt"
                  : undefined
            }
            className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-300 disabled:opacity-40"
          >
            Cancel
          </button>
        </div>
      </section>

      {permission ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl space-y-3">
            <h3 className="text-base font-semibold text-white">
              {permission.title}
            </h3>
            <p className="text-xs text-slate-400 break-all">{permission.detail}</p>
            <div className="flex flex-wrap gap-2 pt-2">
              {permission.options.map((opt, idx) => {
                const isAllow = opt.kind.startsWith("Allow");
                const focusFirst =
                  isAllow
                    ? permission.options.findIndex((o) =>
                        o.kind.startsWith("Allow"),
                      ) === idx
                    : permission.options.findIndex((o) =>
                        o.kind.startsWith("Allow"),
                      ) < 0 && idx === 0;
                return (
                <button
                  key={opt.id}
                  type="button"
                  ref={focusFirst ? allowButtonRef : undefined}
                  onClick={() => void respondPermission(opt.id)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                    isAllow
                      ? "bg-emerald-700 text-white"
                      : opt.kind.startsWith("Reject")
                        ? "bg-red-800 text-white"
                        : "border border-slate-600 text-slate-200"
                  }`}
                >
                  {opt.name}
                </button>
                );
              })}
              <button
                type="button"
                onClick={() => void respondPermission(null)}
                className="rounded-md border border-slate-600 px-3 py-1.5 text-xs text-slate-300"
              >
                Cancel
              </button>
            </div>
            <p className="text-[10px] text-slate-500 pt-1">
              Keys:{" "}
              <kbd className="text-slate-400">a</kbd>/<kbd className="text-slate-400">Enter</kbd>{" "}
              Allow · <kbd className="text-slate-400">r</kbd> Reject ·{" "}
              <kbd className="text-slate-400">Esc</kbd> Cancel
            </p>
          </div>
        </div>
      ) : null}
    </main>
  );
}
