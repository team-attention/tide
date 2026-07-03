// Live verification for prompt-full-fidelity-fields Slice 1, codex + ACP halves: drive a
// REAL turn for the given provider that requests approval/permission, then capture the
// [data-prompt-card] detail (command/diff + paths) and each option's native `kind` (ACP).
// Usage: node pw-provider-card-verify.cjs "<agentLabel>" "<permissionLabel>" "<prompt>"
const { _electron } = require("playwright");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const repo = path.resolve(__dirname, "..");
const log = (o) => console.log(JSON.stringify(o));
const [AGENT, PERM, ASK] = process.argv.slice(2);

(async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-pcard-"));
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
  await page.locator('[data-choice-surface="agent_menu"] [data-choice-row]', { hasText: AGENT }).first().click();
  await page.waitForTimeout(250);
  await page.locator('[aria-label="Permission"]').first().click();
  await page.locator('[data-choice-surface="permission_menu"]').waitFor({ timeout: 5000 });
  await page.locator('[data-choice-surface="permission_menu"] [data-choice-row]', { hasText: PERM }).first().click();
  await page.waitForTimeout(250);

  await page.locator('[aria-label="Composer draft"]').first().fill(ASK);
  await page.locator("[data-composer-send]").first().click();
  log({ agent: AGENT, sent: true });

  const deadline = Date.now() + 150000;
  let cardUp = false;
  while (Date.now() < deadline) {
    cardUp = await page.locator("[data-prompt-card]").first().isVisible().catch(() => false);
    if (cardUp) break;
    await page.waitForTimeout(2000);
  }
  log({ cardUp });
  if (!cardUp) { await page.screenshot({ path: path.join(dataRoot, "pcard-nocard.png") }); log({ verdict: "NO_CARD", agent: AGENT, dataRoot }); await app.close(); return; }

  await page.waitForTimeout(400);
  const card = await page.evaluate(() => {
    const el = document.querySelector("[data-prompt-card]");
    if (!el) return null;
    const txt = (n) => (n ? (n.textContent || "").trim() : null);
    return {
      kindLabel: txt(el.querySelector("[data-prompt-kind-label]")),
      message: txt(el.querySelector("[data-prompt-message]")),
      detailFormat: el.querySelector("[data-prompt-detail]")?.getAttribute("data-format") ?? null,
      detailBody: txt(el.querySelector("[data-prompt-detail-body]")),
      locations: [...el.querySelectorAll("[data-prompt-detail-location]")].map((n) => txt(n)),
      options: [...el.querySelectorAll("[data-prompt-option]")].map((o) => ({
        label: txt(o.querySelector("[data-prompt-option-label]")),
        kind: o.getAttribute("data-kind"),
      })),
      leaksStructuredToken: (el.textContent || "").includes("structured:"),
    };
  });
  await page.screenshot({ path: path.join(dataRoot, "pcard.png") });
  log({ agent: AGENT, card });
  log({ verdict: card && card.leaksStructuredToken === false ? "CARD_OK" : "CHECK", screenshot: path.join(dataRoot, "pcard.png"), dataRoot });
  await app.close();
})().catch((e) => { log({ fatal: String(e && e.stack || e).slice(0, 400) }); process.exit(1); });
