import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
// Zustand's server snapshot is deliberately the store's initial state. These
// static-markup checks need the explicit scenario snapshot instead; real hook
// subscriptions and click behavior are exercised by the browser acceptance.
vi.mock("../store/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../store/session")>();
  return { ...actual, useSessionStore: Object.assign(() => actual.useSessionStore.getState(), actual.useSessionStore) };
});
vi.mock("../store/agents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../store/agents")>();
  return { ...actual, useAgentsStore: Object.assign(() => actual.useAgentsStore.getState(), actual.useAgentsStore) };
});
vi.mock("../store/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../store/ui")>();
  return { ...actual, useUiStore: Object.assign(() => actual.useUiStore.getState(), actual.useUiStore) };
});
import App from "../App";
import { useAgentsStore } from "../store/agents";
import { useSessionStore } from "../store/session";
import { useUiStore } from "../store/ui";

const render = () => renderToStaticMarkup(createElement(App));
const primaryButton = (html: string) => html.match(/<button[^>]*class="connect-button"[^>]*>[\s\S]*?<\/button>/)?.[0];

beforeEach(() => {
  useAgentsStore.setState({
    agents: [{ id: "codex", name: "Codex", binary: "codex-acp", available: true, connectable: true, detailCode: "npx_fallback" }],
    selectedAgentId: "codex", loading: false, customEditing: false, error: null, override: null,
  });
  useSessionStore.setState({
    cwd: "/workspace", catalog: { version: 1, sessions: [] }, catalogError: false,
    connected: false, busy: false, switching: false, configuring: false, permission: null,
    error: null, sessionId: null, savedSessionId: null, loadSessionSupported: null,
    lines: [], draft: "", metadata: null, configError: false, recentWorkspaces: [],
    workspaceError: false, sessionListSupported: null, sessionListIncomplete: false,
  });
  useUiStore.setState({ locale: "en" });
});

describe("connection discovery and preparation", () => {
  it("keeps Connect explicit both before first use and with saved history", () => {
    expect(primaryButton(render())).toMatch(/>Connect<\/button>/);
    useSessionStore.setState({ savedSessionId: "saved-session" });
    const html = render();
    expect(primaryButton(html)).toContain("Connect &amp; start new");
    expect(primaryButton(html)).not.toContain('disabled=""');
    expect(html).toContain("Connect &amp; resume");
    expect(html).toContain("continues the selected saved conversation");
    expect(html).toContain("first connection may download an adapter");
  });
  it("provides Chinese actions and their distinct history behavior", () => {
    useUiStore.setState({ locale: "zh-CN" });
    useSessionStore.setState({ savedSessionId: "saved-session" });
    const html = render();
    expect(primaryButton(html)).toContain("连接并新建");
    expect(html).toContain("连接并恢复");
    expect(html).toContain("原有会话仍保留在历史中");
    expect(html).toContain("未连接");
  });
  it("explains a missing workspace while keeping connection disabled", () => {
    useSessionStore.setState({ cwd: null });
    const html = render();
    expect(html).toContain("Choose a workspace folder, then connect your agent.");
    expect(primaryButton(html)).toContain('disabled=""');
    expect(html).toContain('aria-describedby="connection-help"');
    expect(html).toContain('aria-label="Connection setup"');
  });
  it("exposes missing-agent recovery outside the collapsed sidebar", () => {
    useAgentsStore.setState({ agents: [{ id: "codex", name: "Codex", binary: "codex-acp", available: false, connectable: true }] });
    const html = render();
    const guidance = html.slice(html.indexOf('id="connection-help"'));
    expect(guidance).toContain("Codex was not found locally");
    expect(guidance).toMatch(/<button[^>]*>Agents &amp; settings<\/button>/);
    expect(primaryButton(html)).toContain('disabled=""');
    expect(html).not.toContain("first connection may download");
  });
  it("waits for discovery instead of connecting a stale availability result", () => {
    useAgentsStore.setState({ loading: true });
    const html = render();
    expect(html).toContain("Checking installed agents…");
    expect(html).not.toContain("Codex was not found locally");
    expect(primaryButton(html)).toContain('disabled=""');
  });
  it("distinguishes connecting from a live prompt and prevents repeated New/Resume", () => {
    useSessionStore.setState({ busy: true, savedSessionId: "saved-session" });
    const html = render();
    expect(primaryButton(html)).toContain("Connecting…");
    expect(primaryButton(html)).toContain('disabled=""');
    expect(html).not.toContain('id="connection-help"');
    useSessionStore.setState({ connected: true });
    const connectedHtml = render();
    expect(primaryButton(connectedHtml)).toBeUndefined();
    expect(connectedHtml).toContain("Disconnect");
    expect(connectedHtml).toContain("Working…");
    expect(connectedHtml).not.toContain("Connecting…");
  });
  it("keeps unsupported Resume disabled without blocking a new connection", () => {
    useSessionStore.setState({ savedSessionId: "saved-session", loadSessionSupported: false });
    const html = render();
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*title="Agent does not advertise loadSession"[^>]*>Connect &amp; resume<\/button>/);
    expect(primaryButton(html)).not.toContain('disabled=""');
  });
  it("does not turn a missing vendor CLI into an error in deliberate fake-agent mode", () => {
    useAgentsStore.setState({
      agents: [{ id: "codex", name: "Codex", binary: "codex-acp", available: false, connectable: true }],
      override: { mode: "fake", command: ["fake-acp-agent"], usingOverride: true, fakeAgentPath: "/fake-agent" },
    });
    const html = render();
    expect(primaryButton(html)).not.toContain('disabled=""');
    expect(html).not.toContain("was not found locally");
    expect(html).not.toContain("first connection may download");
  });
});
