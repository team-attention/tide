// LIVE claude runtime proof with a UNIQUE token so the result cannot be confused
// with adopted/ambient history. Sends a read-only prompt asking claude to echo a
// run-unique token, then proves a FRESH claude transcript containing that exact
// token was written during this run. Claude-only; never touches codex auth/Codex.app.
const { _electron } = require("playwright");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const repo = path.resolve(__dirname, "..");
const TOKEN = `TIDE_LIVE_${Date.now().toString(36).toUpperCase()}`;
const PROMPT = `Without using any tools and without editing any files, reply with exactly this token and nothing else: ${TOKEN}`;
const claudeDir = path.join(os.homedir(), ".claude", "projects", "-Users-eatnug-Workspace-tide");

// Claude CLI keys transcripts by cwd (the repo), NOT by TIDE_APP_DATA_ROOT, so the
// seeded app AND this driving claude-code session both write here. The token leaks
// into MY session transcript (I print/read it), so a plain dir scan false-positives.
// Discriminate by novelty: only count transcript files that did not exist before the
// app launched — the seeded turn creates a fresh .jsonl; my session file pre-exists.
let preexistingTranscripts = new Set();
function snapshotPreexistingTranscripts() {
  try {
    preexistingTranscripts = new Set(
      fs.readdirSync(claudeDir).filter((f) => f.endsWith(".jsonl")),
    );
  } catch {}
}
function transcriptsWithToken() {
  const hits = [];
  try {
    for (const f of fs.readdirSync(claudeDir)) {
      if (!f.endsWith(".jsonl")) continue;
      if (preexistingTranscripts.has(f)) continue; // skip my own session + history
      const p = path.join(claudeDir, f);
      if (fs.readFileSync(p, "utf8").includes(TOKEN)) hits.push(f);
    }
  } catch {}
  return hits;
}

(async () => {
  console.log("unique token:", TOKEN);
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-live3-"));
  const seed = spawnSync("node", [path.join(repo, "scripts/seed-thread.cjs"), dataRoot, "claude"], {
    cwd: repo, stdio: "inherit",
  });
  if (seed.status !== 0) throw new Error("seed failed");

  snapshotPreexistingTranscripts();
  const app = await _electron.launch({
    args: [path.join(repo, "out/main/electron-main.js")],
    env: { ...process.env, TIDE_APP_DATA_ROOT: dataRoot },
  });
  const page = await app.firstWindow();
  await page.waitForSelector(".tide-product-shell", { timeout: 20000 });
  // Boot lands on the new-thread surface; open the seeded thread by clicking its
  // rail row (the app does not auto-open the last thread).
  await page.waitForFunction(
    () => (document.body.innerText || "").includes("Seeded file tree thread"),
    { timeout: 15000 },
  );
  await page.locator(".thread-row__main").first().click();
  await page.waitForFunction(
    () => document.querySelector('[placeholder*="follow-up"]') !== null,
    { timeout: 15000 },
  );
  console.log("seeded claude thread active");

  const composer = page.locator('[placeholder*="follow-up"]').first();
  await composer.click();
  await composer.fill(PROMPT);
  await composer.press("Enter");
  console.log("sent unique-token prompt; watching...");

  let sawInterrupt = false;
  const states = new Set();
  let tokenInUi = false;
  let freshTranscript = false;
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (await page.locator('[aria-label="Interrupt"]').count()) sawInterrupt = true;
    const rs = await page.locator("[data-runtime-state]").first().getAttribute("data-runtime-state").catch(() => null);
    if (rs) states.add(rs);
    const agent = page.locator('[data-block-role="agent"]');
    if (await agent.count()) {
      const txt = (await agent.last().innerText()).trim();
      if (txt.includes(TOKEN)) tokenInUi = true;
    }
    if (transcriptsWithToken().length > 0) freshTranscript = true;
    if (tokenInUi && freshTranscript) break;
    await page.waitForTimeout(2000);
  }

  await page.screenshot({ path: "/tmp/pw-live-claude3.png" });
  await page.waitForTimeout(2500);
  const finalRuntime = await page.locator("[data-runtime-state]").first().getAttribute("data-runtime-state").catch(() => null);

  console.log("--- RESULT ---");
  console.log("token rendered in UI agent block?", tokenInUi);
  console.log("FRESH claude transcript with unique token written?", freshTranscript, JSON.stringify(transcriptsWithToken()));
  console.log("runtime states seen:", JSON.stringify([...states]));
  console.log("final runtime-state (want idle):", finalRuntime);
  console.log("saw Interrupt while running?", sawInterrupt);

  await app.close();
  console.log("DONE dataRoot=", dataRoot);
})().catch((e) => { console.error("PW ERROR", e); process.exit(1); });
