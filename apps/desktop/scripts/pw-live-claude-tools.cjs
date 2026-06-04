// LIVE agent loop via CLAUDE (never codex). Runs in an ISOLATED temp workspace
// (not the repo) with a READ-ONLY prompt so the agent makes real tool calls
// (list/read) without being able to mutate anything important. Proves the
// Codex-style collapsed tool-activity summary renders live, in motion.
const { _electron } = require("playwright");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const repo = require("path").resolve(__dirname, "..");
const PROMPT =
  "Using your tools, list the top-level files in the current directory and read CLAUDE.md. " +
  "Then reply with ONE sentence describing what this project is. " +
  "Do NOT create, edit, move, or delete any files.";

(async () => {
  // Run in the repo cwd — already trusted by claude (so no workspace-trust
  // readiness blocker), and read-only so nothing is mutated.
  const work = repo;

  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-live-tools-"));
  const ts = "2026-06-01T00:00:00.000Z";
  const record = {
    storageVersion: 1, threadId: "thread-live-tools", title: "Live tools demo",
    pinned: false, archived: false, createdAt: ts, updatedAt: ts,
    agentBinding: { agentId: "claude" },
    scope: { kind: "project", projectId: "tide", cwd: work },
    executionContext: { cwd: work }, lastKnownState: "idle",
  };
  const seed = `
import { createThreadPersistenceService } from ${JSON.stringify(path.join(repo, "src/backend/application/services/thread-persistence-service.ts"))};
import { createFileAppStorage } from ${JSON.stringify(path.join(repo, "src/backend/adapters/outbound/app-storage/file-app-storage.ts"))};
const svc = createThreadPersistenceService({ storage: createFileAppStorage({ appDataRoot: ${JSON.stringify(dataRoot)} }) });
const res = await svc.saveThreadMetadata(${JSON.stringify(record)});
if (!res.ok) { console.error("seed failed", res.error); process.exit(1); }
console.log("seeded; workspace:", ${JSON.stringify(work)});
`;
  if (spawnSync("node", ["--experimental-strip-types", "--input-type=module", "-e", seed], { cwd: repo, stdio: "inherit" }).status !== 0) {
    throw new Error("seed failed");
  }

  const app = await _electron.launch({
    args: [path.join(repo, "out/main/electron-main.js")],
    env: { ...process.env, TIDE_APP_DATA_ROOT: dataRoot },
  });
  const page = await app.firstWindow();
  await page.waitForSelector(".tide-product-shell", { timeout: 20000 });
  await page.waitForTimeout(1000);
  await page.locator(".thread-row__main").first().click();
  await page.waitForTimeout(1200);

  await page.locator('[aria-label="Composer draft"]').first().fill(PROMPT);
  await page.locator(".composer-shell__send").first().click();
  console.log("sent prompt; watching live...");

  let sawTools = false;
  let sawWorking = false;
  let answered = false;
  const deadline = Date.now() + 150000;
  while (Date.now() < deadline) {
    if (await page.locator(".agent-session-tools__summary").count()) sawTools = true;
    if (await page.locator('[data-working="true"]').count()) sawWorking = true;
    const setup = await page.locator("text=/provider setup|not ready|Trust|permission/i").count();
    const agentBlocks = await page.locator('[data-block-role="agent"]').count();
    if (Math.round((deadline - Date.now()) / 1000) % 10 === 0) {
      console.log(`tools=${sawTools} working=${sawWorking} agent=${agentBlocks} setup/prompt=${setup}`);
    }
    // Done when an agent answer block exists AND we are no longer working.
    if (agentBlocks > 0 && !(await page.locator('[data-working="true"]').count())) {
      answered = true;
      break;
    }
    await page.waitForTimeout(2500);
  }

  const summaries = await page.locator(".agent-session-tools__summary-text").allInnerTexts();
  const agentTexts = await page.locator('[data-block-role="agent"] .agent-session-turn__body').allInnerTexts();
  console.log("tool summaries seen:", JSON.stringify(summaries));
  console.log("agent answer:", JSON.stringify(agentTexts.slice(-1)));
  await page.screenshot({ path: "/tmp/pw-live-tools.png" });
  await app.close();
  console.log("LIVE TOOLS OK?", answered && sawTools && summaries.length > 0);
  console.log("DONE");
})().catch((e) => { console.error("ERR", e); process.exit(1); });
