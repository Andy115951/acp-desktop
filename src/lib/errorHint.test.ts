import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { errorHintKey } from "./errorHint";
import { ErrorNotice } from "../ErrorNotice";

describe("error guidance", () => {
  it("recognizes quota before authentication or install suggestions", () => {
    expect(errorHintKey("403 usageLimitExceeded; npx installed; authentication required"))
      .toBe("error.usageLimit");
  });
  it("recognizes a stale session instead of a missing executable", () => {
    expect(errorHintKey("session/load failed: FS_NOT_FOUND; npx"))
      .toBe("error.staleSession");
  });
  it.each([
    ["A separate New conversation draft exists. Copy or clear this failed Resume draft before opening New conversation.", "error.draftConflict"],
    ["UNABLE_TO_GET_ISSUER_CERT", "error.connection"],
    ["API Key disabled: 403", "error.auth"],
    ["failed to spawn process", "error.startup"],
    ["Pick a workspace folder first.", "error.workspace"],
    ["No saved session for this folder.", "error.noSavedSession"],
    ["Agent does not advertise loadSession", "error.resumeUnsupported"],
    ["Unsupported ACP protocol version. This client supports ACP v1 only. Use a v1-compatible agent.", "error.handshake"],
    ["Unexpected vendor diagnostic", "error.general"],
    ["prompt failed. Retry the request or reconnect.", "error.general"],
    ["initialize failed. Check the local agent’s ACP compatibility and retry.", "error.handshake"],
    ["initialize failed: unauthorized\n\nClaude auth: login", "error.auth"],
    ["initialize failed: invalid response\n\nIf this looks like missing install or auth: login via npx", "error.handshake"],
    ["session/new failed: workspace unavailable", "error.session"],
    ["failed to spawn: ENOENT\n\nIf this looks like auth: login", "error.startup"],
    ["request timed out", "error.timeout"],
    ["fetch failed: ECONNREFUSED", "error.network"],
    ["respond_permission failed: request rejected", "error.permission"],
  ])("classifies %s", (message, key) => {
    expect(errorHintKey(message)).toBe(key);
  });
  it("localizes the summary while retaining the original error in disclosure details", () => {
    const error = "prompt failed: usageLimitExceeded";
    const zh = renderToStaticMarkup(createElement(ErrorNotice, { error, locale: "zh-CN" }));
    const en = renderToStaticMarkup(createElement(ErrorNotice, { error, locale: "en" }));
    expect(zh).toContain("已达到用量或请求频率上限");
    expect(zh).toContain("技术详情");
    expect(en).toContain("reached its usage or rate limit");
    expect(zh.indexOf(error)).toBeGreaterThan(zh.indexOf("<details"));
    expect(zh).not.toContain("<details open");
  });
});
