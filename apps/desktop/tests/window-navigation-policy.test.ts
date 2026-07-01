import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classifyTopLevelNavigation,
  shouldPreserveBrowserPopupWindow,
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

test("https new-window popups preserve a real child window for opener callbacks", () => {
  assert.equal(
    shouldPreserveBrowserPopupWindow(
      "https://app.notion.com/verifyNoPopupBlockerHtmlAndRedirect?redirectUri=https%3A%2F%2Fapp.notion.com%2Fgooglepopupredirect%3FcallbackType%3Dpopup",
      "new-window",
    ),
    true,
  );
  assert.equal(
    shouldPreserveBrowserPopupWindow(
      "https://auth.example.com/oauth2/v1/authorize?client_id=abc&redirect_uri=https%3A%2F%2Fapp.example.com%2Fcallback&response_type=code",
      "new-window",
    ),
    true,
  );
  assert.equal(
    shouldPreserveBrowserPopupWindow("https://example.com/popup", "new-window"),
    true,
  );
});

test("target-blank and background-tab links still route through Browser Panes", () => {
  assert.equal(
    shouldPreserveBrowserPopupWindow("https://example.com/popup", "foreground-tab"),
    false,
  );
  assert.equal(
    shouldPreserveBrowserPopupWindow("https://example.com/popup", "background-tab"),
    false,
  );
  assert.equal(
    shouldPreserveBrowserPopupWindow("https://example.com/popup", "default"),
    false,
  );
});

test("non-https and malformed new-window popups do not become native child windows", () => {
  assert.equal(
    shouldPreserveBrowserPopupWindow("http://example.com/popup", "new-window"),
    false,
  );
  assert.equal(
    shouldPreserveBrowserPopupWindow("about:blank", "new-window"),
    false,
  );
  assert.equal(
    shouldPreserveBrowserPopupWindow("not a url", "new-window"),
    false,
  );
});
