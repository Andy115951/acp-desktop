import { useEffect } from "react";
import { useAgentsStore } from "./store/agents";
import { useSessionStore } from "./store/session";

export default function App() {
  const {
    agents,
    loading,
    error: detectError,
    override,
    refresh,
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
    let cleanup: (() => void) | undefined;
    void bindEvents().then((fn) => {
      cleanup = fn;
    });
    return () => cleanup?.();
  }, [bindEvents]);

  const grok = agents.find((a) => a.id === "grok");
  const usingFake = !!override?.usingOverride;
  const canConnectAgent = !!grok?.available || usingFake;
  const canResume =
    !!savedSessionId &&
    loadSessionSupported !== false &&
    !!cwd &&
    !connected &&
    canConnectAgent;

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
          M2: pick a folder, connect Grok via{" "}
          <code className="text-slate-300">grok agent stdio</code>, stream a
          turn, approve tools with Ask, resume via{" "}
          <code className="text-slate-300">session/load</code>.
        </p>
      </header>

      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-slate-200">Agents</h2>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:border-slate-500 disabled:opacity-50"
          >
            {loading ? "Checking…" : "Refresh"}
          </button>
        </div>
        {detectError ? (
          <p className="mb-2 text-sm text-red-300">{detectError}</p>
        ) : null}
        <ul className="divide-y divide-slate-800">
          {agents.map((agent) => {
            const available = agent.available;
            return (
              <li
                key={agent.id}
                className={`flex items-center justify-between gap-3 py-2.5 ${
                  available ? "text-slate-100" : "text-slate-500"
                }`}
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
                      {agent.id !== "grok" ? (
                        <span className="ml-2 text-xs font-normal text-slate-600">
                          later
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <p className="pl-4 text-xs text-slate-500">
                    <code>{agent.binary}</code>
                  </p>
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
          {usingFake ? "Fake agent session" : "Grok session"}
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
                    disabled={!canResume || busy}
                    title={
                      loadSessionSupported === false
                        ? "Agent does not advertise loadSession"
                        : `Resume session ${savedSessionId}`
                    }
                    className="rounded-md bg-violet-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                  >
                    Resume
                  </button>
                  <button
                    type="button"
                    onClick={() => void connect("new")}
                    disabled={!cwd || !canConnectAgent || busy}
                    className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                  >
                    New session
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => void connect("new")}
                  disabled={!cwd || !canConnectAgent || busy}
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
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            disabled={!connected || busy}
            placeholder={connected ? (usingFake ? "Message fake agent…" : "Message Grok…") : "Connect first"}
            className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={!connected || busy || !draft.trim()}
            className="rounded-md bg-sky-700 px-3 py-2 text-sm text-white disabled:opacity-40"
          >
            Send
          </button>
          <button
            type="button"
            onClick={() => void cancel()}
            disabled={!connected || !busy}
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
              {permission.options.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => void respondPermission(opt.id)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                    opt.kind.startsWith("Allow")
                      ? "bg-emerald-700 text-white"
                      : opt.kind.startsWith("Reject")
                        ? "bg-red-800 text-white"
                        : "border border-slate-600 text-slate-200"
                  }`}
                >
                  {opt.name}
                </button>
              ))}
              <button
                type="button"
                onClick={() => void respondPermission(null)}
                className="rounded-md border border-slate-600 px-3 py-1.5 text-xs text-slate-300"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
