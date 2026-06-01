// Auth-safe: verifies the Codex-style "files changed" list renders via the
// RESTORE path. Crafts a claude transcript whose agent edits two files, seeds a
// thread referencing it, opens it, and asserts the files-changed list. No agent.
const { _electron } = require("playwright");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const repo = "/Users/eatnug/Workspace/tide";

(async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tide-fc-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tide-fc-home-"));
  const sid = "bbbbbbbb-cccc-dddd-eeee-ffffffffffff";
  const transcriptPath = path.join(home, ".claude", "projects", "-Users-eatnug-Workspace-tide", `${sid}.jsonl`);
  fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({ type: "user", message: { role: "user", content: "tidy up the docs" } }),
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "I'll update two files." },
            { type: "tool_use", id: "t1", name: "Edit", input: { file_path: "docs_v2/glossary.md", old_string: "a", new_string: "b" } },
            { type: "tool_use", id: "t2", name: "Write", input: { file_path: "docs_v2/README.md", content: "x" } },
          ],
        },
      }),
      JSON.stringify({ type: "user", message: { role: "user", content: [
        { type: "tool_result", tool_use_id: "t1", content: "edited" },
        { type: "tool_result", tool_use_id: "t2", content: "wrote" },
      ] } }),
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Done — updated the glossary and README." }] } }),
    ].join("\n"),
  );

  const ts = "2026-06-01T00:00:00.000Z";
  const ref = { kind: "claude_transcript", value: sid, transcriptPath };
  const record = {
    storageVersion: 1, threadId: "thread-fc", title: "Files changed thread",
    pinned: false, archived: false, createdAt: ts, updatedAt: ts,
    agentBinding: { agentId: "claude", providerSessionRef: ref },
    scope: { kind: "project", projectId: "tide", cwd: repo },
    executionContext: { cwd: repo, branch: "main" }, lastKnownState: "idle",
    providerSessionRef: { agentId: "claude", ...ref, observedAt: ts },
  };
  const seed = `
import { createThreadPersistenceService } from ${JSON.stringify(path.join(repo, "src/backend/application/services/thread-persistence-service.ts"))};
import { createFileAppStorage } from ${JSON.stringify(path.join(repo, "src/backend/adapters/outbound/app-storage/file-app-storage.ts"))};
const svc = createThreadPersistenceService({ storage: createFileAppStorage({ appDataRoot: ${JSON.stringify(dataRoot)} }) });
const res = await svc.saveThreadMetadata(${JSON.stringify(record)});
if (!res.ok) { console.error("seed failed", res.error); process.exit(1); }
console.log("seeded");
`;
  const s = spawnSync("node", ["--experimental-strip-types", "--input-type=module", "-e", seed], { cwd: repo, stdio: "inherit" });
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

  const summary = await page.locator(".agent-session-tools__summary-text").first().innerText().catch(() => "");
  const files = await page.locator(".agent-session-tools__file-name").allInnerTexts();
  console.log("summary:", JSON.stringify(summary), "files:", JSON.stringify(files));
  await page.screenshot({ path: "/tmp/pw-files-changed.png" });
  await app.close();
  console.log("FILES CHANGED OK?", /edited 2 files/i.test(summary) && files.includes("glossary.md") && files.includes("README.md"));
  console.log("DONE");
})().catch((e) => { console.error("ERR", e); process.exit(1); });
