import { describe, expect, it } from "vitest";
import { describeDataState, supportsDashboard } from "./shell";

describe("shell states", () => {
  it("distinguishes loading, empty, ready, and failed data", () => {
    expect(describeDataState({ kind: "loading" }).heading).toMatch(/Loading/i);
    expect(describeDataState({ kind: "empty" }).heading).toMatch(/No reservoirs/i);
    expect(describeDataState({ kind: "ready", count: 54 }).detail).toContain("54");
    expect(describeDataState({ kind: "error" }).role).toBe("alert");
  });

  it("requires the browser capabilities used by the shell", () => {
    expect(supportsDashboard({
      customElements: true,
      resizeObserver: true,
      webgl: true
    })).toBe(true);
    expect(supportsDashboard({
      customElements: true,
      resizeObserver: true,
      webgl: false
    })).toBe(false);
  });
});
