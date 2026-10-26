import { SessionConfig } from "./SessionConfig";
import { t, type Locale } from "./lib/i18n";
import type { SessionMetadata } from "./lib/sessionMetadata";

export function AgentSessionInfo({ metadata, locale, disabled, onCommand, configFailed = false, onConfigure = () => {} }: {
  configFailed?: boolean; onConfigure?: (id: string, value: string) => void;
  metadata: SessionMetadata | null; locale: Locale; disabled: boolean; onCommand: (name: string) => void;
}) {
  return <aside className="space-y-2 rounded-md border border-ui-border-soft px-3 py-2 text-xs text-ui-muted" aria-label={t(locale, "agentInfo.title")}>
    <SessionConfig options={metadata?.configOptions} disabled={disabled} failed={configFailed} locale={locale} onChange={onConfigure} />
    <p>{metadata?.usage
      ? t(locale, "agentInfo.context", { used: metadata.usage.used, size: metadata.usage.size })
      : t(locale, "agentInfo.contextUnknown")}</p>
    {metadata?.commands === undefined ? <p>{t(locale, "agentInfo.commandsUnknown")}</p>
      : metadata.commands.length === 0 ? <p>{t(locale, "agentInfo.commandsEmpty")}</p>
      : <details>
        <summary className="cursor-pointer">{t(locale, "agentInfo.commands", { count: String(metadata.commands.length) })}</summary>
        <p className="my-2">{t(locale, "agentInfo.insertHelp")}</p>
        <ul className="max-h-56 space-y-2 overflow-auto">
          {metadata.commands.map(command => <li key={command.name} className="break-words">
            <button type="button" disabled={disabled} onClick={() => onCommand(command.name)}
              aria-label={t(locale, "agentInfo.insert", { name: command.name })}
              className="mr-2 rounded border border-ui-border-strong px-2 py-1 text-ui-link disabled:opacity-40">/{command.name}</button>
            <span>{command.description}</span>
            {command.inputHint ? <p className="mt-1 text-ui-faint">{command.inputHint}</p> : null}
          </li>)}
        </ul>
      </details>}
  </aside>;
}
