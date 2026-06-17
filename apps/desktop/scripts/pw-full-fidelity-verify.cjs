// Live verification for prompt-full-fidelity-fields Slice 1: drive a REAL claude turn that
// calls AskUserQuestion, then capture the surfaced .prompt-card DOM to confirm it renders
// the question HEADER chip and per-option DESCRIPTION (and that the internal "structured:"
// routing token is NOT leaked as option text). AUQ schema requires header + option
// description, so any real AUQ call exercises these fields.
const { _electron } = require("playwright");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const repo = path.resolve(__dirname, "..");
const log = (o) => console.log(JSON.stringify(o));
const ASK =
  "Use the AskUserQuestion tool RIGHT NOW to ask me exactly one question: which database should we use? " +
  "Offer three options — Postgres, MySQL, SQLite — and give each option a short one-line description. " +
  "Use only that tool, nothing else.";

(async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-ffid-"));
  let app;
  process.on("exit", () => { try { app?.process()?.kill(); } catch {} });
  app = await _electron.launch({
    args: [path.join(repo, "out/main/electron-main.js")],
    env: { ...process.env, TIDE_APP_DATA_ROOT: dataRoot },
  });
  const page = await app.firstWindow();
  page.on("pageerror", (e) => log({ pageerror: String(e.message).slice(0, 200) }));
  await page.waitForSelector(".tide-product-shell", { timeout: 20000 });
  await page.waitForTimeout(700);

  // Select Claude Code + "Ask permissions" so the AUQ tool prompt surfaces as a card.
  await page.locator('.composer-shell__context-chip[data-context-kind="agent"]').first().click();
  await page.waitForSelector('[data-choice-surface="agent_menu"]', { timeout: 5000 });
  await page.locator('[data-choice-surface="agent_menu"] .choice-surface__row', { hasText: "Claude Code" }).first().click();
  await page.waitForTimeout(200);
  await page.locator('[aria-label="Permission"]').first().click();
  await page.locator('[data-choice-surface="permission_menu"]').waitFor({ timeout: 5000 });
  await page.locator('[data-choice-surface="permission_menu"] .choice-surface__row', { hasText: "Ask permissions" }).first().click();
  await page.waitForTimeout(200);

  await page.locator('[aria-label="Composer draft"]').first().fill(ASK);
  await page.locator(".composer-shell__send").first().click();
  log({ sent: true });

  // Wait for the AUQ card (real claude turn — generous budget).
  const deadline = Date.now() + 150000;
  let cardUp = false;
  while (Date.now() < deadline) {
    cardUp = await page.locator(".prompt-card").first().isVisible().catch(() => false);
    if (cardUp) break;
    await page.waitForTimeout(2000);
  }
  log({ cardUp });
  if (!cardUp) {
    await page.screenshot({ path: path.join(dataRoot, "ffid-nocard.png") });
    log({ verdict: "NO_CARD", dataRoot });
    await app.close();
    return;
  }

  await page.waitForTimeout(500);
  // Scrape the card: header chip(s), each option's label + secondary line, detail body.
  const card = await page.evaluate(() => {
    const el = document.querySelector(".prompt-card");
    if (!el) return null;
    const txt = (n) => (n ? (n.textContent || "").trim() : null);
    return {
      kindLabel: txt(el.querySelector(".prompt-card__kind")),
      headerChips: [...el.querySelectorAll(".prompt-card__header-chip")].map((n) => txt(n)),
      message: txt(el.querySelector(".prompt-card__message")),
      options: [...el.querySelectorAll(".prompt-card__option")].map((o) => ({
        label: txt(o.querySelector(".prompt-card__option-label")),
        secondary: txt(o.querySelector(".prompt-card__option-value")),
      })),
      hasPreview: !!el.querySelector(".prompt-card__option-preview"),
      detailBody: txt(el.querySelector(".prompt-card__detail-body")),
      // Token-leak guard: NO visible text in the card should contain the internal prefix.
      leaksStructuredToken: (el.textContent || "").includes("structured:"),
    };
  });
  await page.screenshot({ path: path.join(dataRoot, "ffid-auq-card.png") });
  log({ card });

  const headerOk = Array.isArray(card?.headerChips) && card.headerChips.some((h) => h && h.length > 0);
  const descOk = Array.isArray(card?.options) && card.options.some((o) => o.secondary && o.secondary.length > 0);
  const noLeak = card && card.leaksStructuredToken === false;
  log({
    verdict: headerOk && descOk && noLeak ? "PASS" : "CHECK",
    headerOk, descOk, noLeak,
    screenshot: path.join(dataRoot, "ffid-auq-card.png"),
    dataRoot,
  });
  await app.close();
})().catch((e) => { log({ fatal: String(e && e.stack || e).slice(0, 400) }); process.exit(1); });
