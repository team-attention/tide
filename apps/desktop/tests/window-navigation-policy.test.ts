import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classifyTopLevelNavigation,
  shouldPreserveAuthPopupWindow,
} from "../src/desktop/infrastructure/electron/main/window-navigation-policy.ts";

const PACKAGED = "file:///Applications/Tide.app/Contents/Resources/app/out/renderer/index.html";
const DEV = "http://localhost:5173/";

test("packaged: an external https link clicked in chat opens in the system browser, never the app window", () => {
  assert.equal(classifyTopLevelNavigation("https://finance.yahoo.com/", PACKAGED), "open_external");
  assert.equal(classifyTopLevelNavigation("http://example.com/path?q=1", PACKAGED), "open_external");
});

test("packaged: reloading the app's own document is allowed", () => {
  assert.equal(classifyTopLevelNavigation(PACKAGED, PACKAGED), "allow");
  // A hash/route change on the same document is still the app.
  assert.equal(
    classifyTopLevelNavigation(`${PACKAGED}#/thread/abc`, PACKAGED),
    "allow",
  );
});

test("packaged: a stray local file link cannot quietly replace the app", () => {
  // Different file path → block (would otherwise unmount the React app too).
  assert.equal(
    classifyTopLevelNavigation("file:///etc/passwd", PACKAGED),
    "block",
  );
});

test("mailto and tel links go to the system handler", () => {
  assert.equal(classifyTopLevelNavigation("mailto:dev@tide.app", PACKAGED), "open_external");
  assert.equal(classifyTopLevelNavigation("tel:+15551234567", PACKAGED), "open_external");
});

test("opaque / dangerous schemes are blocked, not navigated and not leaked", () => {
  assert.equal(classifyTopLevelNavigation("about:blank", PACKAGED), "block");
  assert.equal(classifyTopLevelNavigation("data:text/html,<h1>x</h1>", PACKAGED), "block");
  assert.equal(classifyTopLevelNavigation("devtools://devtools/bundled/x.html", PACKAGED), "block");
  assert.equal(classifyTopLevelNavigation("javascript:alert(1)", PACKAGED), "block");
});

test("dev: same-origin navigation (incl. HMR reloads) is allowed", () => {
  assert.equal(classifyTopLevelNavigation(DEV, DEV), "allow");
  assert.equal(classifyTopLevelNavigation("http://localhost:5173/anything?t=123", DEV), "allow");
});

test("dev: a different localhost port is off-app and opens externally", () => {
  assert.equal(classifyTopLevelNavigation("http://localhost:9999/", DEV), "open_external");
});

test("dev: external https still opens in the system browser", () => {
  assert.equal(classifyTopLevelNavigation("https://finance.yahoo.com/", DEV), "open_external");
});

test("a malformed target URL is treated as off-app and blocked (never allowed)", () => {
  assert.equal(classifyTopLevelNavigation("not a url", PACKAGED), "block");
});

test("with no known app URL, nothing is treated as the app document", () => {
  // Defensive: an unknown app URL must not accidentally allow a navigation.
  assert.equal(classifyTopLevelNavigation("https://example.com/", undefined), "open_external");
  assert.equal(classifyTopLevelNavigation("file:///whatever", undefined), "block");
});

test("Notion Google login popup URLs preserve a real popup window for opener callbacks", () => {
  const redirectUri = encodeURIComponent(
    "https://app.notion.com/googlepopupredirect?callbackType=popup&redirectToAuth=true&requestId=508a5d84-055b-4327-acab-b306932b4916",
  );

  assert.equal(
    shouldPreserveAuthPopupWindow(
      `https://app.notion.com/verifyNoPopupBlockerHtmlAndRedirect?redirectUri=${redirectUri}`,
    ),
    true,
  );
  assert.equal(
    shouldPreserveAuthPopupWindow(
      "https://app.notion.com/googlepopupredirect?callbackType=popup&requestId=508a5d84-055b-4327-acab-b306932b4916",
    ),
    true,
  );
});

test("strong OAuth/OIDC/SAML popup URLs preserve a real popup window across providers", () => {
  assert.equal(
    shouldPreserveAuthPopupWindow(
      "https://auth.example.com/oauth2/v1/authorize?client_id=abc&redirect_uri=https%3A%2F%2Fapp.example.com%2Fcallback&response_type=code&scope=openid",
    ),
    true,
  );
  assert.equal(
    shouldPreserveAuthPopupWindow(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=abc&redirect_uri=https%3A%2F%2Fapp.example.com%2Fcallback&response_type=code",
    ),
    true,
  );
  assert.equal(
    shouldPreserveAuthPopupWindow(
      "https://sso.example.com/saml/login?SAMLRequest=encoded-request&RelayState=state",
    ),
    true,
  );
});

test("Notion popup-blocker verification preserves likely auth redirect targets, not just Google", () => {
  const redirectUri = encodeURIComponent(
    "https://auth.example.com/oauth2/authorize?client_id=abc&redirect_uri=https%3A%2F%2Fapp.notion.com%2Fcallback&response_type=code",
  );

  assert.equal(
    shouldPreserveAuthPopupWindow(
      `https://app.notion.com/verifyNoPopupBlockerHtmlAndRedirect?redirectUri=${redirectUri}`,
    ),
    true,
  );
});

test("regular popup links still route through Browser Panes instead of native windows", () => {
  assert.equal(
    shouldPreserveAuthPopupWindow("https://www.google.com/search?q=tide&newwindow=1"),
    false,
  );
  assert.equal(
    shouldPreserveAuthPopupWindow("https://app.notion.com/help"),
    false,
  );
  assert.equal(
    shouldPreserveAuthPopupWindow("https://example.com/login"),
    false,
  );
  assert.equal(
    shouldPreserveAuthPopupWindow(
      "http://auth.example.com/oauth2/authorize?client_id=abc&redirect_uri=https%3A%2F%2Fapp.example.com%2Fcallback&response_type=code",
    ),
    false,
  );
  assert.equal(
    shouldPreserveAuthPopupWindow(
      "https://app.notion.com/verifyNoPopupBlockerHtmlAndRedirect?redirectUri=https%3A%2F%2Fevil.example%2Fgooglepopupredirect%3FcallbackType%3Dpopup",
    ),
    false,
  );
  assert.equal(
    shouldPreserveAuthPopupWindow("not a url"),
    false,
  );
});
