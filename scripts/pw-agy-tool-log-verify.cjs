// Auth-safe: verifies ANTIGRAVITY tool calls render as tool log entries via the
// RESTORE path. Crafts an antigravity transcript (PLANNER_RESPONSE tool_calls +
// typed result entry), seeds a thread referencing it, launches the app, opens
// the thread, asserts the tool log renders. Never spawns an agent.
const { _electron } = require("playwright");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const repo = "/Users/eatnug/Workspace/tide";

(async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-agytool-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tide-agytool-home-"));
  const convId = "99999999-aaaa-bbbb-cccc-dddddddddddd";
  const transcriptPath = path.join(
    home,
    ".gemini",
    "antigravity-cli",
    "brain",
    convId,
    ".system_generated",
    "logs",
    "transcript.jsonl",
  );
  fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ step_index: 0, source: "USER_EXPLICIT", type: "USER_INPUT", content: "<USER_REQUEST>\nlist the files\n</USER_REQUEST>" }),
      JSON.stringify({
        step_index: 2,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        tool_calls: [{ name: "list_dir", args: { DirectoryPath: "/tmp", toolSummary: "List directory" } }],
      }),
      JSON.stringify({ step_index: 3, source: "MODEL", type: "LIST_DIRECTORY", content: "README.md\nsrc\n" }),
      JSON.stringify({ step_index: 4, source: "MODEL", type: "PLANNER_RESPONSE", content: "Two entries: README.md and src." }),
    ].join("\n"),
  );

  const ts = "2026-06-01T00:00:00.000Z";
  const record = {
    storageVersion: 1,
    threadId: "thread-agy-tool-log",
    title: "Antigravity tool log thread",
    pinned: false,
    archived: false,
    createdAt: ts,
    updatedAt: ts,
    agentBinding: {
      agentId: "antigravity",
      providerSessionRef: { kind: "antigravity_conversation", value: convId, transcriptPath },
    },
    scope: { kind: "project", projectId: "tide", cwd: repo },
    executionContext: { cwd: repo, branch: "main" },
    lastKnownState: "idle",
    providerSessionRef: {
      agentId: "antigravity",
      kind: "antigravity_conversation",
      value: convId,
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

  const summaryText = await page.locator(".agent-session-tools__summary-text").first().innerText().catch(() => "");
  console.log("tool summary:", JSON.stringify(summaryText));
  await page.screenshot({ path: "/tmp/pw-agy-tool-log.png" });
  await page.locator(".agent-session-tools__summary").first().click();
  await page.waitForTimeout(400);
  const detailCount = await page.locator(".agent-session-turn__tool-body").count();
  const toolNames = await page.locator(".agent-session-turn__tool-name").allInnerTexts();
  console.log("expanded detail entries:", detailCount, "names:", JSON.stringify(toolNames));
  await app.close();
  console.log("AGY TOOL LOG OK?", /command|file|search/i.test(summaryText) && detailCount >= 2 && toolNames.includes("list_dir"));
  console.log("DONE");
})().catch((e) => { console.error("ERR", e); process.exit(1); });
