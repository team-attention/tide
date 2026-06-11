// Decisive live proof: opens the seeded claude thread, sends a unique-token prompt,
// and if the backend gates on directory-trust, grants trust via the in-app
// provider.trustWorkspace command, then re-sends. Proves the runtime spine end-to-end
// (stream -> token in UI -> fresh transcript -> idle) on a trusted dir.
const { _electron } = require("playwright");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const repo = path.resolve(__dirname, "..");
const TOKEN = `TIDE_LIVE_${Date.now().toString(36).toUpperCase()}`;
const PROMPT = `Without using any tools and without editing any files, reply with exactly this token and nothing else: ${TOKEN}`;
const claudeDir = path.join(os.homedir(), ".claude", "projects", "-Users-eatnug-Workspace-tide");

let preexisting = new Set();
function freshTranscriptsWithToken() {
  const hits = [];
  try {
    for (const f of fs.readdirSync(claudeDir)) {
      if (!f.endsWith(".jsonl") || preexisting.has(f)) continue;
      if (fs.readFileSync(path.join(claudeDir, f), "utf8").includes(TOKEN)) hits.push(f);
    }
  } catch {}
  return hits;
}

(async () => {
  console.log("token:", TOKEN);
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-trust-"));
  if (spawnSync("node", [path.join(repo, "scripts/seed-thread.cjs"), dataRoot, "claude"], { cwd: repo, stdio: "inherit" }).status !== 0) {
    throw new Error("seed failed");
  }
  try { preexisting = new Set(fs.readdirSync(claudeDir).filter((f) => f.endsWith(".jsonl"))); } catch {}

  const app = await _electron.launch({
    args: [path.join(repo, "out/main/electron-main.js")],
    env: { ...process.env, TIDE_APP_DATA_ROOT: dataRoot },
  });
  const page = await app.firstWindow();
  await page.waitForSelector(".tide-product-shell", { timeout: 20000 });
  await page.waitForFunction(() => (document.body.innerText || "").includes("Seeded file tree thread"), { timeout: 15000 });
  await page.locator(".thread-row__main").first().click();
  await page.waitForFunction(() => document.querySelector('[placeholder*="follow-up"]') !== null, { timeout: 15000 });

  // Direct, deterministic drive through the real window.tide bridge.
  const result = await page.evaluate(async ({ token, prompt }) => {
    const tide = window.tide;
    const threadId = "thread-seed-filetree";
    const log = [];
    const send = async (kind, payload) => {
      const events = await tide.sendBackendCommand({
        contractVersion: 1, requestId: `t-${Date.now()}-${Math.random()}`, kind,
        issuedAt: new Date().toISOString(), payload,
      });
      log.push({ kind, eventKinds: events.map((e) => e.kind), events });
      return events;
    };
    // 1) first send — expect a directory_trust_required blocker
    const first = await send("composer.sendInput", { threadId, input: prompt });
    const blocked = first.some((e) => e.kind === "providerReadiness.changed"
      && (e.payload?.readiness?.blockers ?? []).some((b) => b.kind === "directory_trust_required"));
    // 2) grant trust
    if (blocked) await send("provider.trustWorkspace", { threadId });
    // 3) re-send the prompt now that the dir is trusted
    if (blocked) await send("composer.sendInput", { threadId, input: prompt });
    return { blocked, log };
  }, { token: TOKEN, prompt: PROMPT });

  console.log(">>> blocked on trust first?", result.blocked);
  for (const step of result.log) console.log("  cmd", step.kind, "->", JSON.stringify(step.eventKinds));

  // Watch for the live turn to land.
  let tokenInUi = false, fresh = false, last = null;
  const states = new Set();
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const rs = await page.locator("[data-runtime-state]").first().getAttribute("data-runtime-state").catch(() => null);
    if (rs) { states.add(rs); if (rs !== last) { console.log("  runtime ->", rs); last = rs; } }
    const agent = page.locator('[data-block-role="agent"]');
    if (await agent.count()) { const t = (await agent.last().innerText()).trim(); if (t.includes(TOKEN)) tokenInUi = true; }
    if (freshTranscriptsWithToken().length > 0) fresh = true;
    if (tokenInUi && fresh) break;
    await page.waitForTimeout(2000);
  }

  await page.screenshot({ path: "/tmp/pw-live-claude-trust.png" });
  console.log("--- RESULT ---");
  console.log("token rendered in UI?", tokenInUi);
  console.log("FRESH transcript with token?", fresh, JSON.stringify(freshTranscriptsWithToken()));
  console.log("runtime states:", JSON.stringify([...states]));
  await app.close();
  console.log("DONE dataRoot=", dataRoot);
})().catch((e) => { console.error("PW ERROR", e); process.exit(1); });
