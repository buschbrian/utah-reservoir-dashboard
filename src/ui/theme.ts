import {
  effectiveTheme,
  nextThemePreference,
  parseThemePreference,
  type ThemePreference
} from "../state/theme";
import { elementById } from "./dom";

const THEME_STORAGE_KEY = "utah-reservoir-dashboard-theme";
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

/** Fired on `document` whenever the effective theme changes -- from the
 * toggle, or from the system preference while the preference is "system".
 * A page with content the CSS cascade cannot reach on its own, such as a
 * chart drawn once from Calcite colours it read at mount time, listens for
 * this to redraw rather than polling `documentElement.dataset.theme`. */
export const THEME_CHANGE_EVENT = "dashboard-theme-change";

function readThemePreference(): ThemePreference {
  try {
    return parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

let themePreference = readThemePreference();

function applyTheme(): void {
  const theme = effectiveTheme(themePreference, darkQuery.matches);
  document.documentElement.classList.toggle("calcite-mode-dark", theme === "dark");
  document.documentElement.classList.toggle("calcite-mode-light", theme === "light");
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  const action = document.getElementById("theme-toggle");
  if (action) {
    action.setAttribute("text", `Theme: ${themePreference}`);
    action.setAttribute("label", `Change color theme. Current setting: ${themePreference}`);
  }
  document.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: { theme } }));
}

/** The theme in effect right now, as `applyTheme` last stamped it. Callers
 * that build theme-dependent resources after `wireTheme()` read this rather
 * than re-deriving preference and system state a second way. */
export function effectiveThemeNow(): "light" | "dark" {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function wireTheme(): void {
  applyTheme();
  elementById("theme-toggle").addEventListener("click", () => {
    themePreference = nextThemePreference(themePreference);
    try {
      if (themePreference === "system") localStorage.removeItem(THEME_STORAGE_KEY);
      else localStorage.setItem(THEME_STORAGE_KEY, themePreference);
    } catch {
      // A private browsing policy can reject storage; the in-page choice still works.
    }
    applyTheme();
  });
  darkQuery.addEventListener("change", () => {
    if (themePreference === "system") applyTheme();
  });
}
