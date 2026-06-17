// Live verify for two fixed bugs (drives the REAL built app via Playwright):
//   Bug 1: opening a Browser pane in the (composer) Workbench white-screened the whole app
//          (webview.isLoading() threw before dom-ready → unmounted the React tree).
//   Bug 2: opening the in-pane Editor file picker in the composer snapped the Workbench
//          shut (the draft thread's empty workbench.changed read as "nothing visible"),
//          and the picker then lingered as stale state on reopen.
// Auth-safe: never sends a message, never spawns a provider CLI.
const { _electron } = require("playwright");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const repo = path.resolve(__dirname, "..");

async function clickWorkbenchToggle(page) {
  const t = page.locator('[aria-label="Open Workbench"], [aria-label="Close Workbench"]').first();
  await t.waitFor({ state: "visible", timeout: 8000 });
  await t.click();
}

(async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-pw-bpv-"));
  const app = await _electron.launch({
    args: [path.join(repo, "out/main/electron-main.js")],
    env: { ...process.env, TIDE_APP_DATA_ROOT: dataRoot },
  });
  const page = await app.firstWindow();
  const fatal = [];
  page.on("pageerror", (e) => fatal.push(e.message));
  await page.waitForSelector(".tide-product-shell", { timeout: 20000 });
  await page.waitForTimeout(1000);

  let pass = true;
  const check = (label, cond) => { console.log((cond ? "PASS " : "FAIL ") + label); if (!cond) pass = false; };

  // ---- Bug 1: Browser pane must not white-screen the app ----
  await clickWorkbenchToggle(page);
  await page.waitForTimeout(700);
  await page.locator('[data-launcher-action="open_browser"]').first().click();
  await page.waitForTimeout(2500);
  check("app still mounted after opening Browser (no white screen)",
    (await page.locator(".tide-product-shell").count()) === 1);
  check("browser pane rendered", (await page.locator('[data-pane-kind="browser"]').count()) > 0);
  check("no fatal renderer error on Browser open", fatal.length === 0);

  // ---- Bug 2: Editor picker keeps the Workbench open, and a close abandons it ----
  await page.locator('[aria-label="New Pane"]').first().click().catch(() => {});
  await page.waitForTimeout(600);
  await page.locator('[data-launcher-action="open_editor"]').first().click();
  await page.waitForTimeout(1200);
  check("editor picker shows inline after clicking Editor",
    (await page.locator(".editor-picker").count()) > 0);
  check("workbench STAYS OPEN with the picker",
    (await page.locator('[aria-label="Close Workbench"]').count()) > 0);

  await clickWorkbenchToggle(page); // close
  await page.waitForTimeout(800);
  await clickWorkbenchToggle(page); // reopen
  await page.waitForTimeout(800);
  check("picker NOT stale after close + reopen",
    (await page.locator(".editor-picker").count()) === 0);
  check("launcher returns after close + reopen",
    (await page.locator(".workbench-launcher-action").count()) === 5);

  if (fatal.length > 0) console.log("FATAL renderer errors:", fatal.slice(0, 3));
  console.log(pass ? "\nALL PASS" : "\nSOME FAILED");
  await app.close();
  process.exit(pass ? 0 : 1);
})().catch((e) => {
  console.error("PW ERROR", e);
  process.exit(1);
});
