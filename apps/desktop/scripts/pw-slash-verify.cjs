// Auth-safe: boots the REAL built app on a seeded thread and types "/" into the
// composer to verify the slash-command suggestions popover renders. Never sends a
// message, never spawns a provider.
const { _electron } = require("playwright");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const repo = path.resolve(__dirname, "..");

(async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-pw-slash-"));
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
  await page.waitForSelector(".tide-product-shell", { timeout: 20000 });
  await page.waitForTimeout(1200);

  const threadRows = page.locator(".thread-row__main");
  if ((await threadRows.count()) > 0) {
    await threadRows.first().click();
    await page.waitForTimeout(1000);
  }

  // Find the composer textarea and type "/".
  const composer = page.locator("textarea").first();
  const haveComposer = (await composer.count()) > 0;
  console.log("composer textarea present?", haveComposer);
  if (haveComposer) {
    await composer.click();
    await composer.type("/", { delay: 50 });
    await page.waitForTimeout(900);
  }
  await page.screenshot({ path: "/tmp/pw-slash-1-typed.png" });

  // The popover renders the active choice surface. Probe several plausible hooks.
  const probes = [
    ".chip-popover",
    "[data-surface-kind='command_suggestions']",
    ".choice-surface",
    "[role='listbox']",
    ".chip-popover__row",
    ".choice-surface__row",
  ];
  for (const sel of probes) {
    const c = await page.locator(sel).count();
    console.log(`selector ${sel}: ${c}`);
  }

  // Dump any popover row text we can find.
  const rows = page.locator(".chip-popover__row, .choice-surface__row, [role='option']");
  const rowCount = await rows.count();
  console.log("popover rows:", rowCount);
  const labels = [];
  for (let i = 0; i < Math.min(rowCount, 20); i += 1) {
    labels.push((await rows.nth(i).innerText()).trim().replace(/\s+/g, " "));
  }
  console.log("row labels:", JSON.stringify(labels));

  await app.close();
  console.log("DONE dataRoot=", dataRoot);
})().catch((e) => {
  console.error("PW ERROR", e);
  process.exit(1);
});
