// REAL-APP reproduction of the user's failing flow: claude research turn that
// needs TWO sequential permissions (WebSearch then WebFetch). Launches the BUILT
// Electron app, picks claude + "Ask permissions", sends the research prompt, and
// clicks Allow on EACH permission card as it appears — then asserts the final
// answer renders and the turn never hangs. This is the gap the headless harness
// and the single-permission E2E both miss.
const { _electron } = require("playwright");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const repo = path.resolve(__dirname, "..");
const PROMPT =
  "Use web search to find Figma's (ticker FIG) most recent short interest, then use web fetch on ONE source page to confirm the number, then reply with the short interest value.";

const log = (o) => console.log(JSON.stringify(o));
const checks = [];
const check = (ok, label, detail) => { checks.push(ok); log({ phase: ok ? "ok" : "fail", check: label, ...(detail ?? {}) }); };

(async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-research-"));
  let app;
  process.on("exit", () => { try { app?.process()?.kill(); } catch {} });
  app = await _electron.launch({
    args: [path.join(repo, "out/main/electron-main.js")],
    env: { ...process.env, TIDE_APP_DATA_ROOT: dataRoot },
  });
  const page = await app.firstWindow();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e.message).slice(0, 200)));
  const shot = (l) => page.screenshot({ path: `/tmp/pw-research-${l}.png` });

  await page.waitForSelector(".tide-product-shell", { timeout: 20000 });
  await page.waitForTimeout(800);

  // claude + Ask permissions
  await page.locator('.composer-shell__context-chip[data-context-kind="agent"]').first().click();
  await page.waitForSelector('[data-choice-surface="agent_menu"]', { timeout: 5000 });
  await page.locator('[data-choice-surface="agent_menu"] .choice-surface__row', { hasText: "Claude Code" }).first().click();
  await page.waitForTimeout(300);
  await page.locator('[aria-label="Permission"]').first().click();
  await page.locator('[data-choice-surface="permission_menu"]').waitFor({ timeout: 5000 });
  await page.locator('[data-choice-surface="permission_menu"] .choice-surface__row', { hasText: "Ask permissions" }).first().click();
  await page.waitForTimeout(300);

  await page.locator('[aria-label="Composer draft"]').first().fill(PROMPT);
  await page.locator(".composer-shell__send").first().click();
  log({ phase: "sent" });

  // Drive the turn: every time a permission card appears, Allow + Submit it.
  // Track distinct cards by their message so we know how many we approved.
  const approved = new Set();
  let answered = false;
  const deadline = Date.now() + 240000;
  let lastWorkingShotAt = 0;
  while (Date.now() < deadline) {
    await page.waitForTimeout(1500);

    const card = page.locator(".prompt-card");
    if (await card.count()) {
      const msg = (await card.locator(".prompt-card__message").innerText().catch(() => "")).trim();
      if (!approved.has(msg)) {
        approved.add(msg);
        log({ phase: "card", n: approved.size, message: msg });
        await shot(`card-${approved.size}`);
        const firstOption = card.locator(".prompt-card__option").first();
        if ((await firstOption.getAttribute("data-selected")) !== "true") {
          await firstOption.click();
        }
        const submit = card.locator(".prompt-card__submit");
        if (!(await submit.isDisabled())) {
          await submit.click();
          log({ phase: "approved", message: msg });
        }
      }
      continue;
    }

    // Final answer rendered? (PLTR/FIG short-interest number or any agent answer block
    // after the searches). Detect by the answer text containing digits + the turn idle.
    const shellText = await page.locator(".tide-product-shell").innerText();
    const hasNumberAnswer = /69|70|short interest|숏 인터레스트|주\b|million|shares/i.test(shellText) &&
      // exclude the user's own prompt echo
      shellText.replace(PROMPT, "").match(/\d{2}/);
    const working = /Working|Thinking/i.test(shellText);
    if (!working && approved.size > 0 && hasNumberAnswer) { answered = true; break; }

    // Periodic progress shot
    if (Date.now() - lastWorkingShotAt > 20000) { await shot("working"); lastWorkingShotAt = Date.now(); }
  }

  await shot("final");
  const shellText = await page.locator(".tide-product-shell").innerText();
  const stillWorking = /Working|Thinking/i.test(shellText);

  check(approved.size >= 1, "at_least_one_permission_card", { approved: approved.size });
  check(approved.size >= 2, "second_permission_card_surfaced", { approved: approved.size, messages: [...approved] });
  check(!stillWorking, "turn_did_not_hang_working", { stillWorking });
  check(answered, "final_answer_rendered");
  check(pageErrors.length === 0, "no_renderer_errors", { pageErrors });

  await app.close();
  const failed = checks.filter((c) => !c).length;
  log({ phase: failed === 0 ? "PASS" : "FAIL", failedChecks: failed, approved: approved.size });
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error("PW ERROR", e); process.exit(1); });
