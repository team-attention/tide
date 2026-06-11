#!/usr/bin/env node
// Verifies token-by-token streaming: during a turn the agent-message block must
// upsert MANY times with a GROWING body (same blockId), then finalize to status
// "complete" exactly once — never duplicated. Real backend + real CLI.
//   node scripts/v2-streaming-check.mjs --agent claude|codex
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLiveBackendContractMessageAdapter } from "../src/backend/infrastructure/node/live-backend.ts";
import { CONTRACT_VERSION } from "../src/shared/contracts/index.ts";

const agent = (() => {
  const i = process.argv.indexOf("--agent");
  return i >= 0 ? process.argv[i + 1] : "claude";
})();
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appDataRoot = mkdtempSync(path.join(tmpdir(), "tide-stream-"));
const log = (o) => console.log(JSON.stringify(o));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cmd = (kind, payload) => ({ contractVersion: CONTRACT_VERSION, requestId: `${kind}-${Math.random().toString(36).slice(2)}`, kind, issuedAt: new Date().toISOString(), payload });

// blockId -> { upserts: number, maxLen: number, grew: boolean, finalComplete: boolean, kind }
const agentBlocks = new Map();
let threadId = null;

const adapter = createLiveBackendContractMessageAdapter({
  appDataRoot,
  env: { ...process.env, TIDE_APP_DATA_ROOT: appDataRoot, TIDE_MCP_ENTRYPOINT: path.join(repoRoot, "out/main/backend-entrypoint.js") },
  onEvent: (event) => {
    if (event.kind !== "agentSessionBlock.upserted") return;
    const b = event.payload.block;
    if (b?.kind !== "agent_message") return;
    const prev = agentBlocks.get(b.blockId) ?? { upserts: 0, maxLen: 0, grew: false, finalComplete: false };
    const len = (b.body ?? "").length;
    prev.upserts += 1;
    if (len > prev.maxLen) { if (prev.maxLen > 0) prev.grew = true; prev.maxLen = len; }
    if (b.status === "complete") prev.finalComplete = true;
    agentBlocks.set(b.blockId, prev);
  },
});

try {
  const started = await adapter.handleMessage(cmd("thread.start", {
    initialMessage: "Write a short haiku about the ocean. Just the haiku, three lines.",
    agentBinding: { agentId: agent, runtimeSource: { kind: "provider_cli", integrationId: agent } },
  }));
  threadId = started.find((e) => e.kind === "thread.started")?.payload.thread.threadId;
  log({ phase: "started", agent, threadId });
  const deadline = Date.now() + 90000;
  let settled = false;
  while (Date.now() < deadline) {
    await sleep(1000);
    const h = await adapter.handleMessage(cmd("thread.hydrate", { threadId }));
    const hp = h.find((e) => e.kind === "thread.hydrated")?.payload;
    const st = hp?.runtimeState ?? hp?.thread?.runtimeState;
    if (st === "idle" || st === "error") { settled = true; break; }
  }
  // Streaming verdict.
  const blocks = [...agentBlocks.values()];
  const streamed = blocks.find((b) => b.upserts >= 3 && b.grew);
  const finalized = blocks.filter((b) => b.finalComplete);
  log({ phase: "blocks", count: blocks.length, detail: blocks.map((b) => ({ upserts: b.upserts, maxLen: b.maxLen, grew: b.grew, finalComplete: b.finalComplete })) });
  const pass = settled && streamed !== undefined && finalized.length === 1;
  log({ phase: pass ? "PASS" : "FAIL", agent, settled, streamed: streamed !== undefined, finalizedAgentBlocks: finalized.length });
  process.exitCode = pass ? 0 : 1;
} catch (e) {
  log({ phase: "ERROR", error: String(e?.stack ?? e) });
  process.exitCode = 1;
} finally {
  if (threadId) await adapter.handleMessage(cmd("agentRuntime.stop", { threadId })).catch(() => {});
  process.exit(process.exitCode);
}
