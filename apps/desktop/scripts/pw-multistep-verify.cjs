// Live verification (real claude turn) for multi-step prompt navigation:
//   a MULTI-question AskUserQuestion renders as ONE navigable wizard — step counter +
//   dots, Back disabled on step 1, Next→last→Submit, and you can go BACK to revise an
//   earlier answer before the single submit. See multi-step-prompt-navigation.md.
const { _electron } = require("playwright");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const repo = path.resolve(__dirname, "..");
let failures = 0;
const check = (label, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` — ${detail}` : ""}`); if (!ok) failures += 1; };

const PROMPT =
  "Call the AskUserQuestion tool RIGHT NOW, exactly once, with THREE questions in the " +
  "one call: (1) header 'Fruit', question 'Pick a fruit?', options Apple, Banana; " +
  "(2) header 'Size', question 'What size?', options Small, Large; " +
  "(3) header 'Color', question 'Which color?', options Red, Green. Do nothing else — just ask.";

(async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-pw-ms2-"));
  const app = await _electron.launch({
    args: [path.join(repo, "out/main/electron-main.js")],
    env: { ...process.env, TIDE_APP_DATA_ROOT: dataRoot },
  });
  const page = await app.firstWindow();
  await page.waitForSelector("[data-product-shell]", { timeout: 20000 });
  await page.waitForTimeout(800);

  // claude on the default Scratch scope (auto-trusts).
  await page.locator('[data-composer-context-chip][data-context-kind="agent"]').first().click();
  await page.waitForSelector('[data-choice-surface="agent_menu"]', { timeout: 5000 });
  await page.locator('[data-choice-surface="agent_menu"] [data-choice-row]', { hasText: "Claude Code" }).first().click();
  await page.waitForTimeout(400);
  await page.locator('[aria-label="Composer draft"]').first().fill(PROMPT);
  await page.locator("[data-composer-send]").first().click();
  console.log("sent; waiting for the AskUserQuestion wizard…");

  const card = page.locator("[data-prompt-card]");
  let appeared = false;
  try { await card.waitFor({ state: "visible", timeout: 180000 }); appeared = true; } catch {}
  // A wizard must carry step dots; if a plain permission card surfaces first, click through.
  for (let i = 0; i < 5 && appeared; i += 1) {
    if (await page.locator('[data-prompt-wizard="true"]').count()) break;
    const opt = card.locator("[data-prompt-option]").first();
    if (await opt.count()) await opt.click().catch(() => {});
    const submit = card.locator("[data-prompt-submit]");
    if ((await submit.count()) && !(await submit.isDisabled())) await submit.click().catch(() => {});
    await page.waitForTimeout(2500);
  }
  check("the AskUserQuestion card appeared", appeared);
  if (!appeared) {
    await page.screenshot({ path: "/tmp/pw-ms2-fail.png" });
    console.log("SHELL TEXT:\n", (await page.locator("[data-product-shell]").innerText().catch(() => "")).slice(0, 1200));
    await app.close();
    process.exit(1);
  }
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/pw-ms2-1-step1.png" });

  // Wizard chrome.
  check("renders as a wizard (multi-step)", await page.locator('[data-prompt-wizard="true"]').count() > 0);
  const dots = page.locator("[data-prompt-step-dot]");
  const dotCount = await dots.count();
  check("shows a step dot per question", dotCount >= 2, `${dotCount} dots`);
  // innerText reflects CSS text-transform (the counter renders "1 OF 3"), so match case-insensitively.
  check("step counter shows position", /\bof\b/i.test(await page.locator("[data-prompt-wizard-head]").innerText().catch(() => "")));
  const back = page.locator("[data-prompt-skip]");
  check("Back is disabled on the first step", await back.isDisabled());
  const primary = page.locator("[data-prompt-submit]");
  check("primary action is 'Next' on a non-final step", /Next/.test(await primary.innerText().catch(() => "")));

  // Record step 1's question text, then advance through every step to the last.
  const step1Text = (await page.locator("[data-prompt-message]").innerText().catch(() => "")).trim();
  for (let i = 0; i < dotCount - 1; i += 1) {
    await primary.click();
    await page.waitForTimeout(200);
  }
  await page.screenshot({ path: "/tmp/pw-ms2-2-last.png" });
  check("Back is enabled after leaving step 1", !(await back.isDisabled()));
  check("primary action is 'Submit' on the final step", /Submit/.test(await primary.innerText().catch(() => "")));

  // Go all the way back to step 1 — the revisit must restore its question + selection.
  for (let i = 0; i < dotCount - 1; i += 1) {
    await back.click();
    await page.waitForTimeout(150);
  }
  const backToStep1 = (await page.locator("[data-prompt-message]").innerText().catch(() => "")).trim();
  check("Back returns to step 1 (same question)", backToStep1 === step1Text, backToStep1);

  // Revise step 1: pick the SECOND option, then jump to the last step via its dot.
  const opts = page.locator("[data-prompt-option]");
  if (await opts.count() > 1) await opts.nth(1).click();
  await page.waitForTimeout(150);
  const revised = (await opts.nth(1).getAttribute("data-selected")) === "true";
  check("an earlier step's answer can be revised", revised);
  await page.screenshot({ path: "/tmp/pw-ms2-3-revised.png" });

  // Jump to the last step via its dot, then submit the whole wizard.
  await dots.nth(dotCount - 1).click();
  await page.waitForTimeout(150);
  const submit = page.locator("[data-prompt-submit]");
  check("Submit is shown on the last step after a dot jump", /Submit/.test(await submit.innerText().catch(() => "")));
  await submit.click();
  await page.waitForTimeout(2500);
  // The single submit clears the card and the turn proceeds (claude got every answer).
  check("submitting the wizard clears the prompt card", await card.count() === 0);
  await page.screenshot({ path: "/tmp/pw-ms2-4-after-submit.png" });

  await app.close();
  console.log(`DONE failures=${failures} dataRoot=${dataRoot}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error("PW ERROR", e); process.exit(1); });
