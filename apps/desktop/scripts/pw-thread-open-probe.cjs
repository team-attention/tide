// Auth-safe (NO send, no provider spawn): boots the built app on a seeded CLAUDE
// thread, clicks the thread row, and reports whether the thread actually became the
// active send target (vs. the app staying on the new-thread-start surface).
const { _electron } = require("playwright");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const repo = path.resolve(__dirname, "..");

(async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-probe-"));
  const seed = spawnSync("node", [path.join(repo, "scripts/seed-thread.cjs"), dataRoot, "claude"], {
    cwd: repo, stdio: "inherit",
  });
  if (seed.status !== 0) throw new Error("seed failed");

  const app = await _electron.launch({
    args: [path.join(repo, "out/main/electron-main.js")],
    env: { ...process.env, TIDE_APP_DATA_ROOT: dataRoot },
  });
  const page = await app.firstWindow();
  await page.waitForSelector(".tide-product-shell", { timeout: 20000 });
  await page.waitForTimeout(1000);

  const rows = page.locator(".thread-row__main");
  console.log("thread rows:", await rows.count());
  await rows.first().click();
  await page.waitForTimeout(1500);

  const headerTitle = await page.locator(".agent-chat-shell [class*='thread-header'], .thread-header__title, h1, h2")
    .first().innerText().catch(() => "(none)");
  const startSurface = await page.locator(".agent-chat-shell--start").count();
  const followUpPlaceholder = await page.locator('[placeholder*="follow-up"]').count();
  const startPlaceholder = await page.locator('[placeholder*="Describe"], [placeholder*="What"], [placeholder*="task"]').count();
  const emptyState = await page.locator("text=/No messages here/i").count();
  const runtimeState = await page.locator("[data-runtime-state]").first().getAttribute("data-runtime-state").catch(() => null);
  const chatState = await page.locator("[data-chat-state]").first().getAttribute("data-chat-state").catch(() => null);

  console.log("header text:", JSON.stringify(headerTitle.slice(0, 80)));
  console.log("new-thread-start surface present?", startSurface > 0, "(want false — an opened thread is follow-up)");
  console.log("follow-up composer placeholder present?", followUpPlaceholder > 0, "(want true)");
  console.log("start-style placeholder present?", startPlaceholder > 0);
  console.log("'No messages here' empty state?", emptyState > 0);
  console.log("data-chat-state:", chatState, "data-runtime-state:", runtimeState);

  await page.screenshot({ path: "/tmp/pw-thread-open-probe.png" });
  await app.close();
  console.log("DONE");
})().catch((e) => { console.error("PW ERROR", e); process.exit(1); });
