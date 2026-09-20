import { useEffect } from "react";
import { useAgentsStore } from "./store/agents";

export default function App() {
  const { agents, loading, error, refresh } = useAgentsStore();

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-6 py-10">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
          ACP client
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          acp-desktop
        </h1>
        <p className="text-sm text-slate-400">
          Detect local agent CLIs on <code className="text-slate-300">PATH</code>.
          Missing agents stay grey. No ACP handshake yet.
        </p>
      </header>

      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 shadow-lg shadow-black/20">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-slate-200">Agents</h2>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-300 transition hover:border-slate-500 hover:text-white disabled:opacity-50"
          >
            {loading ? "Checking…" : "Refresh"}
          </button>
        </div>

        {error ? (
          <p className="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        ) : null}

        <ul className="divide-y divide-slate-800">
          {agents.map((agent) => {
            const isGrok = agent.id === "grok";
            const available = agent.available;
            return (
              <li
                key={agent.id}
                className={`flex items-center justify-between gap-3 py-3 ${
                  available ? "text-slate-100" : "text-slate-500"
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${
                        available ? "bg-emerald-400" : "bg-slate-600"
                      }`}
                      aria-hidden
                    />
                    <span className={`truncate font-medium ${available ? "" : "opacity-70"}`}>
                      {agent.name}
                      {!isGrok ? (
                        <span className="ml-2 text-xs font-normal text-slate-600">
                          later
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate pl-4 text-xs text-slate-500">
                    <code>{agent.binary}</code>
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
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

        {!loading && agents.length === 0 && !error ? (
          <p className="text-sm text-slate-500">No agents reported.</p>
        ) : null}
      </section>
    </main>
  );
}
