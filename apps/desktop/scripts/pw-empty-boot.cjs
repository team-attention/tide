const { _electron } = require("playwright");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const repo = require("path").resolve(__dirname, "..");
(async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-empty-")); // NO seed
  const app = await _electron.launch({ args: [path.join(repo, "out/main/electron-main.js")], env: { ...process.env, TIDE_APP_DATA_ROOT: dataRoot } });
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE.ERROR: " + m.text().slice(0,300)); });
  await page.waitForTimeout(2500);
  const shellPresent = await page.locator(".tide-product-shell").count();
  const bodyText = (await page.locator("body").innerText().catch(() => "")).slice(0, 100);
  console.log("shell present:", shellPresent, "| body text:", JSON.stringify(bodyText));
  console.log("errors:", JSON.stringify(errors, null, 1));
  await page.screenshot({ path: "/tmp/pw-empty-boot.png" });
  await app.close();
  console.log("DONE");
})().catch((e) => { console.error("ERR", e); process.exit(1); });
