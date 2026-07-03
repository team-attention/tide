// LIVE verification of the Working-indicator live-activity feature
// (live-turn-activity-visibility). Launches the BUILT app, picks claude + Bypass
// permissions (so a Task fan-out runs unattended), sends a prompt that forces several
// parallel subagents, and POLLS the Working indicator text — asserting it climbs from a
// bare "Working… Ns" to "… · N agents · M tool calls" while the fan-out runs, then
// clears at turn end.
const { _electron } = require("playwright");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const repo = path.resolve(__dirname, "..");
const PROMPT =
  "Use the Task tool to launch 4 general-purpose subagents IN PARALLEL right now (a single message with 4 Task calls). Each subagent: run two web searches about a different well-known company (Stripe, Figma, Notion, Linear) and report one sentence. Do NOT research yourself — you MUST delegate all of it to the 4 subagents, then summarize their replies.";

const log = (o) => console.log(JSON.stringify(o));

(async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-liveact-"));
  let app;
  process.on("exit", () => { try { app?.process()?.kill(); } catch {} });
  app = await _electron.launch({
    args: [path.join(repo, "out/main/electron-main.js")],
    env: { ...process.env, TIDE_APP_DATA_ROOT: dataRoot },
  });
  const page = await app.firstWindow();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e.message).slice(0, 200)));
  const shot = (l) => page.screenshot({ path: `/tmp/pw-liveact-${l}.png` });

  await page.waitForSelector("[data-product-shell]", { timeout: 20000 });
  await page.waitForTimeout(800);

  // claude + Bypass permissions (unattended fan-out)
  await page.locator('[data-composer-context-chip][data-context-kind="agent"]').first().click();
  await page.waitForSelector('[data-choice-surface="agent_menu"]', { timeout: 5000 });
  await page.locator('[data-choice-surface="agent_menu"] [data-choice-row]', { hasText: "Claude Code" }).first().click();
  await page.waitForTimeout(300);
  await page.locator('[aria-label="Permission"]').first().click();
  await page.locator('[data-choice-surface="permission_menu"]').waitFor({ timeout: 5000 });
  await page.locator('[data-choice-surface="permission_menu"] [data-choice-row]', { hasText: "Bypass permissions" }).first().click();
  await page.waitForTimeout(300);

  await page.locator('[aria-label="Composer draft"]').first().fill(PROMPT);
  await page.locator("[data-composer-send]").first().click();
  log({ phase: "sent" });

  // A fresh data root may gate on workspace trust — grant it so the turn runs.
  await page.waitForTimeout(1500);
  const trust = page.locator('[data-choice-row], button', { hasText: /Trust this folder/i });
  if (await trust.count()) {
    await trust.first().click();
    log({ phase: "trusted_folder" });
    await page.waitForTimeout(800);
    // Re-send if the draft was held behind the trust gate.
    const draft = page.locator('[aria-label="Composer draft"]').first();
    if ((await draft.inputValue().catch(() => "")).trim().length > 0) {
      await page.locator("[data-composer-send]").first().click();
      log({ phase: "resent" });
    }
  }

  // Poll the Working indicator text; record every distinct value + when it shows
  // agents/tool-calls. Stop when the turn ends (indicator gone + an answer present).
  const seen = [];
  let sawActivity = false;
  let cleared = false;
  const deadline = Date.now() + 200000;
  const t0 = Date.now();
  let lastSnap = "";
  while (Date.now() < deadline) {
    await page.waitForTimeout(1000);
    const at = Math.round((Date.now() - t0) / 1000);
    const snap = await page.evaluate(() => {
      const q = (s) => document.querySelectorAll(s).length;
      const workingText = document.querySelector("[data-working-text]");
      return {
        workingText: workingText ? workingText.textContent.trim() : null,
        workingTurn: q("[data-working="true"]"),
        toolBlocks: q('[data-block-role="tool"]'),
        agentTurns: q("[data-block-role="agent"]"),
        readiness: q('[data-choice-surface="provider_readiness"], .provider-readiness'),
      };
    }).catch(() => null);
    if (snap === null) continue;
    const text = snap.workingText;
    if (text && (seen.length === 0 || seen[seen.length - 1].text !== text)) {
      seen.push({ text, at });
      log({ phase: "indicator", at, text });
      if (/agent|tool call/i.test(text)) {
        if (!sawActivity) await shot("activity");
        sawActivity = true;
      }
    }
    // Periodic state snapshot for diagnosis (every distinct shape).
    const shapeKey = `${snap.workingText}|${snap.workingTurn}|${snap.toolBlocks}|${snap.readiness}`;
    if (shapeKey !== lastSnap) {
      lastSnap = shapeKey;
      log({ phase: "state", at, ...snap });
    }
    if (!text && snap.agentTurns > 0 && sawActivity) {
      cleared = true;
      log({ phase: "turn_end", at, agentTurns: snap.agentTurns });
      break;
    }
  }
  await shot("final");

  log({ phase: "summary", sawActivity, cleared, distinctTexts: seen.length, pageErrors });
  log({ phase: sawActivity && cleared ? "PASS" : "FAIL",
        detail: sawActivity ? (cleared ? "activity shown + cleared at turn end" : "activity shown but never cleared")
                            : "indicator never showed agents/tool-calls" });
  await app.close();
  process.exit(0);
})().catch((e) => { log({ phase: "error", message: String(e).slice(0, 300) }); process.exit(1); });
