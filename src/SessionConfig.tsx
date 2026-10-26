import type { ConfigOption } from "./lib/sessionMetadata";
import { t, type Locale } from "./lib/i18n";

export function SessionConfig({ options, disabled, failed, locale, onChange }: {
  options?: ConfigOption[]; disabled: boolean; failed: boolean; locale: Locale;
  onChange: (id: string, value: string) => void;
}) {
  return <section className="space-y-2" aria-label={t(locale, "config.title")}>
    <h3 className="font-medium text-slate-300">{t(locale, "config.title")}</h3>
    {options === undefined ? <p>{t(locale, "config.unknown")}</p> : options.length === 0 ? <p>{t(locale, "config.empty")}</p>
      : options.map(option => <div key={option.id}>
        <label className="flex flex-wrap items-center gap-2">
          <span>{option.name}</span>
          {option.writable ? <select aria-label={option.name} value={option.currentValue ?? ""} disabled={disabled}
            onChange={event => onChange(option.id, event.target.value)}
            className="max-w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-200 disabled:opacity-40">
            {!option.choices.some(choice => choice.value === option.currentValue)
              ? <option value={option.currentValue ?? ""} disabled>{option.currentValue ?? t(locale, "config.valueUnknown")}</option> : null}
            {option.choices.map(choice => <option key={choice.value} value={choice.value}>
              {choice.group ? `${choice.group} · ` : ""}{choice.name}
            </option>)}
          </select> : <span>{t(locale, "config.unsupported")}</span>}
        </label>
        {option.description ? <p className="mt-1 text-slate-500">{option.description}</p> : null}
      </div>)}
    {failed ? <p role="alert" className="text-amber-200">{t(locale, "config.failed")}</p> : null}
  </section>;
}
