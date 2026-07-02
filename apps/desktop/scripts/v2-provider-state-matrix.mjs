#!/usr/bin/env node
// Self-driving checks for the provider STATE matrix — the user journeys that are
// not a happy-path answer: CLI not installed, CLI not signed in, directory trust,
// two concurrent threads on one provider, and a follow-up turn into a live TUI.
// Each case drives the real contract surface (the same messages the renderer
// sends) against the real backend; live cases run the real provider CLI.
//
// Usage: node scripts/v2-provider-state-matrix.mjs --case <name> [--agent <id>]
//   notinstalled  (no CLI on PATH)        — asserts not_installed blockers, no spawn
//   notauth       (fresh empty HOME)      — asserts not_authenticated blockers
//   trust         (untrusted project cwd) — asserts directory_trust_required, then
//                                           provider.trustWorkspace unblocks (live claude turn)
//   concurrency   (two opencode threads)  — asserts answers never cross between threads
//   followup      (opencode)              — asserts a second composer turn answers + settles

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CONTRACT_VERSION } from "../src/shared/contracts/index.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const caseName = args[args.indexOf("--case") + 1];
// The live-turn cases (concurrency/followup) run against this agent.
const agentArgIndex = args.indexOf("--agent");
const agent = agentArgIndex >= 0 ? args[agentArgIndex + 1] : "opencode";
const log = (o) => console.log(JSON.stringify(o));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CASES = { notinstalled, notauth, trust, concurrency, followup };
const run = CASES[caseName];
if (run === undefined) {
  console.error("Usage: node scripts/v2-provider-state-matrix.mjs --case <notinstalled|notauth|trust|concurrency|followup>");
  process.exit(2);
}

function makeAdapter(envOverrides = {}, onEvent) {
  // Imported lazily so a case can mutate process.env (PATH masking) first.
  return import("../src/backend/infrastructure/node/live/live-backend.ts").then(
    ({ createLiveBackendContractMessageAdapter }) => {
      const appDataRoot = mkdtempSync(path.join(tmpdir(), `tide-matrix-${caseName}-`));
      return createLiveBackendContractMessageAdapter({
        appDataRoot,
        env: {
          ...process.env,
          TIDE_APP_DATA_ROOT: appDataRoot,
          TIDE_MCP_ENTRYPOINT: path.join(repoRoot, "out/main/backend-entrypoint.js"),
          ...envOverrides,
        },
        onEvent,
      });
    },
  );
}

function command(kind, payload) {
  return {
    contractVersion: CONTRACT_VERSION,
    requestId: `matrix-${kind}-${Math.random().toString(36).slice(2)}`,
    kind,
    issuedAt: new Date().toISOString(),
    payload,
  };
}

function startThreadCommand(agentId, initialMessage, extra = {}) {
  return command("thread.start", {
    initialMessage,
    agentBinding: {
      agentId,
      runtimeSource: { kind: "provider_cli", integrationId: agentId },
    },
    ...extra,
  });
}

function readinessOf(events) {
  return events.filter((e) => e.kind === "providerReadiness.changed").map((e) => e.payload);
}

async function hydrateView(adapter, threadId) {
  const events = await adapter.handleMessage(command("thread.hydrate", { threadId }));
  const hydrated = events.find((e) => e.kind === "thread.hydrated");
  return hydrated?.payload;
}

function answersOf(hydratedPayload) {
  const blocks = hydratedPayload?.blocks ?? [];
  if (process.env.TIDE_MATRIX_DEBUG === "1") {
    log({ phase: "debug-blocks", blocks: blocks.map((b) => ({ kind: b?.kind, role: b?.role, body: String(b?.body ?? "").slice(0, 60) })) });
  }
  return blocks.filter(
    (b) =>
      (b?.kind === "agent_message" || b?.role === "agent") &&
      String(b.body ?? "").trim().length > 0,
  );
}

async function waitForIdle(adapter, threadId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(2000);
    const payload = await hydrateView(adapter, threadId);
    const state = payload?.thread?.runtimeState ?? payload?.runtimeState;
    if (state === "idle" || state === "error") {
      return { settled: true, state, payload };
    }
  }
  return { settled: false };
}

let failures = 0;
const check = (ok, label, detail) => {
  log({ phase: ok ? "ok" : "fail", check: label, ...(detail ?? {}) });
  if (!ok) failures += 1;
};

