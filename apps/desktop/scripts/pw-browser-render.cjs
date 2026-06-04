// Ground-truth check for the workbench Browser Pane: open a thread, open the
// workbench, pick the Browser launcher action, navigate to a real URL, and verify
// the <webview> actually mounts and loads. Pure UI drive — no agent, no codex.
const { _electron } = require("playwright");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const repo = path.resolve(__dirname, "..");

(async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-br-"));
  spawnSync("node", [path.join(repo, "scripts/seed-thread.cjs"), dataRoot], { cwd: repo, stdio: "inherit" });
  const app = await _electron.launch({
    args: [path.join(repo, "out/main/electron-main.js")],
    env: { ...process.env, TIDE_APP_DATA_ROOT: dataRoot },
  });
  const page = await app.firstWindow();
  await page.waitForSelector(".tide-product-shell", { timeout: 20000 });
  await page.waitForTimeout(800);

  // Open the seeded thread (hydrate, no message sent).
  await page.locator(".thread-row__main").first().click();
  await page.waitForTimeout(900);

  // Open the workbench.
  await page.locator('[aria-label="Open Workbench"]').first().click().catch(() => {});
  await page.waitForTimeout(600);

  // Pick the Browser launcher action.
  const browserAction = page.locator('[data-launcher-action="open_browser"]').first();
  console.log("launcher Browser action present?", (await browserAction.count()) > 0);
  await browserAction.click().catch((e) => console.log("click err", e.message));
  await page.waitForTimeout(700);

  // Type a URL and navigate.
  const bar = page.locator(".workbench-browser-bar__input").first();
  console.log("browser address bar present?", (await bar.count()) > 0);
  if (await bar.count()) {
    await bar.fill("https://example.com");
    await page.locator(".workbench-browser-bar__go").first().click();
  }
  await page.waitForTimeout(3500);

  // Inspect the webview element.
  const info = await page.evaluate(() => {
    const wv = document.querySelector(".workbench-browser-webview");
    if (!wv) return { exists: false };
    const r = wv.getBoundingClientRect();
    return {
      exists: true,
      tag: wv.tagName,
      src: wv.getAttribute("src"),
      width: Math.round(r.width),
      height: Math.round(r.height),
      hasGetURL: typeof wv.getURL === "function",
      url: typeof wv.getURL === "function" ? wv.getURL() : null,
    };
  });
  console.log("WEBVIEW:", JSON.stringify(info));
  await page.screenshot({ path: "/tmp/pw-browser-render.png" });
  console.log("screenshot -> /tmp/pw-browser-render.png");

  await app.close();
  console.log("DONE");
})().catch((e) => { console.error("ERR", e); process.exit(1); });
