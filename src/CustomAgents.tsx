import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { parseLaunchFields, type CustomAgent } from "./lib/customAgents";
import { t, type Locale } from "./lib/i18n";
import { useAgentsStore } from "./store/agents";

const field = "w-full rounded border border-ui-border bg-ui-code px-2 py-1.5 text-sm text-ui-primary disabled:opacity-50";
const button = "rounded border border-ui-border px-2 py-1 text-xs text-ui-secondary disabled:opacity-50";

export function CustomAgents({ locale, disabled }: { locale: Locale; disabled: boolean }) {
  const { agents, refresh, selectAgent, setCustomEditing } = useAgentsStore();
  const [profiles, setProfiles] = useState<CustomAgent[]>([]);
  const [editing, setEditing] = useState(false);
  const [id, setId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [executable, setExecutable] = useState("");
  const [args, setArgs] = useState("[]");
  const [env, setEnv] = useState("{}");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    try {
      setProfiles(await invoke<CustomAgent[]>("list_custom_agents"));
      setLoaded(true);
      setFailed(false);
    } catch { setFailed(true); setLoaded(false); }
  };
  useEffect(() => { void load(); }, [agents]);
  useEffect(() => () => setCustomEditing(false), [setCustomEditing]);

  const edit = (profile?: CustomAgent) => {
    setId(profile?.id ?? null); setName(profile?.name ?? ""); setExecutable(profile?.executable ?? "");
    setArgs(JSON.stringify(profile?.args ?? [], null, 2)); setEnv(JSON.stringify(profile?.env ?? {}, null, 2));
    setDetail(null); setFailed(false); setRemoveId(null); setEditing(true); setCustomEditing(true);
  };
  const close = () => { setEditing(false); setRemoveId(null); setCustomEditing(false); setDetail(null); };
  const save = async () => {
    if (disabled || pending) return;
    let fields: ReturnType<typeof parseLaunchFields>;
    try { fields = parseLaunchFields(args, env); } catch { setFailed(true); setDetail(null); return; }
    setPending(true); setFailed(false); setDetail(null);
    try {
      const saved = await invoke<CustomAgent>("save_custom_agent", { input: { id, name, executable, ...fields } });
      setProfiles((previous) => [...previous.filter((p) => p.id !== saved.id), saved]);
      await refresh();
      selectAgent(saved.id);
      close();
    } catch (error) {
      setFailed(true);
      // Host returns validation/recovery text only, never rejected field values.
      setDetail(typeof error === "string" ? error : null);
    } finally { setPending(false); }
  };
  const remove = async (profileId: string) => {
    if (disabled || pending) return;
    setPending(true); setFailed(false); setDetail(null);
    try {
      await invoke("remove_custom_agent", { id: profileId });
      setProfiles((previous) => previous.filter((p) => p.id !== profileId));
      await refresh(); close();
    } catch { setFailed(true); } finally { setPending(false); }
  };

  return <details className="mt-3 border-t border-ui-border-soft pt-3">
    <summary className="cursor-pointer text-sm text-ui-secondary">{t(locale, "custom.title")}</summary>
    <p className="my-2 text-xs text-ui-muted">{t(locale, "custom.help")}</p>
    {disabled && <p className="mb-2 text-xs text-ui-warning">{t(locale, "custom.disconnect")}</p>}
    {failed && <div role="alert" className="mb-2 text-xs text-ui-error"><p>{t(locale, "custom.failed")}</p>{detail && <p>{detail}</p>}</div>}
    {!loaded && <button type="button" className={button} onClick={() => void load()}>{t(locale, "agents.refresh")}</button>}
    {!editing && <div className="space-y-2">
      {profiles.map((profile) => <div key={profile.id} className="flex flex-wrap items-center justify-between gap-2 text-xs text-ui-secondary">
        <span>{profile.name}</span>
        <div className="flex gap-2">
          <button type="button" className={button} disabled={disabled || pending} onClick={() => edit(profile)}>{t(locale, "custom.edit")}</button>
          <button type="button" className={button} disabled={disabled || pending} onClick={() => { setRemoveId(profile.id); setCustomEditing(true); }}>{t(locale, "custom.remove")}</button>
        </div>
      </div>)}
      {removeId && <div className="space-y-2 rounded border border-ui-warning p-2">
        <p className="text-xs text-ui-warning">{t(locale, "custom.removeHelp")}</p>
        <button type="button" className={button} disabled={disabled || pending} onClick={() => void remove(removeId)}>{t(locale, "custom.confirmRemove")}</button>{" "}
        <button type="button" className={button} disabled={pending} onClick={close}>{t(locale, "custom.cancel")}</button>
      </div>}
      <button type="button" className={button} disabled={disabled || pending || !loaded} onClick={() => edit()}>{t(locale, "custom.add")}</button>
    </div>}
    {editing && <form onSubmit={(event) => { event.preventDefault(); void save(); }} className="space-y-3">
      <fieldset disabled={disabled || pending} className="space-y-3">
        {id && <p className="break-all text-xs text-ui-faint">ID: {id}</p>}
        <label className="block text-xs text-ui-muted">{t(locale, "custom.name")}<input autoFocus className={field} value={name} required maxLength={100} onChange={(e) => setName(e.target.value)} /></label>
        <label className="block text-xs text-ui-muted">{t(locale, "custom.executable")}<input className={field} value={executable} required placeholder="/path with spaces/agent" onChange={(e) => setExecutable(e.target.value)} /></label>
        <label className="block text-xs text-ui-muted">{t(locale, "custom.args")}<textarea className={`${field} font-mono`} rows={3} value={args} onChange={(e) => setArgs(e.target.value)} spellCheck={false} /></label>
        <p className="text-xs text-ui-faint">{t(locale, "custom.argsHelp")}</p>
        <label className="block text-xs text-ui-muted">{t(locale, "custom.env")}<textarea className={`${field} font-mono`} rows={3} value={env} onChange={(e) => setEnv(e.target.value)} spellCheck={false} /></label>
        <button type="submit" className={button}>{t(locale, "custom.save")}</button>{" "}
        <button type="button" className={button} onClick={close}>{t(locale, "custom.cancel")}</button>
      </fieldset>
    </form>}
  </details>;
}