// ---------------------------------------------------------------- notinstalled
async function notinstalled() {
  // A machine with no coding agent installed: every provider must report a
  // readiness blocker instead of spawning anything or hanging.
  process.env.PATH = "/var/empty";
  const adapter = await makeAdapter();
  for (const agentId of ["claude", "codex", "opencode", "qwen"]) {
    const events = await adapter.handleMessage(
      startThreadCommand(agentId, "hello?"),
    );
    const readiness = readinessOf(events).at(-1);
    check(
      readiness !== undefined && readiness.readiness?.ready === false ||
        readiness?.ready === false,
      `${agentId}_reports_readiness`,
      { readiness },
    );
    const blockers =
      readiness?.readiness?.blockers ?? readiness?.blockers ?? [];
    check(
      blockers.some((b) => b.kind === "not_installed"),
      `${agentId}_blocked_not_installed`,
      { blockers: blockers.map((b) => b.kind) },
    );
    check(
      !events.some((e) => e.kind === "agentRuntime.stateChanged" && e.payload?.state === "running"),
      `${agentId}_did_not_spawn`,
    );
  }
}

// --------------------------------------------------------------------- notauth
async function notauth() {
  // First launch on a machine where the CLIs exist but were never signed in:
  // every provider must report not_authenticated (plus onboarding/trust where
  // applicable) instead of spawning a CLI that dies on a login screen.
  const freshHome = mkdtempSync(path.join(tmpdir(), "tide-matrix-home-"));
  const adapter = await makeAdapter({ HOME: freshHome });
  for (const agentId of ["claude", "codex", "opencode", "qwen"]) {
    const events = await adapter.handleMessage(
      startThreadCommand(agentId, "hello?"),
    );
    const readiness = readinessOf(events).at(-1);
    const blockers =
      readiness?.readiness?.blockers ?? readiness?.blockers ?? [];
    check(
      blockers.some((b) => b.kind === "not_authenticated"),
      `${agentId}_blocked_not_authenticated`,
      { blockers: blockers.map((b) => b.kind) },
    );
  }
}

// ----------------------------------------------------------------------- trust
async function trust() {
  // Starting a thread in a project directory the provider has never trusted:
  // claude/codex must surface directory_trust_required; granting trust through
  // Tide (provider.trustWorkspace — the Trust button) must unblock, and the
  // thread must then run a REAL turn to completion in that directory.
  const projectDir = mkdtempSync(path.join(tmpdir(), "tide-matrix-trust-"));
  const adapter = await makeAdapter();
  const scope = { kind: "project", projectId: "matrix-trust", cwd: projectDir };

  for (const agentId of ["claude", "codex"]) {
    const events = await adapter.handleMessage(
      startThreadCommand(agentId, "hello?", { scope }),
    );
    const readiness = readinessOf(events).at(-1);
    const blockers =
      readiness?.readiness?.blockers ?? readiness?.blockers ?? [];
    check(
      blockers.some((b) => b.kind === "directory_trust_required"),
      `${agentId}_blocked_directory_trust`,
      { blockers: blockers.map((b) => b.kind) },
    );
  }

  // Grant trust the way the Trust button does, then run a real claude turn.
  const token = `TRUST_OK_${Date.now()}`;
  const startEvents = await adapter.handleMessage(
    startThreadCommand("claude", `Reply with exactly: ${token}`, { scope }),
  );
  const started = startEvents.find((e) => e.kind === "thread.started");
  const threadId =
    started?.payload?.thread?.threadId ??
    readinessOf(startEvents).at(-1)?.threadId;
  check(threadId !== undefined, "trust_thread_created", { threadId });
  // The Trust button sends provider.trustWorkspace; the backend re-checks
  // readiness and REPLAYS the pending first message itself (no extra command).
  const trustEvents = await adapter.handleMessage(
    command("provider.trustWorkspace", { threadId }),
  );
  const postTrust = readinessOf(trustEvents).at(-1);
  check(
    !(postTrust?.readiness?.blockers ?? postTrust?.blockers ?? []).some(
      (b) => b.kind === "directory_trust_required",
    ),
    "claude_trust_unblocked_after_grant",
    { postTrust },
  );
  const { settled, payload } = await waitForIdle(adapter, threadId, 120000);
  const answers = answersOf(payload);
  check(settled, "claude_turn_settled_in_trusted_dir");
  check(
    answers.some((b) => b.body.includes(token)),
    "claude_answered_in_trusted_dir",
    { lastAnswer: answers.at(-1)?.body?.slice(0, 80) },
  );
  await adapter.handleMessage(command("agentRuntime.stop", { threadId })).catch(() => {});
}

