// Live proof for the "click a link in chat → whole window freezes on the
// external site" bug. Chat markdown links render as plain <a href> anchors in
// the MAIN host renderer; before the fix a click navigated the top-level
// webContents to the external URL, unmounting the React app with no way back.
//
// This launches the built app and simulates that exact click (a plain external
// <a href> in the host renderer). PASS = the window did NOT navigate away
// (page.url unchanged) AND the Tide app is still mounted (.tide-product-shell
// present). The off-app URL is meant to be handed to the system browser via
// shell.openExternal — it uses the reserved example.com so nothing real loads.
//   node scripts/pw-link-guard.cjs
const { _electron } = require("playwright");
const path = require("node:path"), os = require("node:os"), fs = require("node:fs");
const repo = path.resolve(__dirname, "..");
(async () => {
  const dr = fs.mkdtempSync(path.join(os.tmpdir(), "tide-linkguard-"));
  const app = await _electron.launch({
    args: [path.join(repo, "out/main/electron-main.js")],
    env: { ...process.env, TIDE_APP_DATA_ROOT: dr },
  });
  const page = await app.firstWindow();
  await page.waitForSelector(".tide-product-shell", { timeout: 20000 });
  await page.waitForTimeout(800);
  const before = page.url();

  // Inject + click a plain external anchor in the host renderer — the same
  // shape markdown-it produces for an http(s) link in a chat message.
  await page.evaluate(() => {
    const a = document.createElement("a");
    a.href = "https://example.com/from-chat-link";
    a.id = "__tide_linkguard";
    a.textContent = "external";
    document.body.appendChild(a);
    a.click();
  });
  await page.waitForTimeout(1800);

  const after = page.url();
  const shellIntact = (await page.locator(".tide-product-shell").count()) > 0;
  const urlUnchanged = before === after;
  const pass = urlUnchanged && shellIntact;
  console.log(JSON.stringify({ before, after, urlUnchanged, shellIntact, pass }));
  await app.close();
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
