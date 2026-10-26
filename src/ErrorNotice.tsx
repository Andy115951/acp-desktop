import { errorHintKey } from "./lib/errorHint";
import { t, type Locale } from "./lib/i18n";

export function ErrorNotice({ error, locale }: { error: string; locale: Locale }) {
  return (
    <section role="alert" className="rounded-md border border-ui-error/60 bg-ui-error-bg/40 px-3 py-2 text-sm text-ui-error">
      <p>{t(locale, errorHintKey(error))}</p>
      <details className="mt-2 text-xs text-ui-muted">
        <summary className="cursor-pointer">{t(locale, "error.details")}</summary>
        <pre className="mt-2 whitespace-pre-wrap break-all">{error}</pre>
      </details>
    </section>
  );
}
