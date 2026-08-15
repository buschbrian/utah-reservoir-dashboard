import { describe, expect, it } from "vitest";
import { chartTooltip } from "./chart-tooltip";

describe("chart tooltip markup", () => {
  it("keeps its title first and puts each fact on its own line", () => {
    expect(chartTooltip("Deer Creek", [
      { label: "Percent full", value: "72.4%" },
      { label: "Stored now", value: "110,200 acre-feet" }
    ])).toBe(
      "<b>Deer Creek</b><br><b>Percent full:</b> 72.4%" +
      "<br><b>Stored now:</b> 110,200 acre-feet"
    );
  });

  it("escapes runtime values before the SDK interprets the result as HTML", () => {
    expect(chartTooltip("A&B <West>", [
      { label: 'Drainage "area"', value: "O'Brien" }
    ])).toBe(
      "<b>A&amp;B &lt;West&gt;</b><br><b>Drainage &quot;area&quot;:</b> O&#39;Brien"
    );
  });
});
