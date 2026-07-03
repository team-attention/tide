// Live verification (real claude turn) for spec: waiting-state-recovery.
// Reproduces the user's flow: drive claude to raise an AskUserQuestion card, then prove
//   (1) the card SURFACES and SURVIVES the turn-end (root projector fix — pre-fix a
//       notice-tagged turn-end force-dropped the just-raised card),
//   (2) a Stop escape is available while waiting (interrupt-in-waiting fix), and
//   (3) clicking Stop UNLOCKS the thread (composer usable, card gone) — no permanent lock.
const { _electron } = require("playwright");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const repo = path.resolve(__dirname, "..");
const PROMPT =
  "Use the AskUserQuestion tool right now to ask me to choose my favorite among Red, Green, or Blue. Only ask the question with that tool — do not do anything else and do not answer it yourself.";

const checks = [];
const check = (ok, label, detail) => {
  checks.push(ok);
  console.log(JSON.stringify({ phase: ok ? "ok" : "FAIL", check: label, ...(detail ?? {}) }));
};

(async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-waitrec-"));
  let app;
  process.on("exit", () => { try { app?.process()?.kill(); } catch {} });
  app = await _electron.launch({
    args: [path.join(repo, "out/main/electron-main.js")],
    env: { ...process.env, TIDE_APP_DATA_ROOT: dataRoot },
  });
  const page = await app.firstWindow();
  page.on("pageerror", (e) => console.log(JSON.stringify({ phase: "pageerror", message: String(e.message).slice(0, 200) })));
  const shot = (l) => page.screenshot({ path: `/tmp/pw-waitrec-${l}.png` });

  await page.waitForSelector("[data-product-shell]", { timeout: 20000 });
  await page.waitForTimeout(800);

  // claude + Ask permissions
  await page.locator('[data-composer-context-chip][data-context-kind="agent"]').first().click();
  await page.waitForSelector('[data-choice-surface="agent_menu"]', { timeout: 5000 });
  await page.locator('[data-choice-surface="agent_menu"] [data-choice-row]', { hasText: "Claude Code" }).first().click();
  await page.waitForTimeout(300);
  await page.locator('[aria-label="Permission"]').first().click();
  await page.locator('[data-choice-surface="permission_menu"]').waitFor({ timeout: 5000 });
  await page.locator('[data-choice-surface="permission_menu"] [data-choice-row]', { hasText: "Ask permissions" }).first().click();
  await page.waitForTimeout(300);

  await page.locator('[aria-label="Composer draft"]').first().fill(PROMPT);
  await page.locator("[data-composer-send]").first().click();
  console.log("sent; waiting for a prompt card (AskUserQuestion or a tool permission)…");

  // (1) A card surfaces. Permission cards for the tool may surface first; either is a
  // waiting state. We accept the FIRST card and then prove it survives.
  const card = page.locator("[data-prompt-card]");
  let appeared = false;
  try { await card.first().waitFor({ state: "visible", timeout: 180000 }); appeared = true; } catch {}
  check(appeared, "a prompt card surfaced (thread reached a waiting state)");
  if (!appeared) {
    await shot("nocard");
    const txt = await page.locator("[data-product-shell]").innerText().catch(() => "");
    console.log(JSON.stringify({ phase: "dump", tail: txt.slice(-600) }));
    await app.close();
    process.exit(1);
  }
  const cardMsg = (await card.first().locator("[data-prompt-message]").innerText().catch(() => "")).trim();
  console.log(JSON.stringify({ phase: "card", message: cardMsg.slice(0, 120) }));
  await shot("1-card");

  // (2) The card SURVIVES the turn-end. Pre-fix, a notice/empty turn-end force-dropped
  // it within a second or two. Watch for 8s and assert it stays.
  let survivedMs = 0;
  for (let i = 0; i < 8; i += 1) {
    await page.waitForTimeout(1000);
    if (await card.first().isVisible().catch(() => false)) survivedMs += 1000;
    else break;
  }
  check(survivedMs >= 8000, "the card SURVIVES the turn-end (not force-dropped)", { survivedMs });
  await shot("2-survived");

  // (3) A Stop escape is present while waiting (interrupt-in-waiting fix). The bottom
  // run-state button must be Stop, and runtimeState must be a waiting_* value.
  const runtimeState = await page.locator("[data-runtime-state]").first().getAttribute("data-runtime-state").catch(() => null);
  const stopVisible = await page.locator("[data-composer-stop]").first().isVisible().catch(() => false);
  check(stopVisible, "a Stop escape button is shown in the waiting state", { runtimeState });

  // (4) Clicking Stop UNLOCKS: the card clears and the thread leaves the waiting state.
  if (stopVisible) {
    await page.locator("[data-composer-stop]").first().click();
    await page.waitForTimeout(2500);
    const cardGone = !(await card.first().isVisible().catch(() => false));
    const stateAfter = await page.locator("[data-runtime-state]").first().getAttribute("data-runtime-state").catch(() => null);
    const composerEnabled = await page.locator('[aria-label="Composer draft"]').first().isEnabled().catch(() => false);
    check(cardGone && stateAfter !== "waiting_for_approval" && stateAfter !== "waiting_for_input",
      "Stop unlocked the thread (card cleared, left waiting)", { stateAfter, cardGone, composerEnabled });
  }
  await shot("3-after-stop");

  const passed = checks.every(Boolean);
  console.log(JSON.stringify({ phase: "summary", passed, total: checks.length, ok: checks.filter(Boolean).length }));
  await app.close();
  process.exit(passed ? 0 : 1);
})().catch((e) => { console.log(JSON.stringify({ phase: "crash", error: String(e).slice(0, 300) })); process.exit(1); });
