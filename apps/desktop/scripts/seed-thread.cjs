// Seeds one persisted Thread (project scope, root = repo) into a data dir, using
// the REAL persistence service. Used by pw-smoke.cjs so the app boots with an
// existing thread we can open + hydrate WITHOUT ever sending a message (no codex).
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const dataRoot = process.argv[2];
const agentId = process.argv[3] ?? "codex";
if (!dataRoot) {
  console.error("usage: node scripts/seed-thread.cjs <dataRoot> [agentId]");
  process.exit(1);
}

const repo = require("path").resolve(__dirname, "..");
const ts = "2026-05-31T00:00:00.000Z";
const record = {
  storageVersion: 1,
  threadId: "thread-seed-filetree",
  title: "Seeded file tree thread",
  pinned: false,
  archived: false,
  createdAt: ts,
  updatedAt: ts,
  agentBinding: { agentId },
  scope: { kind: "project", projectId: "tide", cwd: repo },
  executionContext: { cwd: repo, branch: "main" },
  lastKnownState: "idle",
};

const code = `
import { createThreadPersistenceService } from ${JSON.stringify(path.join(repo, "src/backend/application/services/thread-persistence-service.ts"))};
import { createFileAppStorage } from ${JSON.stringify(path.join(repo, "src/backend/adapters/outbound/app-storage/file-app-storage.ts"))};
const svc = createThreadPersistenceService({ storage: createFileAppStorage({ appDataRoot: ${JSON.stringify(dataRoot)} }) });
const res = await svc.saveThreadMetadata(${JSON.stringify(record)});
if (!res.ok) { console.error("seed failed", res.error); process.exit(1); }
console.log("seeded thread into", ${JSON.stringify(dataRoot)});
`;

const r = spawnSync(
  "node",
  ["--experimental-strip-types", "--input-type=module", "-e", code],
  { cwd: repo, stdio: "inherit" },
);
process.exit(r.status ?? 0);
