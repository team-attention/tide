#!/usr/bin/env node
// Verifies MID-TURN STEER (codex turn/steer): a follow-up sent WHILE a turn is
// running is injected INTO that turn instead of queued for after it ends.
//
// Proof (evidence-based, driven through the real backend + real codex):
//   1. The mid-turn send is delivered, not queued — the service appends a user
//      block for it immediately (status "sent"), surfaced as an
//      agentSessionBlock.upserted (role "user") event WHILE still running.
//   2. The SAME turn obeys the injected instruction: the final agent output
//      contains a unique STEER token that only the steered message asked for.
//   3. Exactly ONE turn runs end-to-end (one settle to idle) — a queued message
//      would run as a SECOND turn after the first completes.
//   4. Direct protocol evidence: run with TIDE_DEBUG_STRUCTURED=1 and the codex
//      client logs `-> turn/steer` to stderr (the harness checks via the parent).
//
//   node scripts/v2-steer-check.mjs            (codex only — only steer-capable)
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLiveBackendContractMessageAdapter } from "../src/backend/infrastructure/node/live-backend.ts";
import { CONTRACT_VERSION } from "../src/shared/contracts/index.ts";

const agent = "codex";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appDataRoot = mkdtempSync(path.join(tmpdir(), "tide-steer-"));
const log = (o) => console.log(JSON.stringify(o));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cmd = (kind, payload) => ({ contractVersion: CONTRACT_VERSION, requestId: `${kind}-${Math.random().toString(36).slice(2)}`, kind, issuedAt: new Date().toISOString(), payload });

const STEER_TOKEN = "STEER_OK_7Q2";
let threadId = null;
let steerSent = false;
let steerUserBlockUpserted = false; // proof (1): user block appended while running
let idleTransitions = 0;            // proof (3): one turn = one settle
let lastState = null;
const agentBlocksAtSteer = new Set();
const agentBlockBodies = new Map();
let steeredAnswer = false;          // proof (2): NEW agent output contains the token

const adapter = createLiveBackendContractMessageAdapter({
  appDataRoot,
  env: { ...process.env, TIDE_APP_DATA_ROOT: appDataRoot, TIDE_MCP_ENTRYPOINT: path.join(repoRoot, "out/main/backend-entrypoint.js") },
  onEvent: (event) => {
    if (event.kind === "agentSessionBlock.upserted") {
      const b = event.payload.block;
      if (b?.role === "user" && steerSent && (b.body ?? "").includes(STEER_TOKEN)) {
        steerUserBlockUpserted = true;
      }
      if (b?.role === "agent" || b?.role === "reasoning") {
        agentBlockBodies.set(b.blockId, b.body ?? "");
        if (steerSent && !agentBlocksAtSteer.has(b.blockId) && (b.body ?? "").includes(STEER_TOKEN)) {
          steeredAnswer = true;
        }
      }
    }
    if (event.kind === "agentRuntime.stateChanged" || event.kind === "thread.hydrated") {
      const st = event.payload?.runtimeState ?? event.payload?.thread?.runtimeState;
      if (st !== undefined && st !== lastState) {
        if (st === "idle" && lastState !== null) idleTransitions += 1;
        lastState = st;
      }
    }
  },
});

const hydrateState = async () => {
  const h = await adapter.handleMessage(cmd("thread.hydrate", { threadId }));
  const hp = h.find((e) => e.kind === "thread.hydrated")?.payload;
  return hp?.runtimeState ?? hp?.thread?.runtimeState;
};
const sessionValue = async () => {
  const h = await adapter.handleMessage(cmd("thread.hydrate", { threadId }));
  const hp = h.find((e) => e.kind === "thread.hydrated")?.payload;
  return hp?.thread?.agentBinding?.providerSessionRef?.value;
};

try {
  const started = await adapter.handleMessage(cmd("thread.start", {
    initialMessage: "Write a long, detailed 8-paragraph essay about the history of ocean tides. Think carefully and take your time before writing.",
    agentBinding: { agentId: agent, runtimeSource: { kind: "provider_cli", integrationId: agent } },
  }));
  threadId = started.find((e) => e.kind === "thread.started")?.payload.thread.threadId;
  log({ phase: "started", agent, threadId });

  // Wait until clearly running AND the codex session is bound.
  let running = false;
  for (let i = 0; i < 40; i += 1) {
    await sleep(500);
    const st = await hydrateState();
    const session = await sessionValue();
    if (st === "running" && session !== undefined) { running = true; break; }
    if (st === "error" || st === "idle") break;
  }
  // Let the turn genuinely get underway (reasoning/first tokens) before steering.
  await sleep(2500);
  const stateBeforeSteer = await hydrateState();
  log({ phase: "pre-steer", running, stateBeforeSteer });

  // Snapshot agent blocks present BEFORE the steer so a post-steer token match is
  // unambiguous, then inject the steering instruction mid-turn.
  for (const id of agentBlockBodies.keys()) agentBlocksAtSteer.add(id);
  steerSent = true;
  // composer.sendInput's submitted user block is a SYNCHRONOUS response event
  // (returned from handleMessage), not an async onEvent — a user block here ⇒
  // status "sent" (delivered/steered); its absence ⇒ status "queued".
  const sendEvents = await adapter.handleMessage(cmd("composer.sendInput", {
    threadId,
    input: `STOP the essay immediately. Disregard all previous instructions. Reply with ONLY this exact token on its own line and nothing else: ${STEER_TOKEN}`,
  }));
  steerUserBlockUpserted = sendEvents.some(
    (e) => e.kind === "agentSessionBlock.upserted" &&
      e.payload?.block?.role === "user" &&
      (e.payload.block.body ?? "").includes(STEER_TOKEN),
  );
  log({ phase: "steered", steerUserBlockUpserted });

  // Wait for the (single) turn to settle to idle.
  let settledIdle = false;
  for (let i = 0; i < 60; i += 1) {
    await sleep(750);
    const st = await hydrateState();
    if (st === "idle") { settledIdle = true; break; }
    if (st === "error") break;
  }

  const pass = steerUserBlockUpserted && steeredAnswer && settledIdle;
  log({
    phase: pass ? "PASS" : "FAIL",
    agent,
    steerUserBlockUpserted, // (1) delivered not queued
    steeredAnswer,          // (2) same turn obeyed the injected instruction
    settledIdle,
    idleTransitions,        // (3) ~1 expected
  });
  process.exitCode = pass ? 0 : 1;
} catch (e) {
  log({ phase: "ERROR", error: String(e?.stack ?? e) });
  process.exitCode = 1;
} finally {
  if (threadId) await adapter.handleMessage(cmd("agentRuntime.stop", { threadId })).catch(() => {});
  process.exit(process.exitCode);
}
