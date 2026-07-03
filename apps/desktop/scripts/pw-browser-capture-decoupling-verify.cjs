// Live verification for browser-pane-screenshot-on-load-decoupling.
// Proves the perf fix: screenshots are NO LONGER captured on the page-load-event storm. We wrap
// every Browser Pane <webview>'s capturePage with a counter, open TWO browser panes, then drive
// repeated navigations + reloads (which fire dom-ready/did-finish-load/did-stop-loading). With
// the fix, capturePage is NEVER called on those events (pixels are pulled only at observe time),
// so the counter stays 0. We also sample per-process CPU via app.getAppMetrics() to confirm the
// host renderer is not pegged with browser panes open.
const { _electron } = require("playwright");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const repo = path.resolve(__dirname, "..");
let failures = 0;
function check(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"} - ${label}`);
  if (!cond) failures += 1;
}

// Install a capturePage counter on every browser <webview> in the host renderer. The renderer
// calls webview.capturePage() on the same element node, so wrapping the property intercepts it.
const INSTALL_COUNTER = `(() => {
  window.__capCount = 0;
  const wrap = (el) => {
    if (!el || el.__capWrapped) return;
    el.__capWrapped = true;
    const orig = el.capturePage ? el.capturePage.bind(el) : null;
    el.capturePage = (...a) => { window.__capCount++; return orig ? orig(...a) : Promise.resolve(null); };
  };
  document.querySelectorAll('[data-browser-pane-webview]').forEach(wrap);
  // Catch panes added later (cmd-click / New Pane).
  const mo = new MutationObserver(() => document.querySelectorAll('[data-browser-pane-webview]').forEach(wrap));
  mo.observe(document.body, { childList: true, subtree: true });
  return document.querySelectorAll('[data-browser-pane-webview]').length;
})()`;

// Drive real load events on the first webview without the address-bar normalizer (data: URLs
// aren't navigable via the bar). Each loadURL + reload fires dom-ready/did-finish-load/
// did-stop-loading — the exact storm that used to trigger a capture each time.
const DRIVE_LOADS = `(async () => {
  const wv = document.querySelector('[data-browser-pane-webview]');
  if (!wv || !wv.loadURL) return 'no-webview';
  const pages = [
    'data:text/html,<title>Alpha</title><h1>alpha</h1>',
    'data:text/html,<title>Bravo</title><h1>bravo</h1>',
    'data:text/html,<title>Charlie</title><h1>charlie</h1>',
  ];
  for (const p of pages) {
    try { await wv.loadURL(p); } catch (e) {}
    await new Promise((r) => setTimeout(r, 500));
    try { wv.reload(); } catch (e) {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return 'driven';
})()`;

(async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-pw-capdecouple-"));
  const seed = spawnSync("node", [path.join(repo, "scripts/seed-thread.cjs"), dataRoot], {
    cwd: repo,
    stdio: "inherit",
  });
  if (seed.status !== 0) throw new Error("seed failed");

  const app = await _electron.launch({
    args: [path.join(repo, "out/main/electron-main.js")],
    env: { ...process.env, TIDE_APP_DATA_ROOT: dataRoot },
  });
  const page = await app.firstWindow();
  await page.waitForSelector("[data-product-shell]", { timeout: 20000 });
  await page.waitForTimeout(1000);

  // Open the seeded thread, the Workbench, and a Browser pane.
  const rows = page.locator("[data-thread-row-main]");
  if (await rows.count()) {
    await rows.first().click();
    await page.waitForTimeout(800);
  }
  const openWb = page.locator('[aria-label="Open Workbench"]');
  if (await openWb.count()) {
    await openWb.first().click();
    await page.waitForTimeout(800);
  }
  await page.locator('[data-launcher-action="open_browser"]').first().click();
  await page.waitForSelector('[data-pane-kind="browser"]', { timeout: 10000 });
  await page.waitForTimeout(1500);
  check("first browser pane rendered", (await page.locator('[data-pane-kind="browser"]').count()) > 0);

  // Open a SECOND browser pane (the user's "cmd-click new pane" scenario) via New Pane.
  const newPane = page.locator('[aria-label="New Pane"]');
  if (await newPane.count()) {
    await newPane.first().click();
    await page.waitForTimeout(600);
    const openBrowser2 = page.locator('[data-launcher-action="open_browser"]');
    if (await openBrowser2.count()) {
      await openBrowser2.first().click();
      await page.waitForTimeout(1200);
    }
  }
  const webviewCount = await page.locator('[data-browser-pane-webview]').count();
  console.log("browser webviews mounted:", webviewCount);

  // Install the capturePage counter AFTER the panes have settled, so we measure steady-state +
  // the driven navigations (not the initial mount).
  const initialWrapped = await page.evaluate(INSTALL_COUNTER);
  console.log("capturePage counter installed on", initialWrapped, "webview(s)");
  await page.evaluate(() => { window.__capCount = 0; });

  // Prime CPU metrics, then drive the load-event storm.
  await app.evaluate(({ app }) => app.getAppMetrics());
  const driven = await page.evaluate(DRIVE_LOADS);
  console.log("load driver:", driven);
  await page.waitForTimeout(4000); // let any late did-stop-loading fire

  const capCount = await page.evaluate(() => window.__capCount);
  console.log("capturePage calls during navigations/reloads:", capCount);
  check("NO capturePage on the load-event storm (was 3x/load + churn before)", capCount === 0);

  // Per-process CPU over the interval (Electron-internal, never mixes with the installed app).
  const metrics = await app.evaluate(({ app }) => app.getAppMetrics());
  const tabs = metrics
    .filter((m) => m.type === "Tab")
    .map((m) => Math.round((m.cpu && m.cpu.percentCPUUsage) || 0));
  const maxTab = tabs.length ? Math.max(...tabs) : 0;
  console.log("renderer(Tab) %CPU over interval:", JSON.stringify(tabs), "max=", maxTab);
  check("host renderer not pegged with browser panes open (<60% over interval)", maxTab < 60);

  // The page DID navigate (load events really fired) — sanity that capCount===0 is meaningful.
  const finalUrl = await page.evaluate(() => {
    const wv = document.querySelector('[data-browser-pane-webview]');
    try { return wv && wv.getURL ? wv.getURL() : ""; } catch (e) { return ""; }
  });
  console.log("first webview final URL:", finalUrl.slice(0, 40));
  check("navigations actually happened (load events fired)", /charlie|bravo|alpha/.test(finalUrl));

  await app.close();
  console.log(failures === 0 ? "ALL CHECKS PASS" : `FAILURES: ${failures}`);
  console.log("DONE dataRoot=", dataRoot);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error("PW ERROR", e);
  process.exit(1);
});
