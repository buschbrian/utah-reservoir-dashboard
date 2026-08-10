import {
  effectiveTheme,
  nextThemePreference,
  parseThemePreference,
  type ThemePreference
} from "../state/theme";
import { elementById } from "./dom";

const THEME_STORAGE_KEY = "utah-reservoir-dashboard-theme";
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

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
