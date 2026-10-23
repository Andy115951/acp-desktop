import { isSessionLoadFailedError } from "./sessionPrefs";
import type { MessageKey } from "./i18n";

/** Classify app-owned guidance while retaining the original diagnostic. */
export function errorHintKey(error: string): MessageKey {
  if (/usage.?limit|quota|rate.?limit|plan or rate limit/i.test(error)) {
    return "error.usageLimit";
  }
  if (isSessionLoadFailedError(error)) return "error.staleSession";
  if (/certificate|UNABLE_TO_GET_ISSUER|TLS|SSL/i.test(error)) {
    return "error.connection";
  }
  if (/auth|sign.?in|login|API Key disabled|401|403/i.test(error)) {
    return "error.auth";
  }
  if (/Pick a workspace folder/i.test(error)) return "error.workspace";
  if (/No saved session/i.test(error)) return "error.noSavedSession";
  if (/does not advertise loadSession/i.test(error)) {
    return "error.resumeUnsupported";
  }
  if (/failed to spawn|failed to configure|command not found|npx|executable/i.test(error)) {
    return "error.startup";
  }
  return "error.general";
}
