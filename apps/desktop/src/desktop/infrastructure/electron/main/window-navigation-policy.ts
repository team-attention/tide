// Navigation policy for the MAIN host window's top-level webContents.
//
// Tide's window renders a single-page React app (a file:// document when
// packaged, the dev-server origin in development). That top-level webContents
// must NEVER navigate to an off-app URL: doing so replaces the entire React app
// with the external page, and — there being no back affordance — the app looks
// frozen (this was the "click a link in chat → window freezes on the external
// site" bug). Markdown links in chat render as ordinary <a href> anchors, so a
// plain click would otherwise trigger exactly that top-level navigation.
//
// This module is the pure decision; electron-main wires it onto will-navigate /
// will-redirect / setWindowOpenHandler. Kept side-effect-free so the policy is
// unit-testable without spawning Electron.

export type TopLevelNavigationVerdict =
  // The app navigating within its own document (initial load / reload / dev
  // HMR) — let it proceed.
  | "allow"
  // An off-app destination a human meant to visit (web / mail / tel) — hand to
  // the system browser / handler, never the app window.
  | "open_external"
  // Anything else (about:, data:, devtools:, unknown schemes, a stray local
  // file): refuse the top-level navigation but don't leak it outward either.
  | "block";

export function classifyTopLevelNavigation(
  targetUrl: string,
  appUrl: string | undefined,
): TopLevelNavigationVerdict {
  if (isAppDocument(targetUrl, appUrl)) {
    return "allow";
  }
  if (/^(https?|mailto|tel):/i.test(targetUrl)) {
    return "open_external";
  }
  return "block";
}

// A Browser Pane page can ask for two different "open elsewhere" semantics:
// target=_blank/new tab, or a real popup window. OAuth-style popup sign-in flows
// often rely on the latter via window.opener / window.close. Preserve only HTTPS
// Electron "new-window" popups as native child windows; ordinary target=_blank,
// Cmd-click, and non-HTTPS destinations keep routing through Browser Panes.
export function shouldPreserveBrowserPopupWindow(
  targetUrl: string,
  disposition: string,
): boolean {
  if (disposition !== "new-window") {
    return false;
  }

  let target: URL;
  try {
    target = new URL(targetUrl);
  } catch {
    return false;
  }

  return target.protocol === "https:";
}

// The target is the app's own document when it shares the dev-server origin
// (any path/HMR query is fine) or, when packaged, is the exact same file:// path
// (so a stray `file:///etc/...` link can't quietly replace the app).
function isAppDocument(targetUrl: string, appUrl: string | undefined): boolean {
  if (appUrl === undefined) {
    return false;
  }
  let target: URL;
  let app: URL;
  try {
    target = new URL(targetUrl);
    app = new URL(appUrl);
  } catch {
    return false;
  }
  if (target.protocol !== app.protocol) {
    return false;
  }
  if (app.protocol === "file:") {
    return target.pathname === app.pathname;
  }
  return target.origin === app.origin;
}
