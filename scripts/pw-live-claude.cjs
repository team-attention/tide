// LIVE agent-loop verification via the CLAUDE provider (NOT codex — never touches
// ~/.codex/auth.json). Seeds a claude-bound thread, opens it, sends ONE read-only
// prompt, and waits for a rendered agent answer block. Proves the same provider-CLI
// runtime / PTY transport / session-block rendering loop that codex uses.
const { _electron } = require("playwright");
const { spawnSync, execSync } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const repo = "/Users/eatnug/Workspace/tide";
const AGENT = process.argv[2] ?? "claude";
// Read-only prompt: explicitly forbid tools/edits so the agent cannot mutate the repo.
const PROMPT =
  "Without using any tools and without editing any files, reply with exactly this token and nothing else: TIDE_LIVE_OK";

(async () => {
  console.log("LIVE agent:", AGENT);
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-live-"));
  const seed = spawnSync("node", [path.join(repo, "scripts/seed-thread.cjs"), dataRoot, AGENT], {
    cwd: repo,
    stdio: "inherit",
  });
  if (seed.status !== 0) throw new Error("seed failed");

  const app = await _electron.launch({
    args: [path.join(repo, "out/main/electron-main.js")],
    env: { ...process.env, TIDE_APP_DATA_ROOT: dataRoot },
  });
  const proc = app.process();
  const logBackend = (buf) => {
    for (const line of buf.toString("utf8").split("\n")) {
      if (/tide-backend|readiness|ready|frame|block|error|claude|spawn|pending|not_ready|throw|Error/i.test(line)) {
        console.log("[main]", line.slice(0, 220));
      }
    }
  };
  proc.stdout?.on("data", logBackend);
  proc.stderr?.on("data", logBackend);
  const page = await app.firstWindow();
  page.on("console", (msg) => {
    const t = msg.text();
    if (/error|readiness|provider|pending|runtime|claude|spawn|fail/i.test(t)) {
      console.log("[renderer]", t.slice(0, 200));
    }
  });
  await page.waitForSelector(".tide-product-shell", { timeout: 20000 });
  await page.waitForTimeout(1000);

  const row = page.locator(".thread-row__main");
  if (await row.count()) {
    await row.first().click();
    await page.waitForTimeout(1200);
  }

  const composer = page.locator('[aria-label="Composer draft"]');
  await composer.first().fill(PROMPT);
  await page.locator(".composer-shell__send").first().click();
  console.log("sent prompt to claude thread; waiting for agent answer...");

  // While running, an Interrupt control should appear (then disappear when done).
  let sawInterrupt = false;
  const interruptWatch = setInterval(async () => {
    if (await page.locator('[aria-label="Interrupt"]').count()) sawInterrupt = true;
  }, 1500);

  // Poll up to 150s for an agent-role block whose text contains our token.
  let answered = false;
  let agentText = "";
  const deadline = Date.now() + 130000;
  while (Date.now() < deadline) {
    const userBlocks = await page.locator('[data-block-role="user"]').count();
    const eventBlocks = await page.locator('[data-block-role="event"]').count();
    const agentBlocks = page.locator('[data-block-role="agent"]');
    const n = await agentBlocks.count();
    const setup = await page.locator('text=/provider setup|not ready|readiness|Trust/i').count();
    if (Math.round((deadline - Date.now()) / 1000) % 10 === 0) {
      console.log(`blocks user=${userBlocks} event=${eventBlocks} agent=${n} setupSurface=${setup}`);
    }
    if (n > 0) {
      agentText = (await agentBlocks.last().innerText()).trim();
      if (agentText.includes("TIDE_LIVE_OK")) {
        answered = true;
        break;
      }
    }
    await page.waitForTimeout(2500);
  }

  clearInterval(interruptWatch);
  await page.screenshot({ path: "/tmp/pw-live-claude.png" });
  console.log("agent answered with token?", answered);
  console.log("last agent block text:", JSON.stringify(agentText.slice(0, 300)));
  const agentCount = await page.locator('[data-block-role="agent"]').count();
  const finalRuntime = await page
    .locator("[data-runtime-state]")
    .first()
    .getAttribute("data-runtime-state")
    .catch(() => null);
  console.log("agent blocks:", agentCount, "(expect 1 for a single turn)");
  console.log("saw Interrupt control while running?", sawInterrupt);
  console.log("runtime-state after answer:", finalRuntime, "(expect idle, not running)");

  // Deep DOM probe: any blocks at all? runtime indicator? chat region text?
  const anyBlocks = await page.locator("[data-block-id]").count();
  const runtimeState = await page
    .locator("[data-runtime-state]")
    .first()
    .getAttribute("data-runtime-state")
    .catch(() => null);
  const chatText = await page
    .locator('[aria-label="Agent Chat"], .agent-chat-shell, .tide-product-shell__stage')
    .first()
    .innerText()
    .catch(() => "");
  console.log("any [data-block-id] count:", anyBlocks);
  console.log("runtime-state attr:", runtimeState);
  console.log("chat region text:", JSON.stringify(chatText.replace(/\s+/g, " ").slice(0, 400)));

  // Provider sanity: which agent process actually ran?
  try {
    const claude = execSync("pgrep -af 'bin/claude' | grep -v grep | wc -l").toString().trim();
    const codex = execSync("pgrep -af 'bin/codex' | grep -v grep | wc -l").toString().trim();
    console.log("during/after run -> claude procs:", claude, "codex procs:", codex);
  } catch {}

  await app.close();
  console.log("DONE dataRoot=", dataRoot);
})().catch((e) => {
  console.error("PW ERROR", e);
  process.exit(1);
});
