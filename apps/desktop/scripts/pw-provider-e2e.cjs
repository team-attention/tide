// REAL-APP end-to-end: drives the BUILT Electron app the way a human does —
// click the agent chip, pick the prompting permission mode in the launch-options
// menu, type a tool-forcing prompt, SEND, watch the permission Prompt Card render
// in the real UI, click its real option + Submit buttons, wait for the rendered
// answer block, then send a follow-up turn into the same live thread.
//
// This is the layer the headless harnesses cannot prove: the packaged main
// process, the real renderer, the real prompt-card component, real clicks.
// Screenshots land in /tmp/pw-e2e-<agent>-*.png for eyeballing.
//
// Usage: node scripts/pw-provider-e2e.cjs <claude|gemini|codex>
//   (claude/gemini by default in docs; codex also works but spends codex credits)
const { _electron } = require("playwright");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const repo = path.resolve(__dirname, "..");
const AGENT = process.argv[2] ?? "claude";
const AGENT_LABELS = { claude: "Claude Code", codex: "Codex CLI", gemini: "Gemini CLI" };
const PROMPT_MODE_ROW = {
  claude: "Ask permissions",
  codex: "Ask for approval",
  gemini: "Ask permissions",
};
const stamp = Date.now();
const TOKEN1 = `E2E_FIRST_${stamp}`;
const TOKEN2 = `E2E_SECOND_${stamp}`;
const PROMPT1 = `Run the shell command \`touch /tmp/tide-e2e-${AGENT}-${stamp}.txt\` (it needs approval), then reply exactly ${TOKEN1}`;
const PROMPT2 = `Without using any tools, reply exactly ${TOKEN2}`;

const agentLabel = AGENT_LABELS[AGENT];
if (!agentLabel) {
  console.error("Usage: node scripts/pw-provider-e2e.cjs <claude|gemini|codex>");
  process.exit(2);
}

const log = (o) => console.log(JSON.stringify(o));
const checks = [];
const check = (ok, label, detail) => {
  checks.push(ok);
  log({ phase: ok ? "ok" : "fail", check: label, ...(detail ?? {}) });
};

