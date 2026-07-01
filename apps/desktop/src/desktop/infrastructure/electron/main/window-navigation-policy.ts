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

// Some sign-in flows intentionally use a popup and then call back through
// window.opener / window.close. If Tide turns those into independent Browser
// Panes, the opener relationship is lost and the login can stall on the popup
// blocker verification page. Keep this allowlist narrow: ordinary web popups
// still route through Browser Panes.
export function shouldPreserveAuthPopupWindow(targetUrl: string): boolean {
  let target: URL;
  try {
    target = new URL(targetUrl);
  } catch {
    return false;
  }

  if (target.protocol !== "https:") {
    return false;
  }

  if (isLikelyAuthPopupUrl(target)) {
    return true;
  }

  if (target.hostname === "app.notion.com") {
    if (isNotionGooglePopupRedirect(target)) {
      return true;
    }
    if (target.pathname === "/verifyNoPopupBlockerHtmlAndRedirect") {
      const redirectUri = target.searchParams.get("redirectUri");
      return redirectUri !== null && isTrustedAuthPopupRedirectUrl(redirectUri);
    }
  }

  return false;
}

function isLikelyAuthPopupUrl(target: URL): boolean {
  return isKnownAuthProviderUrl(target) || hasStrongAuthProtocolSignal(target);
}

function isKnownAuthProviderUrl(target: URL): boolean {
  const hostname = target.hostname;
  const path = target.pathname.toLowerCase();

  if (hostname === "accounts.google.com") {
    return path.startsWith("/o/oauth2/") || path.startsWith("/signin/") || path.startsWith("/v3/signin/");
  }
  if (hostname === "login.microsoftonline.com") {
    return true;
  }
  if (hostname === "login.live.com" || hostname === "account.live.com") {
    return true;
  }
  if (hostname === "appleid.apple.com") {
    return path.startsWith("/auth/");
  }
  if (hostname === "github.com") {
    return path === "/login" || path.startsWith("/login/") || path.startsWith("/login/oauth/");
  }
  if (hostname === "gitlab.com") {
    return path.startsWith("/oauth/authorize") || path.startsWith("/users/sign_in");
  }
  if (hostname === "bitbucket.org") {
    return path.startsWith("/site/oauth2/authorize");
  }
  if (hostname === "slack.com") {
    return path.startsWith("/oauth/") || path.startsWith("/openid/");
  }
  if (hostname === "id.atlassian.com") {
    return path.startsWith("/login") || path.startsWith("/authorize");
  }
  if (hostname.endsWith(".okta.com") || hostname.endsWith(".auth0.com")) {
    return path.includes("/authorize") || path.includes("/login") || path.includes("/oauth2/");
  }
  if (hostname.endsWith(".clerk.accounts.dev")) {
    return true;
  }

  return false;
}

function hasStrongAuthProtocolSignal(target: URL): boolean {
  const search = target.searchParams;
  const path = target.pathname.toLowerCase();

  if (search.has("SAMLRequest")) {
    return true;
  }

  const hasClientId = search.has("client_id");
  const hasRedirectUri = search.has("redirect_uri");
  const hasOauthResponse =
    search.has("response_type") ||
    search.has("scope") ||
    search.has("state") ||
    search.get("display") === "popup";

  if (hasClientId && hasRedirectUri && hasOauthResponse) {
    return true;
  }

  const scope = search.get("scope")?.toLowerCase() ?? "";
  if (hasClientId && scope.split(/\s+/).includes("openid")) {
    return true;
  }

  return (
    hasClientId &&
    /(^|\/)(oauth2?|oidc|openid-connect|saml|sso)(\/|$)/.test(path) &&
    /(^|\/)(authorize|auth|login|signin|sign-in)(\/|$)/.test(path)
  );
}

function isTrustedAuthPopupRedirectUrl(targetUrl: string): boolean {
  try {
    const target = new URL(targetUrl);
    return target.protocol === "https:" && (isNotionGooglePopupRedirect(target) || isLikelyAuthPopupUrl(target));
  } catch {
    return false;
  }
}

function isNotionGooglePopupRedirect(target: URL): boolean {
  return (
    target.protocol === "https:" &&
    target.hostname === "app.notion.com" &&
    target.pathname === "/googlepopupredirect" &&
    target.searchParams.get("callbackType") === "popup"
  );
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
