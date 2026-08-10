import { describe, expect, it } from "vitest";
import {
  effectiveTheme,
  nextThemePreference,
  parseThemePreference
} from "./theme";

describe("dashboard theme", () => {
  it("uses the system preference until the reader chooses otherwise", () => {
    expect(effectiveTheme("system", true)).toBe("dark");
    expect(effectiveTheme("system", false)).toBe("light");
  });

  it("honours an explicit preference regardless of the system", () => {
    expect(effectiveTheme("light", true)).toBe("light");
    expect(effectiveTheme("dark", false)).toBe("dark");
  });

  it("rejects unknown persisted values instead of applying an invalid class", () => {
    expect(parseThemePreference("dark")).toBe("dark");
    expect(parseThemePreference("sepia")).toBe("system");
    expect(parseThemePreference(null)).toBe("system");
  });

  it("cycles through system, light, and dark", () => {
    expect(nextThemePreference("system")).toBe("light");
    expect(nextThemePreference("light")).toBe("dark");
    expect(nextThemePreference("dark")).toBe("system");
  });
});
