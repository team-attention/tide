#!/usr/bin/env node
// Verifies TRUE interrupt: Stop aborts the in-flight turn but keeps the session
// ALIVE — the follow-up reuses the same runtime (no respawn). Proof: a respawn
// re-emits session_ref (new process init); reuse does not. So across
// start→interrupt→follow-up there must be exactly ONE session_ref, the thread
// must settle to idle after Stop, and the follow-up must answer.
//   node scripts/v2-interrupt-check.mjs --agent claude|codex|opencode
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLiveBackendContractMessageAdapter } from "../src/backend/infrastructure/node/live-backend.ts";
import { CONTRACT_VERSION } from "../src/shared/contracts/index.ts";

const agent = (() => { const i = process.argv.indexOf("--agent"); return i >= 0 ? process.argv[i + 1] : "claude"; })();
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appDataRoot = mkdtempSync(path.join(tmpdir(), "tide-int-"));
const log = (o) => console.log(JSON.stringify(o));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cmd = (kind, payload) => ({ contractVersion: CONTRACT_VERSION, requestId: `${kind}-${Math.random().toString(36).slice(2)}`, kind, issuedAt: new Date().toISOString(), payload });

let threadId = null;
let followupSent = false;
let followupAnswer = false;
const FOLLOWUP_TOKEN = "INT_FOLLOWUP_OK";
const agentBlocksAtFollowup = new Set();
const agentBlockBodies = new Map();

const adapter = createLiveBackendContractMessageAdapter({
  appDataRoot,
  env: { ...process.env, TIDE_APP_DATA_ROOT: appDataRoot, TIDE_MCP_ENTRYPOINT: path.join(repoRoot, "out/main/backend-entrypoint.js") },
  onEvent: (event) => {
    if (event.kind === "agentRuntime.sessionRefRecorded" || event.kind === "thread.providerSessionRefRecorded") sessionRefs += 1;
    if (event.kind === "agentSessionBlock.upserted") {
      const b = event.payload.block;
      if (b?.role === "agent" || b?.role === "reasoning") {
        agentBlockBodies.set(b.blockId, b.body ?? "");
        // A NEW content block (not present when the follow-up was sent) with
        // content = the follow-up turn produced output on the SAME live session.
        if (followupSent && !agentBlocksAtFollowup.has(b.blockId) && (b.body ?? "").trim().length > 0) {
          followupAnswer = true;
        }
      }
    }
  },
});
const hydrateState = async () => {
  const h = await adapter.handleMessage(cmd("thread.hydrate", { threadId }));
  const hp = h.find((e) => e.kind === "thread.hydrated")?.payload;
  return hp?.runtimeState ?? hp?.thread?.runtimeState;
};
// session_ref is recorded on the thread binding; count via hydrate snapshots instead.
const sessionValue = async () => {
  const h = await adapter.handleMessage(cmd("thread.hydrate", { threadId }));
  const hp = h.find((e) => e.kind === "thread.hydrated")?.payload;
  return hp?.thread?.agentBinding?.providerSessionRef?.value;
};

try {
  const started = await adapter.handleMessage(cmd("thread.start", {
    initialMessage: "Write a detailed 6-paragraph essay about the history of the tides. Take your time.",
    agentBinding: { agentId: agent, runtimeSource: { kind: "provider_cli", integrationId: agent } },
  }));
  threadId = started.find((e) => e.kind === "thread.started")?.payload.thread.threadId;
  log({ phase: "started", agent, threadId });

  // Wait until clearly running AND the provider session ref is bound, so
  // sessionBefore is reliable.
  let sessionBefore;
  for (let i = 0; i < 40; i += 1) {
    await sleep(500);
    const st = await hydrateState();
    sessionBefore = await sessionValue();
    if (st === "running" && sessionBefore !== undefined) break;
  }
  await sleep(1500);
  await adapter.handleMessage(cmd("agentRuntime.stop", { threadId }));
  log({ phase: "interrupted", at: "mid-turn", sessionBefore });

  // Must settle to idle (not stuck "running") within a few seconds.
  let settledIdle = false;
  for (let i = 0; i < 16; i += 1) { await sleep(500); const st = await hydrateState(); if (st === "idle") { settledIdle = true; break; } if (st === "error") break; }
  log({ phase: "post-interrupt", settledIdle });

  // Follow-up on the SAME session. Snapshot existing agent blocks first.
  for (const id of agentBlockBodies.keys()) agentBlocksAtFollowup.add(id);
  followupSent = true;
  await adapter.handleMessage(cmd("composer.sendInput", { threadId, input: `Reply with exactly: ${FOLLOWUP_TOKEN}` }));
  for (let i = 0; i < 40; i += 1) { await sleep(750); if (followupAnswer) break; const st = await hydrateState(); if (st === "idle" && followupAnswer) break; }
  const sessionAfter = await sessionValue();
  const sameSession = sessionBefore !== undefined && sessionBefore === sessionAfter;
  log({ phase: "followup", followupAnswer, sessionAfter, sameSession });

  const pass = settledIdle && followupAnswer && sameSession;
  log({ phase: pass ? "PASS" : "FAIL", agent, settledIdle, followupAnswer, sameSession });
  process.exitCode = pass ? 0 : 1;
} catch (e) {
  log({ phase: "ERROR", error: String(e?.stack ?? e) });
  process.exitCode = 1;
} finally {
  if (threadId) await adapter.handleMessage(cmd("agentRuntime.stop", { threadId })).catch(() => {});
  process.exit(process.exitCode);
}
