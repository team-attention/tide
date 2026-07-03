// Repro the user's REAL condition: 3 threads each raising AskUserQuestion CONCURRENTLY,
// while switching between them. Asserts every thread surfaces its card (not stuck Working).
const { _electron } = require("playwright");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const repo = path.resolve(__dirname, "..");
const log = (o) => console.log(JSON.stringify(o));
const ASK = "Use the AskUserQuestion tool right now to ask me to pick one of Red, Green, Blue. Only ask with that tool, nothing else.";

(async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-conc-"));
  let app;
  process.on("exit", () => { try { app?.process()?.kill(); } catch {} });
  app = await _electron.launch({ args: [path.join(repo, "out/main/electron-main.js")], env: { ...process.env, TIDE_APP_DATA_ROOT: dataRoot } });
  const page = await app.firstWindow();
  page.on("pageerror", (e) => log({ pageerror: String(e.message).slice(0, 160) }));
  await page.waitForSelector("[data-product-shell]", { timeout: 20000 });
  await page.waitForTimeout(700);

  const pickClaudeAskPerms = async () => {
    await page.locator('[data-composer-context-chip][data-context-kind="agent"]').first().click();
    await page.waitForSelector('[data-choice-surface="agent_menu"]', { timeout: 5000 });
    await page.locator('[data-choice-surface="agent_menu"] [data-choice-row]', { hasText: "Claude Code" }).first().click();
    await page.waitForTimeout(200);
    await page.locator('[aria-label="Permission"]').first().click();
    await page.locator('[data-choice-surface="permission_menu"]').waitFor({ timeout: 5000 });
    await page.locator('[data-choice-surface="permission_menu"] [data-choice-row]', { hasText: "Ask permissions" }).first().click();
    await page.waitForTimeout(200);
  };

  // Start 3 threads in quick succession (concurrent runtimes).
  const started = [];
  for (let i = 0; i < 3; i += 1) {
    if (i > 0) { await page.locator("[data-left-nav-row]", { hasText: "New thread" }).first().click(); await page.waitForTimeout(400); }
    await pickClaudeAskPerms();
    await page.locator('[aria-label="Composer draft"]').first().fill(`[t${i}] ${ASK}`);
    await page.locator("[data-composer-send]").first().click();
    log({ started: i });
    await page.waitForTimeout(1500); // stagger slightly, but all run concurrently
  }

  // Let all three work concurrently.
  await page.waitForTimeout(3000);

  // Now visit each thread row and check whether its card surfaced (or it's stuck Working).
  const rows = page.locator("[data-thread-row]");
  const n = await rows.count();
  log({ threadRows: n });
  const results = [];
  const deadline = Date.now() + 150000;
  // Poll: for each of the top 3 rows, click it, wait for a card up to a budget.
  for (let i = 0; i < Math.min(3, n); i += 1) {
    const row = page.locator("[data-thread-row]").nth(i);
    const tid = await row.getAttribute("data-thread-row").catch(() => null);
    await row.click();
    await page.waitForTimeout(1500);
    let cardUp = false; let state = null; let working = false;
    while (Date.now() < deadline) {
      cardUp = await page.locator("[data-prompt-card]").first().isVisible().catch(() => false);
      state = await page.locator("[data-runtime-state]").first().getAttribute("data-runtime-state").catch(() => null);
      working = await page.locator("[data-product-shell]", { hasText: "Working" }).count().then((c) => c > 0).catch(() => false);
      if (cardUp || (state && state !== "running" && state !== "starting" && !working)) break;
      await page.waitForTimeout(2000);
    }
    results.push({ idx: i, tid: (tid || "").slice(0, 10), cardUp, state, working });
    log({ visited: i, tid: (tid || "").slice(0, 10), cardUp, state, working });
    await page.screenshot({ path: path.join(dataRoot, `pw-conc-${i}.png`) });
  }

  const stuck = results.filter((r) => !r.cardUp && (r.working || r.state === "running"));
  log({ summary: true, total: results.length, stuckOnWorking: stuck.length, results });
  await app.close();
  process.exit(stuck.length === 0 ? 0 : 2);
})().catch((e) => { log({ crash: String(e).slice(0, 300) }); process.exit(1); });
