// Live verification (spec: host-zoom-shortcuts): Cmd +/-/0 zoom the WHOLE app — the
// host UI AND Browser Pane <webview> guests — even when a webview has focus (the old
// bug zoomed only the focused webview). A floating indicator shows the % and resets to
// 100% on click. We open an .html preview (a real <webview>), focus INTO it, drive the
// View-menu zoom items from main, and assert host + webview zoom factors move together.
const { _electron } = require("playwright");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const repo = path.resolve(__dirname, "..");
let failures = 0;
const check = (label, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`); if (!ok) failures += 1; };

const htmlName = `pw-zoom-${Date.now()}.html`;
const htmlPath = path.join(repo, htmlName);
const HTML = `<!doctype html><html><body style="margin:0;background:#fff"><h1 id="probe" style="color:rebeccapurple;font-family:system-ui;font-size:28px;padding:24px">ZOOM PROBE PAGE</h1></body></html>`;

// Read host-window zoom factor + the (first) webview guest zoom factor from MAIN. The
// guest can briefly drop out of getAllWebContents() right after a big reflow, so retry
// a few times until it's enumerable before reporting.
const readZoom = async (app) => {
  for (let attempt = 0; attempt < 10; attempt++) {
    const snapshot = await app.evaluate(({ BrowserWindow, webContents }) => {
      const host = BrowserWindow.getAllWindows()[0]?.webContents.getZoomFactor() ?? null;
      const guest = webContents.getAllWebContents().find((wc) => wc.getType() === "webview");
      return { host, webview: guest ? guest.getZoomFactor() : null };
    });
    if (snapshot.webview !== null) return snapshot;
    await new Promise((r) => setTimeout(r, 200));
  }
  return app.evaluate(({ BrowserWindow }) => ({ host: BrowserWindow.getAllWindows()[0]?.webContents.getZoomFactor() ?? null, webview: null }));
};

// Trigger a View-menu zoom item from main by label (the visible "Zoom In"/"Zoom Out").
const clickMenuZoom = (app, label) => app.evaluate(({ Menu, BrowserWindow }, lbl) => {
  const win = BrowserWindow.getAllWindows()[0];
  win?.focus();
  const menu = Menu.getApplicationMenu();
  const view = menu?.items.find((i) => i.label === "View");
  const item = view?.submenu?.items.find((i) => i.label === lbl && i.visible !== false);
  // Electron calls the click callback with (menuItem, browserWindow, event); pass the
  // window so the handler doesn't depend on OS focus (absent under automation).
  if (item) item.click(undefined, win);
  return Boolean(item);
}, label);

const launch = (dataRoot) => _electron.launch({
  args: [path.join(repo, "out/main/electron-main.js")],
  env: { ...process.env, TIDE_APP_DATA_ROOT: dataRoot },
});

(async () => {
  fs.writeFileSync(htmlPath, HTML, "utf8");
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-pw-zoom-"));
  spawnSync("node", [path.join(repo, "scripts/seed-thread.cjs"), dataRoot], { cwd: repo, stdio: "inherit" });

  // First launch: persist a non-100% zoom (Chromium stores it per-origin in the shared
  // Electron userData), then quit — so the next launch can prove zoom is NOT restored.
  const pre = await launch(dataRoot);
  await (await pre.firstWindow()).waitForSelector("[data-product-shell]", { timeout: 20000 });
  await pre.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(1.5));
  await new Promise((r) => setTimeout(r, 400));
  await pre.close();

  const app = await launch(dataRoot);
  const page = await app.firstWindow();
  await page.waitForSelector("[data-product-shell]", { timeout: 20000 });
  await page.waitForTimeout(800);
  // The new behaviour: a relaunch opens at 100% even though 150% was persisted.
  const startupHost = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.getZoomFactor() ?? null);
  check("relaunch opens at 100% despite a persisted 150% zoom", startupHost === 1, `host=${startupHost}`);
  await page.evaluate(async (cwd) => { await window.tide.registerProject(cwd); }, repo);
  await page.waitForTimeout(400);

  // Scope to the repo project so the file tree lists the temp .html, then open it.
  const scopeChip = page.locator("button", { hasText: "Scratch" }).first();
  if (await scopeChip.count()) {
    await scopeChip.click();
    await page.waitForTimeout(400);
    await page.locator("button", { hasText: /desktop|tide/ }).last().click().catch(() => {});
    await page.waitForTimeout(700);
  }
  const treeToggle = page.locator("[aria-label='Open FileTree']");
  if (await treeToggle.count()) { await treeToggle.first().click(); await page.waitForTimeout(1500); }
  const fileRow = page.locator("[data-file-kind]", { hasText: htmlName });
  if (await fileRow.count()) { await fileRow.first().click(); await page.waitForTimeout(1800); }

  const webview = page.locator("[data-html-pane-webview]");
  check("an HTML <webview> preview is open", (await webview.count()) > 0);

  // Zoom persists across restarts (Chromium per-origin, stored in Electron userData —
  // which the harness shares with the real app), so normalise to 100% before asserting
  // and again at the end so a run neither inherits nor leaks a non-100% zoom.
  await clickMenuZoom(app, "Actual Size");
  await page.waitForTimeout(400);

  // Baseline: everything at 100%, indicator hidden.
  const z0 = await readZoom(app);
  check("host + webview start at 100%", z0.host === 1 && z0.webview === 1, JSON.stringify(z0));
  check("indicator hidden at 100%", (await page.locator("[data-zoom-indicator]").count()) === 0);
  await page.screenshot({ path: "/tmp/pw-zoom-0-100.png" });

  // Focus INTO the webview guest — this is the exact scenario the old role-based zoom
  // broke (it zoomed only the focused webview, leaving the host UI untouched).
  await webview.first().click().catch(() => {});
  await page.waitForTimeout(300);

  // Zoom in one step → 110% (a modest step keeps the 3-column layout on-screen so the
  // webview guest stays attached/enumerable; the 90% case below also proves the cascade).
  await clickMenuZoom(app, "Zoom In");
  await page.waitForTimeout(500);
  const z1 = await readZoom(app);
  check("zoom-in scales the HOST UI even with the webview focused", z1.host === 1.1, `host=${z1.host}`);
  check("zoom-in scales the WEBVIEW guest together (cascade)", z1.webview === 1.1, `webview=${z1.webview}`);
  const pill = page.locator("[data-zoom-indicator]");
  check("indicator appears while zoomed", (await pill.count()) > 0);
  check("indicator shows 110%", (await pill.first().innerText().catch(() => "")) === "110%", await pill.first().innerText().catch(() => ""));
  await page.screenshot({ path: "/tmp/pw-zoom-1-110.png" });

  // Click the indicator → reset to 100%; host + webview both return, pill disappears.
  await pill.first().click().catch(() => {});
  await page.waitForTimeout(500);
  const z2 = await readZoom(app);
  check("clicking the indicator resets host to 100%", z2.host === 1, `host=${z2.host}`);
  check("clicking the indicator resets the webview to 100%", z2.webview === 1, `webview=${z2.webview}`);
  check("indicator hidden again after reset", (await page.locator("[data-zoom-indicator]").count()) === 0);
  await page.screenshot({ path: "/tmp/pw-zoom-2-reset.png" });

  // Zoom out below 100% to confirm the other direction + a fractional %.
  await clickMenuZoom(app, "Zoom Out");
  await page.waitForTimeout(400);
  const z3 = await readZoom(app);
  check("zoom-out drops host + webview to 90%", z3.host === 0.9 && z3.webview === 0.9, JSON.stringify(z3));
  check("indicator shows 90%", (await page.locator("[data-zoom-indicator]").first().innerText().catch(() => "")) === "90%");
  await page.screenshot({ path: "/tmp/pw-zoom-3-90.png" });

  // Leave persisted zoom at 100% so we don't pollute the next run / the real app.
  await clickMenuZoom(app, "Actual Size");
  await page.waitForTimeout(300);
  const zFinal = await readZoom(app);
  check("zoom is restored to 100% at the end", zFinal.host === 1, `host=${zFinal.host}`);

  fs.rmSync(htmlPath, { force: true });
  await app.close();
  try { fs.rmSync(dataRoot, { recursive: true, force: true }); } catch {}
  console.log(`DONE failures=${failures}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { try { fs.rmSync(htmlPath, { force: true }); } catch {} console.error("PW ERROR", e); process.exit(1); });
