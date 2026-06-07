// LIVE claude runtime-half verification (auth-safe: never touches ~/.codex/auth.json,
// never spawns codex, leaves Codex.app alone). Boots the built app on a seeded
// CLAUDE thread, WAITS for that thread to be the active follow-up target (avoiding
// the send-before-open race), sends ONE read-only token prompt, and verifies the
// full runtime loop: streaming block, turn-end settle to idle, interrupt control,
// and a real claude transcript written.
const { _electron } = require("playwright");
const { spawnSync, execSync } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const repo = path.resolve(__dirname, "..");
const PROMPT =
  "Without using any tools and without editing any files, reply with exactly this token and nothing else: TIDE_LIVE_OK";

(async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-live2-"));
  const seed = spawnSync("node", [path.join(repo, "scripts/seed-thread.cjs"), dataRoot, "claude"], {
    cwd: repo, stdio: "inherit",
  });
  if (seed.status !== 0) throw new Error("seed failed");
  const beforeTs = Date.now();

  const app = await _electron.launch({
    args: [path.join(repo, "out/main/electron-main.js")],
    env: { ...process.env, TIDE_APP_DATA_ROOT: dataRoot },
  });
  const page = await app.firstWindow();
  await page.waitForSelector(".tide-product-shell", { timeout: 20000 });

  // CRITICAL: wait for the seeded claude thread to be the ACTIVE follow-up target
  // before sending, so we don't fall back to a fresh scratch+codex thread.
  await page.waitForFunction(() => {
    const header = document.body.innerText || "";
    const followUp = document.querySelector('[placeholder*="follow-up"]');
    return header.includes("Seeded file tree thread") && followUp !== null;
  }, { timeout: 15000 });
  console.log("seeded claude thread active (follow-up composer present)");

  const composer = page.locator('[placeholder*="follow-up"]').first();
  await composer.click();
  await composer.fill(PROMPT);
  // Send via Enter (the follow-up composer submits on Enter).
  await composer.press("Enter");
  console.log("sent read-only prompt to CLAUDE thread; watching runtime...");

  let sawInterrupt = false;
  const states = new Set();
  let answered = false;
  let agentText = "";
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (await page.locator('[aria-label="Interrupt"]').count()) sawInterrupt = true;
    const rs = await page.locator("[data-runtime-state]").first().getAttribute("data-runtime-state").catch(() => null);
    if (rs) states.add(rs);
    const agentBlocks = page.locator('[data-block-role="agent"]');
    if (await agentBlocks.count()) {
      agentText = (await agentBlocks.last().innerText()).trim();
      if (agentText.includes("TIDE_LIVE_OK")) { answered = true; break; }
    }
    await page.waitForTimeout(2000);
  }

  await page.screenshot({ path: "/tmp/pw-live-claude2.png" });
  // Give turn-end a moment to settle after the answer.
  await page.waitForTimeout(3000);
  const finalRuntime = await page.locator("[data-runtime-state]").first().getAttribute("data-runtime-state").catch(() => null);
  const agentCount = await page.locator('[data-block-role="agent"]').count();

  console.log("answered with token?", answered);
  console.log("last agent block:", JSON.stringify(agentText.replace(/\s+/g, " ").slice(0, 200)));
  console.log("runtime states seen:", JSON.stringify([...states]));
  console.log("final runtime-state:", finalRuntime, "(want idle)");
  console.log("agent blocks:", agentCount, "(want 1)");
  console.log("saw Interrupt while running?", sawInterrupt);

  // Did a real claude transcript get written since seed?
  let freshTranscripts = 0;
  try {
    const dir = path.join(os.homedir(), ".claude", "projects", "-Users-eatnug-Workspace-tide");
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".jsonl")) continue;
      if (fs.statSync(path.join(dir, f)).mtimeMs >= beforeTs) freshTranscripts += 1;
    }
  } catch {}
  console.log("fresh claude transcripts written since seed:", freshTranscripts);
  try {
    const codex = execSync("pgrep -af 'bin/codex' | grep -v grep | grep -v Codex.app | wc -l").toString().trim();
    console.log("non-Codex.app codex procs spawned by test (want 0):", codex);
  } catch {}

  await app.close();
  console.log("DONE dataRoot=", dataRoot);
})().catch((e) => { console.error("PW ERROR", e); process.exit(1); });