// ----------------------------------------------------------------- concurrency
async function concurrency() {
  // Two threads on the SAME provider at the same time: each must bind its own
  // session and get its own answer — answers must never cross threads. This was
  // the historic "different threads, identical answer" bug.
  const adapter = await makeAdapter();
  const stamp = Date.now();
  const tokenA = `TOKEN_ALPHA_${stamp}`;
  const tokenB = `TOKEN_BRAVO_${stamp}`;
  const [startA, startB] = await Promise.all([
    adapter.handleMessage(startThreadCommand(agent, `Reply with exactly: ${tokenA}`)),
    adapter.handleMessage(startThreadCommand(agent, `Reply with exactly: ${tokenB}`)),
  ]);
  const threadA = startA.find((e) => e.kind === "thread.started")?.payload.thread.threadId;
  const threadB = startB.find((e) => e.kind === "thread.started")?.payload.thread.threadId;
  check(threadA !== undefined && threadB !== undefined && threadA !== threadB, "two_threads_started", { threadA, threadB });

  const [resultA, resultB] = await Promise.all([
    waitForIdle(adapter, threadA, 180000),
    waitForIdle(adapter, threadB, 180000),
  ]);
  check(resultA.settled && resultB.settled, "both_threads_settled");
  const answersA = answersOf(resultA.payload).map((b) => b.body).join("\n");
  const answersB = answersOf(resultB.payload).map((b) => b.body).join("\n");
  check(answersA.includes(tokenA), "thread_a_got_its_own_answer", { answersA: answersA.slice(0, 120) });
  check(answersB.includes(tokenB), "thread_b_got_its_own_answer", { answersB: answersB.slice(0, 120) });
  check(!answersA.includes(tokenB), "thread_a_not_contaminated_by_b");
  check(!answersB.includes(tokenA), "thread_b_not_contaminated_by_a");
  await adapter.handleMessage(command("agentRuntime.stop", { threadId: threadA })).catch(() => {});
  await adapter.handleMessage(command("agentRuntime.stop", { threadId: threadB })).catch(() => {});
}

// -------------------------------------------------------------------- followup
async function followup() {
  // A second user turn typed into the LIVE interactive TUI (not a fresh spawn):
  // the historic "second turn gets no response" bug class.
  const adapter = await makeAdapter();
  const stamp = Date.now();
  const first = `FIRST_${stamp}`;
  const second = `SECOND_${stamp}`;
  const startEvents = await adapter.handleMessage(
    startThreadCommand(agent, `Reply with exactly: ${first}`),
  );
  const threadId = startEvents.find((e) => e.kind === "thread.started")?.payload.thread.threadId;
  check(threadId !== undefined, "followup_thread_started", { threadId });

  const firstResult = await waitForIdle(adapter, threadId, 120000);
  check(firstResult.settled, "first_turn_settled");
  check(
    answersOf(firstResult.payload).some((b) => b.body.includes(first)),
    "first_turn_answered",
  );

  await adapter.handleMessage(
    command("composer.sendInput", { threadId, input: `Reply with exactly: ${second}` }),
  );
  const secondResult = await waitForIdle(adapter, threadId, 120000);
  check(secondResult.settled, "second_turn_settled");
  const answers = answersOf(secondResult.payload).map((b) => b.body).join("\n");
  check(answers.includes(second), "second_turn_answered", { answers: answers.slice(0, 160) });
  await adapter.handleMessage(command("agentRuntime.stop", { threadId })).catch(() => {});
}

// ------------------------------------------------------------------------ main
try {
  await run();
  if (failures > 0) {
    log({ phase: "FAIL", case: caseName, failures });
    process.exit(1);
  }
  log({ phase: "PASS", case: caseName });
  process.exit(0);
} catch (error) {
  log({ phase: "ERROR", case: caseName, error: String(error?.stack ?? error) });
  process.exit(1);
}
