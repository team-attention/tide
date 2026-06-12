// Light/dark theme application. The CSS default (no data-theme attribute) is the
// light palette; data-theme="dark" on <html> flips to the dark token set. The
// preference is one of: "light" / "dark" (fixed) or "auto" (follows the OS
// appearance, which on macOS itself switches by time of day). Persisted in
// localStorage so it survives restarts and is read synchronously at boot (see
// the inline script in index.html) to avoid a light→dark flash.

export type TideThemePreference = "light" | "dark" | "auto";

export const TIDE_THEME_STORAGE_KEY = "tide.theme";

export function loadThemePreference(): TideThemePreference {
  try {
    const value = localStorage.getItem(TIDE_THEME_STORAGE_KEY);
    if (value === "light" || value === "dark" || value === "auto") {
      return value;
    }
  } catch {
    // localStorage unavailable (sandbox/probe) — fall through to the default.
  }
  return "auto";
}

export function saveThemePreference(pref: TideThemePreference): void {
  try {
    localStorage.setItem(TIDE_THEME_STORAGE_KEY, pref);
  } catch {
    // Non-fatal: the live document still updates; only persistence is lost.
  }
}

export function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

export function resolveTheme(pref: TideThemePreference): "light" | "dark" {
  if (pref === "auto") {
    return systemPrefersDark() ? "dark" : "light";
  }
  return pref;
}

export function applyThemePreference(pref: TideThemePreference): void {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.setAttribute("data-theme", resolveTheme(pref));
}

// While in "auto", re-apply when the OS appearance changes. `getPref` is read
// lazily so a later switch to a fixed mode stops the OS from overriding it.
// Returns an unsubscribe.
export function watchSystemTheme(getPref: () => TideThemePreference): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => undefined;
  }
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = (): void => {
    if (getPref() === "auto") {
      applyThemePreference("auto");
    }
  };
  query.addEventListener("change", handler);
  return () => query.removeEventListener("change", handler);
}
