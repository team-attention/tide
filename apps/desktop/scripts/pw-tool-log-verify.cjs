// Auth-safe: verifies provider tool calls render as tool log entries via the
// RESTORE path. Crafts a claude transcript with tool_use/tool_result, seeds a
// thread that references it, launches the app, opens the thread, and asserts the
// tool log entries render. Never spawns an agent (the conversation is rebuilt
// from the on-disk transcript).
const { _electron } = require("playwright");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const repo = "/Users/eatnug/Workspace/tide";

(async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-toollog-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tide-toollog-home-"));
  const transcriptPath = path.join(
    home,
    ".claude",
    "projects",
    "-Users-eatnug-Workspace-tide",
    "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl",
  );
  fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "user", message: { role: "user", content: "list the files" } }),
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "I'll list the files now." },
            { type: "tool_use", id: "toolu_777", name: "Bash", input: { command: "ls -la" } },
          ],
        },
      }),
      JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "toolu_777", content: "total 0\nREADME.md\n" }],
        },
      }),
      JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "There is one file: README.md." }] },
      }),
    ].join("\n"),
  );

  // Seed a thread whose provider session reference points at that transcript.
  const ts = "2026-06-01T00:00:00.000Z";
  const record = {
    storageVersion: 1,
    threadId: "thread-tool-log",
    title: "Tool log thread",
    pinned: false,
    archived: false,
    createdAt: ts,
    updatedAt: ts,
    agentBinding: {
      agentId: "claude",
      providerSessionRef: {
        kind: "claude_transcript",
        value: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        transcriptPath,
      },
    },
    scope: { kind: "project", projectId: "tide", cwd: repo },
    executionContext: { cwd: repo, branch: "main" },
    lastKnownState: "idle",
    // Top-level ref is what the restore/rebuild path reads.
    providerSessionRef: {
      agentId: "claude",
      kind: "claude_transcript",
      value: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      transcriptPath,
      observedAt: ts,
    },
  };
  const seed = `
import { createThreadPersistenceService } from ${JSON.stringify(path.join(repo, "src/backend/application/services/thread-persistence-service.ts"))};
import { createFileAppStorage } from ${JSON.stringify(path.join(repo, "src/backend/adapters/outbound/app-storage/file-app-storage.ts"))};
const svc = createThreadPersistenceService({ storage: createFileAppStorage({ appDataRoot: ${JSON.stringify(dataRoot)} }) });
const res = await svc.saveThreadMetadata(${JSON.stringify(record)});
if (!res.ok) { console.error("seed failed", res.error); process.exit(1); }
console.log("seeded");
`;
  const s = spawnSync("node", ["--experimental-strip-types", "--input-type=module", "-e", seed], {
    cwd: repo,
    stdio: "inherit",
  });
  if ((s.status ?? 0) !== 0) process.exit(1);

  const app = await _electron.launch({
    args: [path.join(repo, "out/main/electron-main.js")],
    env: { ...process.env, TIDE_APP_DATA_ROOT: dataRoot, HOME: home },
  });
  const page = await app.firstWindow();
  await page.waitForSelector(".tide-product-shell", { timeout: 20000 });
  await page.waitForTimeout(1200);
  await page.locator(".thread-row__main").first().click();
  await page.waitForTimeout(1500);

  // Codex-style: tool calls collapse into one muted summary row.
  const summaryText = await page.locator(".agent-session-tools__summary-text").first().innerText().catch(() => "");
  console.log("tool summary:", JSON.stringify(summaryText));
  await page.screenshot({ path: "/tmp/pw-tool-log.png" });

  // Expanding reveals the per-tool detail.
  await page.locator(".agent-session-tools__summary").first().click();
  await page.waitForTimeout(400);
  const detailCount = await page.locator(".agent-session-turn__tool-body").count();
  const toolNames = await page.locator(".agent-session-turn__tool-name").allInnerTexts();
  console.log("expanded detail entries:", detailCount, "names:", JSON.stringify(toolNames));
  await page.screenshot({ path: "/tmp/pw-tool-log-expanded.png" });
  await app.close();
  console.log("TOOL LOG OK?", /command|file|search/i.test(summaryText) && detailCount >= 2 && toolNames.includes("Bash"));
  console.log("DONE");
})().catch((e) => { console.error("ERR", e); process.exit(1); });
