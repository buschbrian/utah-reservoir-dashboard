export type ThemePreference = "system" | "light" | "dark";
export type EffectiveTheme = Exclude<ThemePreference, "system">;

export function parseThemePreference(value: string | null): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

export function effectiveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean
): EffectiveTheme {
  return preference === "system"
    ? (systemPrefersDark ? "dark" : "light")
    : preference;
}

export function nextThemePreference(preference: ThemePreference): ThemePreference {
  if (preference === "system") return "light";
  return preference === "light" ? "dark" : "system";
}
