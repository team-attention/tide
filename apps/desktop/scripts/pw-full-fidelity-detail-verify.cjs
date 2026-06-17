// Live verification for prompt-full-fidelity-fields Slice 1, approval DETAIL half: drive a
// REAL claude turn that requests Bash permission, then confirm the .prompt-card renders the
// command as a `detail` block (claude-stream-json-client buildPermissionDetail).
const { _electron } = require("playwright");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const repo = path.resolve(__dirname, "..");
const log = (o) => console.log(JSON.stringify(o));
const ASK =
  "Create a new file at /tmp/tide-fidelity-test.txt containing exactly the text " +
  "'hello-tide-fidelity' using the Write tool now. Do not explain — just write it.";

(async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-ffid2-"));
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

  const deadline = Date.now() + 150000;
  let cardUp = false;
  while (Date.now() < deadline) {
    cardUp = await page.locator(".prompt-card").first().isVisible().catch(() => false);
    if (cardUp) break;
    await page.waitForTimeout(2000);
  }
  log({ cardUp });
  if (!cardUp) {
    await page.screenshot({ path: path.join(dataRoot, "ffid2-nocard.png") });
    log({ verdict: "NO_CARD", dataRoot });
    await app.close();
    return;
  }

  await page.waitForTimeout(400);
  const card = await page.evaluate(() => {
    const el = document.querySelector(".prompt-card");
    if (!el) return null;
    const txt = (n) => (n ? (n.textContent || "").trim() : null);
    return {
      kindLabel: txt(el.querySelector(".prompt-card__kind")),
      message: txt(el.querySelector(".prompt-card__message")),
      detailFormat: el.querySelector(".prompt-card__detail")?.getAttribute("data-format") ?? null,
      detailBody: txt(el.querySelector(".prompt-card__detail-body")),
      options: [...el.querySelectorAll(".prompt-card__option-label")].map((n) => txt(n)),
      leaksStructuredToken: (el.textContent || "").includes("structured:"),
    };
  });
  await page.screenshot({ path: path.join(dataRoot, "ffid2-approval-card.png") });
  log({ card });

  const detailOk = !!(card && card.detailBody && card.detailBody.includes("hello-tide-fidelity"));
  log({
    verdict: detailOk && card.leaksStructuredToken === false ? "PASS" : "CHECK",
    detailOk, noLeak: card && card.leaksStructuredToken === false,
    screenshot: path.join(dataRoot, "ffid2-approval-card.png"),
    dataRoot,
  });
  await app.close();
})().catch((e) => { log({ fatal: String(e && e.stack || e).slice(0, 400) }); process.exit(1); });