(async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), `tide-e2e-${AGENT}-`));
  const app = await _electron.launch({
    args: [path.join(repo, "out/main/electron-main.js")],
    env: { ...process.env, TIDE_APP_DATA_ROOT: dataRoot },
  });
  const page = await app.firstWindow();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e.message).slice(0, 200)));
  // Main-process stderr → file, so TIDE_DEBUG_PTY runs are inspectable.
  const stderrLog = `/tmp/pw-e2e-${AGENT}-main-stderr.log`;
  app.process().stderr?.on("data", (chunk) => fs.appendFileSync(stderrLog, chunk));
  const shot = (label) => page.screenshot({ path: `/tmp/pw-e2e-${AGENT}-${label}.png` });

  await page.waitForSelector(".tide-product-shell", { timeout: 20000 });
  await page.waitForTimeout(800);

  // 1. Pick the agent exactly like a user: agent chip -> menu row.
  await page.locator('.composer-shell__context-chip[data-context-kind="agent"]').first().click();
  await page.waitForSelector('[data-choice-surface="agent_menu"]', { timeout: 5000 });
  const agentRow = page.locator('[data-choice-surface="agent_menu"] .choice-surface__row', {
    hasText: agentLabel,
  });
  const agentRowEnabled = (await agentRow.count()) > 0 && !(await agentRow.first().isDisabled());
  check(agentRowEnabled, "agent_selectable_in_menu", { agent: agentLabel });
  await agentRow.first().click();
  await page.waitForTimeout(400);

  // 2. Pick the prompting permission mode via the Permission chip (its own
  //    dedicated affordance in the composer toolbar).
  await page.locator('[aria-label="Permission"]').first().click();
  const surface = page.locator('[data-choice-surface="permission_menu"]');
  await surface.waitFor({ timeout: 5000 });
  const modeRow = surface.locator(".choice-surface__row", { hasText: PROMPT_MODE_ROW[AGENT] });
  const permissionSet = (await modeRow.count()) > 0;
  if (permissionSet) {
    await modeRow.first().click();
  } else {
    await page.keyboard.press("Escape");
  }
  check(permissionSet, "prompting_permission_mode_selected", { mode: PROMPT_MODE_ROW[AGENT] });
  await page.waitForTimeout(300);
  await shot("1-configured");

  // 3. Type the tool-forcing prompt and send.
  await page.locator('[aria-label="Composer draft"]').first().fill(PROMPT1);
  await page.locator(".composer-shell__send").first().click();
  log({ phase: "sent", prompt: PROMPT1 });

  // 4. The permission Prompt Card must render in the REAL UI. Click its real
  //    buttons: keep the default (Allow/Yes) option, press Submit.
  const promptCard = page.locator(".prompt-card");
  let promptSurfaced = false;
  try {
    await promptCard.waitFor({ timeout: 120000 });
    promptSurfaced = true;
  } catch {
    promptSurfaced = false;
  }
  check(promptSurfaced, "permission_prompt_card_rendered");
  if (promptSurfaced) {
    const message = (await promptCard.locator(".prompt-card__message").innerText()).trim();
    const optionLabels = await promptCard
      .locator(".prompt-card__option-label")
      .allInnerTexts();
    log({ phase: "prompt-card", message, options: optionLabels });
    await shot("2-prompt-card");
    // The adapter's default (Allow) must arrive pre-selected.
    const firstOption = promptCard.locator(".prompt-card__option").first();
    const preselected = (await firstOption.getAttribute("data-selected")) === "true";
    check(preselected, "default_choice_preselected");
    if (!preselected) {
      await firstOption.click();
    }
    const submit = promptCard.locator(".prompt-card__submit");
    check(!(await submit.isDisabled()), "prompt_submit_enabled");
    await submit.click();
    log({ phase: "answered", chose: optionLabels[0] });
  }

  // 5. Wait for the rendered answer block carrying TOKEN1, exactly once.
  const sawFirst = await waitForToken(page, TOKEN1, 120000);
  check(sawFirst.found, "first_answer_rendered", sawFirst);
  check(sawFirst.count <= 1, "first_answer_rendered_once", { count: sawFirst.count });
  await shot("3-first-answer");

  // 6. Follow-up turn into the SAME live thread.
  await page.locator('[aria-label="Composer draft"]').first().fill(PROMPT2);
  await page.locator(".composer-shell__send").first().click();
  log({ phase: "sent-followup", prompt: PROMPT2 });
  const sawSecond = await waitForToken(page, TOKEN2, 120000);
  check(sawSecond.found, "followup_answer_rendered", sawSecond);
  await shot("4-followup-answer");

  // 7. The tool actually ran (the file exists) — Allow really allowed.
  const probePath = `/tmp/tide-e2e-${AGENT}-${stamp}.txt`;
  check(fs.existsSync(probePath), "approved_tool_actually_executed", { probePath });

  check(pageErrors.length === 0, "no_renderer_errors", { pageErrors });

  await app.close();
  const failed = checks.filter((c) => !c).length;
  log({ phase: failed === 0 ? "PASS" : "FAIL", agent: AGENT, failedChecks: failed });
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error("PW ERROR", e);
  process.exit(1);
});

async function waitForToken(page, token, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2000);
    const blocks = page.locator(".agent-chat__block, .agent-message, .chat-block");
    // Fall back to whole-shell text scan: block class names may evolve, the
    // TOKEN appearing in the conversation area is the user-visible truth.
    const text = await page.locator(".tide-product-shell").innerText();
    const count = text.split(token).length - 1;
    // The user message block contains the token once; the rendered ANSWER adds
    // at least one more. Keep waiting until it does — returning on the first
    // sighting would race the live turn.
    if (count >= 2) {
      return { found: true, count: count - 1 };
    }
    void blocks;
  }
  return { found: false, count: 0 };
}
