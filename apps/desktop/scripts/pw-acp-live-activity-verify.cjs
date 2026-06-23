// LIVE verification of Working-indicator live activity through the ACP client.
// Launches the BUILT app, selects an ACP-backed provider (Gemini by default, or
// ACP_AGENT=opencode), sends a prompt that asks for plan/tool activity, then polls
// the Working indicator for "X/Y steps" and/or live tool labels.
const { _electron } = require("playwright");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const repo = path.resolve(__dirname, "..");
const requestedAgent = process.argv[2] ?? process.env.ACP_AGENT;
const ACP_AGENT = requestedAgent === "opencode" ? "opencode" : "gemini";
const provider = {
  gemini: {
    label: "Gemini CLI",
    permission: "Bypass permissions",
    dataPrefix: "tide-gemini-acp-liveact-",
    shotPrefix: "pw-gemini-acp-liveact",
  },
  opencode: {
    label: "opencode",
    permission: "Build",
    dataPrefix: "tide-opencode-acp-liveact-",
    shotPrefix: "pw-opencode-acp-liveact",
  },
}[ACP_AGENT];

const TOKEN = `TIDE_ACP_LIVE_ACTIVITY_${ACP_AGENT}_${Date.now()}`;
const PROMPT = [
  "Verification task for Tide UI. Do not edit files.",
  "Use your planning or todo mechanism with exactly 4 steps if one is available.",
  "Then run one slow shell command such as `sleep 8` or an equivalent delay so the UI has time to show a Working indicator.",
  `Finish by replying exactly: ${TOKEN}`,
].join("\n");

const log = (o) => console.log(JSON.stringify(o));

async function clickIfPresent(locator) {
  if ((await locator.count()) === 0) return false;
  await locator.first().click();
  return true;
}

