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
// often rely on the latter via window.opener / window.close. Preserve only
// HTTPS Electron "new-window" popups that carry auth-flow signals; ordinary
// target=_blank, Cmd-click, generic HTTPS popups, and non-HTTPS destinations
// keep routing through Browser Panes.
export function shouldPreserveBrowserPopupWindow(
  targetUrl: string,
  disposition: string,
): boolean {
  if (disposition !== "new-window") {
    return false;
  }

  const target = parseHttpsUrl(targetUrl);
  if (target === undefined) {
    return false;
  }

  return hasAuthPopupSignal(target);
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

function hasAuthPopupSignal(target: URL): boolean {
  if (hasDirectAuthSignal(target)) {
    return true;
  }

  for (const nestedUrl of authRedirectTargets(target)) {
    if (hasDirectAuthSignal(nestedUrl)) {
      return true;
    }
  }

  return false;
}

function hasDirectAuthSignal(target: URL): boolean {
  return (
    hasAuthPathSignal(target.pathname) ||
    hasOAuthParams(target.searchParams) ||
    hasSamlParams(target.searchParams) ||
    hasPopupAuthParams(target.searchParams)
  );
}

function hasAuthPathSignal(pathname: string): boolean {
  return /(?:^|[\/_.-])(?:oauth2?|oidc|saml|authorize|auth|signin|sign-in|login)(?:$|[\/_.-])/i
    .test(pathname);
}

function hasOAuthParams(params: URLSearchParams): boolean {
  return (
    hasSearchParam(params, "client_id") &&
    (
      hasSearchParam(params, "response_type") ||
      hasSearchParam(params, "redirect_uri") ||
      hasSearchParam(params, "scope")
    )
  );
}

function hasSamlParams(params: URLSearchParams): boolean {
  return hasSearchParam(params, "SAMLRequest") || hasSearchParam(params, "SAMLResponse");
}

function hasPopupAuthParams(params: URLSearchParams): boolean {
  return (
    searchParamEquals(params, "redirectToAuth", "true") ||
    (
      searchParamEquals(params, "callbackType", "popup") &&
      (
        hasSearchParam(params, "requestId") ||
        hasSearchParam(params, "redirectToAuth")
      )
    )
  );
}

function authRedirectTargets(target: URL): URL[] {
  const redirectParamNames = [
    "redirectUri",
    "redirect_uri",
    "redirectUrl",
    "redirect_url",
    "returnTo",
    "return_to",
    "continue",
    "next",
  ];
  const urls: URL[] = [];
  for (const name of redirectParamNames) {
    for (const value of searchParamValues(target.searchParams, name)) {
      const url = parseHttpsUrl(value);
      if (url !== undefined) {
        urls.push(url);
      }
    }
  }
  return urls;
}

function parseHttpsUrl(value: string): URL | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  return url.protocol === "https:" ? url : undefined;
}

function hasSearchParam(params: URLSearchParams, expectedName: string): boolean {
  return searchParamValues(params, expectedName).length > 0;
}

function searchParamEquals(
  params: URLSearchParams,
  expectedName: string,
  expectedValue: string,
): boolean {
  const normalizedExpectedValue = expectedValue.toLowerCase();
  return searchParamValues(params, expectedName).some(
    (value) => value.toLowerCase() === normalizedExpectedValue,
  );
}

function searchParamValues(params: URLSearchParams, expectedName: string): string[] {
  const normalizedExpectedName = expectedName.toLowerCase();
  const values: string[] = [];
  for (const [name, value] of params) {
    if (name.toLowerCase() === normalizedExpectedName) {
      values.push(value);
    }
  }
  return values;
}
