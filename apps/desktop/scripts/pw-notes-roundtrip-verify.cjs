// Live verification for prompt-full-fidelity-fields Slice 2: answer a REAL claude
// AskUserQuestion with a free-text NOTE, and confirm claude actually received it (the note
// rides back as updatedInput.annotations). The note instructs claude to echo a distinctive
// token; if claude's follow-up contains it, the annotations round-trip works end to end.
const { _electron } = require("playwright");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const repo = path.resolve(__dirname, "..");
const log = (o) => console.log(JSON.stringify(o));
const TOKEN = "ZEBRA-NOTE-OK-7341";
const ASK = "Use the AskUserQuestion tool right now to ask me to pick a fruit — Apple or Banana. Use only that tool, nothing else.";
const NOTE = `IMPORTANT NOTE: after you receive my answer, reply with the exact token ${TOKEN} so I can confirm you read this note.`;

(async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-notes-"));
  let app;
  process.on("exit", () => { try { app?.process()?.kill(); } catch {} });
  app = await _electron.launch({
    args: [path.join(repo, "out/main/electron-main.js")],
    env: { ...process.env, TIDE_APP_DATA_ROOT: dataRoot },
  });
  const page = await app.firstWindow();
  page.on("pageerror", (e) => log({ pageerror: String(e.message).slice(0, 200) }));
  await page.waitForSelector("[data-product-shell]", { timeout: 20000 });
  await page.waitForTimeout(700);

  await page.locator('[data-composer-context-chip][data-context-kind="agent"]').first().click();
  await page.waitForSelector('[data-choice-surface="agent_menu"]', { timeout: 5000 });
  await page.locator('[data-choice-surface="agent_menu"] [data-choice-row]', { hasText: "Claude Code" }).first().click();
  await page.waitForTimeout(200);
  await page.locator('[aria-label="Permission"]').first().click();
  await page.locator('[data-choice-surface="permission_menu"]').waitFor({ timeout: 5000 });
  await page.locator('[data-choice-surface="permission_menu"] [data-choice-row]', { hasText: "Ask permissions" }).first().click();
  await page.waitForTimeout(200);

  await page.locator('[aria-label="Composer draft"]').first().fill(ASK);
  await page.locator("[data-composer-send]").first().click();
  log({ sent: true });

  // Wait for the AUQ card.
  const cardDeadline = Date.now() + 150000;
  let cardUp = false;
  while (Date.now() < cardDeadline) {
    cardUp = await page.locator("[data-prompt-card]").first().isVisible().catch(() => false);
    if (cardUp) break;
    await page.waitForTimeout(2000);
  }
  log({ cardUp });
  if (!cardUp) { await page.screenshot({ path: path.join(dataRoot, "notes-nocard.png") }); log({ verdict: "NO_CARD", dataRoot }); await app.close(); return; }

  // The note field must render on the AUQ card (Slice 2 UI).
  const noteVisible = await page.locator("[data-prompt-note]").first().isVisible().catch(() => false);
  log({ noteFieldVisible: noteVisible });

  await page.locator("[data-prompt-note]").first().fill(NOTE);
  await page.locator("[data-prompt-option]").first().click(); // pick the first option
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(dataRoot, "notes-card-filled.png") });
  await page.locator("[data-prompt-submit]").first().click();
  log({ answered: true });

  // Poll claude's follow-up for the token.
  const tokenDeadline = Date.now() + 120000;
  let sawToken = false;
  while (Date.now() < tokenDeadline) {
    const body = await page.evaluate(() => document.body.innerText).catch(() => "");
    // Ignore the note field's own echo: only count the token OUTSIDE the prompt card.
    const cardText = await page.locator("[data-prompt-card]").first().innerText().catch(() => "");
    const outside = body.replace(cardText, "");
    if (outside.includes(TOKEN)) { sawToken = true; break; }
    await page.waitForTimeout(2500);
  }
  await page.screenshot({ path: path.join(dataRoot, "notes-followup.png") });
  log({
    verdict: noteVisible && sawToken ? "PASS" : sawToken ? "PASS_NO_FIELD" : "ANNOTATIONS_NOT_HONORED",
    noteFieldVisible: noteVisible,
    claudeEchoedToken: sawToken,
    screenshot: path.join(dataRoot, "notes-followup.png"),
    dataRoot,
  });
  await app.close();
})().catch((e) => { log({ fatal: String(e && e.stack || e).slice(0, 400) }); process.exit(1); });
