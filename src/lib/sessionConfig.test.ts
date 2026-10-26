import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SessionConfig } from "../SessionConfig";
import type { ConfigOption } from "./sessionMetadata";

const option: ConfigOption = { id: "model", name: "Model", description: "<script>untrusted</script>", writable: true, currentValue: "opaque-current",
  choices: [{ value: "opaque-current", name: "Balanced", group: "Provider" }, { value: "fast", name: "Fast", group: "Provider" }] };
function render(options?: ConfigOption[], disabled = false, failed = false, locale: "en" | "zh-CN" = "en") {
  return renderToStaticMarkup(createElement(SessionConfig, { options, disabled, failed, locale, onChange: () => {} }));
}
describe("session configuration UI", () => {
  it("uses opaque values and reported groups while escaping descriptions", () => {
    const html = render([option]);
    expect(html).toContain('value="opaque-current" selected=""');
    expect(html).toContain("Provider · Balanced");
    expect(html).not.toContain("<script>");
  });
  it("preserves an unlisted current value without inventing an available choice", () => {
    const html = render([{ ...option, currentValue: "provider-only" }]);
    expect(html).toContain('value="provider-only" disabled="" selected=""');
    expect(html).toContain("provider-only");
  });
  it("distinguishes unknown, empty and unsupported controls", () => {
    expect(render()).toContain("has not reported configuration");
    expect(render([])).toContain("reports no configuration");
    const html = render([{ ...option, writable: false, choices: [] }]);
    expect(html).toContain("not supported by this client");
    expect(html).not.toContain("<select");
  });
  it("disables mutation while pending and localizes the generic retry notice", () => {
    const html = render([option], true, true, "zh-CN");
    expect(html).toContain('disabled=""');
    expect(html).toContain('role="alert"');
    expect(html).toContain("最近报告的值");
  });
});
