import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ContextHealth } from "../components/ContextHealth";
import { sampleAnalysis } from "../lib/fixtures";

describe("ContextHealth", () => {
  it("renders the meter, flagged turns and kept count", () => {
    const { analysis, transcript } = sampleAnalysis();
    const html = renderToStaticMarkup(<ContextHealth state={{ status: "ready", analysis, transcript }} />);
    expect(html).toContain('<meter class="meter" min="0" max="100" value="25.5"');
    expect(html).toContain("2.7k");
    expect(html).toContain("26%");
    expect(html).toContain("Updated at turn 9");
    expect(html).toContain("Redundant");
    expect(html.match(/class="turn"/g)).toHaveLength(4);
    expect(html).toContain("<b>6</b> turns kept");
  });

  it("renders the no-key, loading and error states", () => {
    expect(renderToStaticMarkup(<ContextHealth state={{ status: "no-key" }} onOpenSettings={() => {}} />)).toContain(
      "Open settings",
    );
    expect(renderToStaticMarkup(<ContextHealth state={{ status: "loading" }} />)).toContain('role="status"');
    const error = renderToStaticMarkup(
      <ContextHealth state={{ status: "error", message: "boom" }} onRetry={() => {}} />,
    );
    expect(error).toContain("boom");
    expect(error).toContain("Try again");
  });
});
