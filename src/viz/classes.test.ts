import { describe, expect, it } from "vitest";
import { storageClass } from "./classes";

describe("storage classes", () => {
  it.each([
    [0, "Under 25%"], [24.99, "Under 25%"], [25, "25–49%"],
    [50, "50–74%"], [75, "75–89%"], [90, "90% or more"]
  ])("classifies %s at the shared boundary", (percent, label) => {
    expect(storageClass(percent)?.label).toBe(label);
  });

  it("does not invent a class for missing data", () => {
    expect(storageClass(null)).toBeNull();
  });
});
