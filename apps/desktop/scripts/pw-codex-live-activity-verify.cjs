// LIVE verification of Working-indicator live activity using Codex.
// Launches the BUILT app, selects Codex + Full access, sends a prompt that asks
// Codex to maintain a plan and run slow commands, then polls the Working indicator
// for "X/Y steps" (Slice B') and/or live tool labels (Slice A).
const { _electron } = require("playwright");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const repo = path.resolve(__dirname, "..");
const TOKEN = `TIDE_CODEX_LIVE_ACTIVITY_${Date.now()}`;
const PROMPT = [
  "Verification task for Tide UI. Do not edit files.",
  "First, use your plan tool with exactly 4 steps.",
  "Then complete those steps one by one. Include at least one slow shell command like `sleep 8` or an equivalent delay so the UI has time to show a Working indicator.",
  `Finish by replying exactly: ${TOKEN}`,
].join("\n");

const log = (o) => console.log(JSON.stringify(o));

async function clickIfPresent(locator) {
  if ((await locator.count()) === 0) return false;
  await locator.first().click();
  return true;
}

(async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-codex-liveact-"));
  let app;
  process.on("exit", () => { try { app?.process()?.kill(); } catch {} });
  app = await _electron.launch({
    args: [path.join(repo, "out/main/electron-main.js")],
    env: { ...process.env, TIDE_APP_DATA_ROOT: dataRoot },
  });
  const page = await app.firstWindow();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e.message).slice(0, 200)));
  const shot = (label) => page.screenshot({ path: `/tmp/pw-codex-liveact-${label}.png` });

  await page.waitForSelector("[data-product-shell]", { timeout: 20000 });
  await page.waitForTimeout(1000);

  await page.locator('[data-composer-context-chip][data-context-kind="agent"]').first().click();
  await page.waitForSelector('[data-choice-surface="agent_menu"]', { timeout: 5000 });
  await page.locator('[data-choice-surface="agent_menu"] [data-choice-row]', { hasText: "Codex CLI" }).first().click();
  await page.waitForTimeout(300);

  const permissionButton = page.locator('[aria-label="Permission"]').first();
  if ((await permissionButton.count()) > 0) {
    await permissionButton.click();
    await page.locator('[data-choice-surface="permission_menu"]').waitFor({ timeout: 5000 });
    await page.locator('[data-choice-surface="permission_menu"] [data-choice-row]', { hasText: "Full access" }).first().click();
    await page.waitForTimeout(300);
  }

  await page.locator('[aria-label="Composer draft"]').first().fill(PROMPT);
  await page.locator("[data-composer-send]").first().click();
  log({ phase: "sent", token: TOKEN, dataRoot });

  // Fresh roots can gate on provider trust/readiness; grant trust when the app offers it.
  await page.waitForTimeout(1500);
  const trust = page.locator('[data-choice-row], button', { hasText: /Trust this folder/i });
  if (await clickIfPresent(trust)) {
    log({ phase: "trusted_folder" });
    await page.waitForTimeout(800);
    const draft = page.locator('[aria-label="Composer draft"]').first();
    if ((await draft.inputValue().catch(() => "")).trim().length > 0) {
      await page.locator("[data-composer-send]").first().click();
      log({ phase: "resent" });
    }
  }

  const seen = [];
  let sawPlan = false;
  let sawTool = false;
  let cleared = false;
  let agentTextHasToken = false;
  let lastShape = "";
  const deadline = Date.now() + 150000;
  const t0 = Date.now();
  while (Date.now() < deadline) {
    await page.waitForTimeout(1000);
    const at = Math.round((Date.now() - t0) / 1000);
    const snap = await page.evaluate((token) => {
      const q = (s) => document.querySelectorAll(s).length;
      const workingText = document.querySelector("[data-working-text]")?.textContent?.trim() ?? null;
      const transcriptText = document.querySelector('[aria-label="Agent Session"]')?.textContent ?? "";
      const agentTurns = Array.from(document.querySelectorAll('[data-block-role="agent"]'));
      const agentText = agentTurns.map((node) => node.textContent ?? "").join("\n");
      const toolBlocks = Array.from(document.querySelectorAll('[data-block-role="tool"]'));
      const promptCard = document.querySelector('[data-prompt-card]')?.textContent?.slice(0, 300) ?? null;
      return {
        workingText,
        workingTurn: q("[data-working="true"]"),
        toolBlocks: toolBlocks.length,
        toolText: toolBlocks.map((node) => (node.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 120)).slice(-3),
        agentTurns: agentTurns.length,
        lastAgentStatus: agentTurns.at(-1)?.getAttribute("data-block-status") ?? null,
        promptCard,
        transcriptTokenPresent: transcriptText.includes(token),
        agentTokenPresent: agentText.includes(token),
      };
    }, TOKEN).catch(() => null);
    if (snap === null) continue;
    const text = snap.workingText;
    if (text && (seen.length === 0 || seen[seen.length - 1].text !== text)) {
      seen.push({ text, at });
      log({ phase: "indicator", at, text });
      if (/\b\d+\s*\/\s*\d+\s+steps\b/i.test(text)) {
        sawPlan = true;
        await shot("plan");
      }
      if (/tool|bash|shell|command|exec/i.test(text)) {
        sawTool = true;
        await shot("tool");
      }
    }
    const shape = `${snap.workingText}|${snap.workingTurn}|${snap.toolBlocks}|${snap.lastAgentStatus}|${snap.promptCard ? "prompt" : ""}|${snap.agentTokenPresent}`;
    if (shape !== lastShape) {
      lastShape = shape;
      log({ phase: "state", at, ...snap });
    }
    if (snap.agentTokenPresent) {
      agentTextHasToken = true;
    }
    if (!text && snap.agentTurns > 0 && agentTextHasToken) {
      cleared = true;
      log({ phase: "turn_end", at, agentTurns: snap.agentTurns });
      break;
    }
  }
  await shot("final");

  const ok = (sawPlan || sawTool) && cleared && agentTextHasToken;
  log({ phase: "summary", sawPlan, sawTool, cleared, agentTextHasToken, distinctTexts: seen.length, pageErrors });
  log({
    phase: ok ? "PASS" : "FAIL",
    detail: ok
      ? "Codex live activity shown and cleared at turn end"
      : "Codex live activity was not fully observed",
  });
  await app.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  log({ phase: "error", message: String(e).slice(0, 500) });
  process.exit(1);
});