(async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), provider.dataPrefix));
  let app;
  process.on("exit", () => { try { app?.process()?.kill(); } catch {} });
  app = await _electron.launch({
    args: [path.join(repo, "out/main/electron-main.js")],
    env: {
      ...process.env,
      TIDE_APP_DATA_ROOT: dataRoot,
      TIDE_DEBUG_STRUCTURED: "1",
    },
  });
  const page = await app.firstWindow();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e.message).slice(0, 200)));
  const shot = (label) => page.screenshot({ path: `/tmp/${provider.shotPrefix}-${label}.png` });

  await page.waitForSelector(".tide-product-shell", { timeout: 20000 });
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    window.__tideAcpLiveEvents = [];
    window.tide?.onBackendEvent?.((event) => {
      if (event.kind === "agentRuntime.activityChanged" || event.kind === "agentRuntime.stateChanged") {
        window.__tideAcpLiveEvents.push({
          kind: event.kind,
          payload: event.payload,
          at: Date.now(),
        });
      }
    });
  });

  await page.locator('.composer-shell__context-chip[data-context-kind="agent"]').first().click();
  await page.waitForSelector('[data-choice-surface="agent_menu"]', { timeout: 5000 });
  const providerRow = page
    .locator('[data-choice-surface="agent_menu"] .choice-surface__row', { hasText: provider.label })
    .first();
  const providerClass = await providerRow.getAttribute("class").catch(() => "");
  log({ phase: "provider_row", agent: ACP_AGENT, label: provider.label, className: providerClass });
  await providerRow.click();
  await page.waitForTimeout(500);

  const permissionButton = page.locator('[aria-label="Permission"]').first();
  if ((await permissionButton.count()) > 0) {
    await permissionButton.click();
    await page.locator('[data-choice-surface="permission_menu"]').waitFor({ timeout: 5000 });
    const permissionRow = page
      .locator('[data-choice-surface="permission_menu"] .choice-surface__row', { hasText: provider.permission })
      .first();
    if ((await permissionRow.count()) > 0) {
      await permissionRow.click();
      log({ phase: "permission", label: provider.permission });
    } else {
      await page.keyboard.press("Escape");
      log({ phase: "permission_missing", label: provider.permission });
    }
    await page.waitForTimeout(300);
  }

  await page.locator('[aria-label="Composer draft"]').first().fill(PROMPT);
  await page.locator(".composer-shell__send").first().click();
  log({ phase: "sent", agent: ACP_AGENT, token: TOKEN, dataRoot });

  // Fresh roots can gate on provider trust/readiness; grant trust when offered.
  await page.waitForTimeout(1500);
  const trust = page.locator('.choice-surface__row, button', { hasText: /Trust this folder/i });
  if (await clickIfPresent(trust)) {
    log({ phase: "trusted_folder" });
    await page.waitForTimeout(800);
    const draft = page.locator('[aria-label="Composer draft"]').first();
    if ((await draft.inputValue().catch(() => "")).trim().length > 0) {
      await page.locator(".composer-shell__send").first().click();
      log({ phase: "resent" });
    }
  }

  const seen = [];
  let sawPlan = false;
  let sawTool = false;
  let cleared = false;
  let agentTextHasToken = false;
  let readinessText = null;
  let promptCardText = null;
  let lastShape = "";
  const deadline = Date.now() + 180000;
  const t0 = Date.now();
  while (Date.now() < deadline) {
    await page.waitForTimeout(1000);
    const at = Math.round((Date.now() - t0) / 1000);
    const snap = await page.evaluate((token) => {
      const q = (s) => document.querySelectorAll(s).length;
      const workingText = document.querySelector(".agent-session-working__text")?.textContent?.trim() ?? null;
      const transcriptText = document.querySelector('[aria-label="Agent Session"]')?.textContent ?? "";
      const agentTurns = Array.from(document.querySelectorAll('[data-block-role="agent"]'));
      const agentText = agentTurns.map((node) => node.textContent ?? "").join("\n");
      const toolBlocks = Array.from(document.querySelectorAll('[data-block-role="tool"], .tool-activity, .agent-session-turn--tool'));
      const readiness = document.querySelector('[data-choice-surface="provider_readiness"], .provider-readiness')?.textContent?.trim().replace(/\s+/g, " ").slice(0, 500) ?? null;
      const promptCard = document.querySelector('[data-prompt-kind], .agent-prompt-card')?.textContent?.trim().replace(/\s+/g, " ").slice(0, 500) ?? null;
      const liveEvents = Array.isArray(window.__tideAcpLiveEvents) ? window.__tideAcpLiveEvents.slice(-5) : [];
      return {
        workingText,
        workingTurn: q(".agent-session-turn--working"),
        toolBlocks: toolBlocks.length,
        toolText: toolBlocks.map((node) => (node.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 120)).slice(-3),
        agentTurns: agentTurns.length,
        lastAgentStatus: agentTurns.at(-1)?.getAttribute("data-block-status") ?? null,
        readiness,
        promptCard,
        liveEvents,
        transcriptTokenPresent: transcriptText.includes(token),
        agentTokenPresent: agentText.includes(token),
      };
    }, TOKEN).catch(() => null);
    if (snap === null) continue;
    if (snap.readiness !== null) readinessText = snap.readiness;
    if (snap.promptCard !== null) promptCardText = snap.promptCard;
    const text = snap.workingText;
    if (text && (seen.length === 0 || seen[seen.length - 1].text !== text)) {
      seen.push({ text, at });
      log({ phase: "indicator", at, text });
      if (/\b\d+\s*\/\s*\d+\s+steps\b/i.test(text)) {
        sawPlan = true;
        await shot("plan");
      }
      if (/tool|bash|shell|command|exec|sleep|read|write/i.test(text)) {
        sawTool = true;
        await shot("tool");
      }
    }
    const shape = `${snap.workingText}|${snap.workingTurn}|${snap.toolBlocks}|${snap.lastAgentStatus}|${snap.readiness ?? ""}|${snap.promptCard ?? ""}|${snap.agentTokenPresent}`;
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
  log({
    phase: "summary",
    agent: ACP_AGENT,
    sawPlan,
    sawTool,
    cleared,
    agentTextHasToken,
    readinessText,
    promptCardText,
    distinctTexts: seen.length,
    pageErrors,
  });
  log({
    phase: ok ? "PASS" : "FAIL",
    detail: ok
      ? `${provider.label} ACP live activity shown and cleared at turn end`
      : `${provider.label} ACP live activity was not fully observed`,
  });
  await app.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  log({ phase: "error", agent: ACP_AGENT, message: String(e).slice(0, 500) });
  process.exit(1);
});
