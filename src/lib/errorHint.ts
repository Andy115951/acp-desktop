import { isSessionLoadFailedError } from "./sessionPrefs";
import type { MessageKey } from "./i18n";

/** Classify app-owned guidance while retaining the original diagnostic. */
export function errorHintKey(error: string): MessageKey {
  // Backend setup tips are supplementary; classify the primary diagnostic.
  error = error.split(/\n\n(?:Codex |Claude |Copilot |If this looks)/)[0];
  if (/usage.?limit|quota|rate.?limit|plan or rate limit/i.test(error)) {
    return "error.usageLimit";
  }
  if (isSessionLoadFailedError(error)) return "error.staleSession";
  if (/certificate|UNABLE_TO_GET_ISSUER|TLS|SSL/i.test(error)) {
    return "error.connection";
  }
  if (/timed? ?out|timeout/i.test(error)) return "error.timeout";
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|network unreachable|fetch failed/i.test(error)) return "error.network";
  if (/failed to spawn|failed to configure|command not found|not found on PATH|ENOENT|executable/i.test(error)) return "error.startup";
  if (/auth|sign.?in|login|API Key disabled|401|403/i.test(error)) {
    return "error.auth";
  }
  if (/initialize failed|ACP handshake|protocol version|invalid JSON|parse error/i.test(error)) return "error.handshake";
  if (/session\/new failed/i.test(error)) return "error.session";
  if (/respond_permission|permission.*(?:failed|error)/i.test(error)) return "error.permission";
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
