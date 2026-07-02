#!/usr/bin/env node
// Live verification of the MID-THREAD Launch Option change path — the chip the
// user clicks on a RUNNING thread → thread.setLaunchOptions → composer-queue
// mergeAndApplyLaunchOptions → applySessionConfig → the provider integration's
// buildSessionConfigUpdate → the real structured client.applyConfig → the real
// provider CLI. Drives the REAL backend (createLiveBackendContractMessageAdapter)
// + REAL CLI, so nothing here re-implements the protocol.
//
// Two modes:
//
//   --option <permission|model|reasoning>   (routing, default)
//     Spawn a thread, run one no-tool turn so a live runtime exists, then change
//     ONE option mid-thread and read the `applied` routing signal off the
//     command.completed event. Assert it matches the per-provider live-vs-restart
//     matrix. One option per thread: a restart-required change sets
//     pendingRuntimeRestart, which would contaminate a second option's `applied`.
//
//   --behavioral   (permission only; claude/opencode/codex/qwen)
//     Prove the change actually flips a RUNNING session's approval behavior: turn 1
//     in a prompting mode MUST surface an approval prompt; flip permission to a
//     bypass mode mid-thread; turn 2 doing the same tool MUST NOT prompt and the
//     side effect (a written file) MUST exist.
//
// Usage:
//   node --experimental-strip-types scripts/v2-launch-change-flow.mjs \
//     --agent <claude|codex|opencode|qwen> [--option permission|model|reasoning]
//     [--behavioral] [--timeout-ms 120000]
//
// Run with TIDE_BACKEND_TRACE=1 to also see the `applySessionConfig <agent> keys=…`
// trace (live path fired) and TIDE_DEBUG_STRUCTURED=1 for the raw provider wire.

import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyProductShellBackendEvent,
  createProductShellState,
  createProductShellViewModel,
  selectProductShellChoiceSurfaceRow,
  setProductShellComposerActiveSurface,
  submitProductShellComposerDraft,
  updateProductShellComposerDraft,
} from "../src/desktop/application/domains/product-shell/product-shell.ts";
import { createLiveBackendContractMessageAdapter } from "../src/backend/infrastructure/node/live/live-backend.ts";
import { CONTRACT_VERSION } from "../src/shared/contracts/index.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : dflt;
};
const agent = arg("--agent");
const behavioral = argv.includes("--behavioral");
const option = arg("--option", "permission");
const timeoutMs = Number(arg("--timeout-ms", process.env.TIDE_TIMEOUT_MS ?? 120000));

if (!["claude", "codex", "opencode", "qwen"].includes(agent)) {
  console.error("Usage: --agent <claude|codex|opencode|qwen> [--option permission|model|reasoning] [--behavioral]");
  process.exit(2);
}

// The per-provider live-vs-restart matrix this harness asserts (mirrors each
// integration's buildSessionConfigUpdate).
const EXPECTED = {
  claude: { permission: "live", model: "live", reasoning: "next_turn" },
  codex: { permission: "next_turn", model: "live", reasoning: "live" },
  opencode: { permission: "live", model: "live", reasoning: "live" },
  qwen: { permission: "live", model: "live", reasoning: "live" },
};
// A baseline that differs from the target so the change registers as a changed key.
const BASELINE_PERMISSION = {
  claude: "default",
  codex: "ask-for-approval",
  opencode: "build",
  qwen: "default",
};
const TARGET = {
  claude: { permission: "acceptEdits", model: "claude-sonnet-4-6", reasoning: "high" },
  codex: { permission: "full-access", model: "gpt-5.1-codex-max", reasoning: "high" },
  opencode: { permission: "plan", model: "anthropic/claude-sonnet-4-6", reasoning: "high" },
  qwen: { permission: "plan", model: "qwen3-coder-plus", reasoning: "high" },
};
// A bypass permission that auto-approves shell/edit tools, for the behavioral flip.
const BYPASS_PERMISSION = {
  claude: "bypassPermissions",
  codex: "full-access",
  opencode: "build",
  qwen: "yolo",
};

const appDataRoot = mkdtempSync(path.join(tmpdir(), `tide-launch-change-${agent}-`));
const probeFile = path.join(appDataRoot, `tool-${Date.now()}.txt`);
const log = (o) => console.log(JSON.stringify(o));

let shellState = createProductShellState({ includeFixtureData: false });
const applyEvent = (event) =>
  (shellState = applyProductShellBackendEvent(shellState, { kind: event.kind, payload: event.payload }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const runtimeState = () => createProductShellViewModel(shellState).agentChat.runtimeState;

// Auto-answer (allow) any approval prompt so a turn never hangs; count them.
let prompts = 0;
const answered = new Set();
let answering = Promise.resolve();
const onPrompt = (adapter, event) => {
  if (event.kind !== "prompt.changed" || !event.payload.prompt) return;
  const prompt = event.payload.prompt;
  if (answered.has(prompt.promptId)) return;
  answered.add(prompt.promptId);
  prompts += 1;
  const choices = prompt.choices ?? [];
  const choice = choices.find((c) => c.choiceId === prompt.defaultChoiceId) ?? choices[0];
  log({ phase: "prompt", n: prompts, kind: prompt.kind, message: String(prompt.message).slice(0, 80), chose: choice?.label });
  answering = answering.then(() =>
    adapter
      .handleMessage({
        contractVersion: CONTRACT_VERSION,
        requestId: `answer-${prompt.promptId}`,
        kind: "prompt.answer",
        issuedAt: new Date().toISOString(),
        payload: { threadId: prompt.threadId, promptId: prompt.promptId, choiceId: choice?.choiceId, value: choice?.providerValue },
      })
      .then((events) => events.forEach(applyEvent))
      .catch((e) => log({ phase: "answer-error", error: String(e?.message ?? e) })),
  );
};

const adapter = createLiveBackendContractMessageAdapter({
  appDataRoot,
  env: {
    ...process.env,
    TIDE_APP_DATA_ROOT: appDataRoot,
    TIDE_MCP_ENTRYPOINT: path.join(repoRoot, "out/main/backend-entrypoint.js"),
  },
  onEvent: (event) => {
    applyEvent(event);
    onPrompt(adapter, event);
  },
});

const send = async (kind, payload, requestId) => {
  const events = await adapter.handleMessage({
    contractVersion: CONTRACT_VERSION,
    requestId,
    kind,
    issuedAt: new Date().toISOString(),
    payload,
  });
  events.forEach(applyEvent);
  return events;
};

async function startThread(initialMessage, launchOptions) {
  shellState = setProductShellComposerActiveSurface(shellState, "agent_menu");
  shellState = selectProductShellChoiceSurfaceRow(shellState, "agent_menu", agent).state;
  shellState = updateProductShellComposerDraft(shellState, initialMessage);
  const submitted = submitProductShellComposerDraft(shellState);
  if (submitted.command?.kind !== "thread.start") throw new Error("Product Shell did not emit thread.start.");
  shellState = submitted.state;
  const events = await send(
    "thread.start",
    { ...submitted.command.payload, launchOptions: { ...(submitted.command.payload.launchOptions ?? {}), ...launchOptions } },
    "start",
  );
  const started = events.find((e) => e.kind === "thread.started");
  if (!started) throw new Error("Live Backend did not emit thread.started.");
  return started.payload.thread.threadId;
}

async function waitForSettle(threadId, label) {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    await sleep(1500);
    const h = await send("thread.hydrate", { threadId }, `hydrate-${label}-${Date.now()}`);
    h.forEach(applyEvent);
    const st = runtimeState();
    if (st !== last) {
      log({ phase: "state", label, runtimeState: st });
      last = st;
    }
    if (st === "idle" || st === "error") return st;
  }
  return "timeout";
}

async function setLaunchOption(threadId, patch, requestId) {
  const events = await send("thread.setLaunchOptions", { threadId, launchOptions: patch }, requestId);
  const completed = events.find((e) => e.kind === "command.completed");
  return completed?.payload?.result?.applied ?? "(none)";
}

let exitCode = 0;
let threadId = null;
try {
  if (behavioral) {
    if (option !== "permission") throw new Error("--behavioral only applies to --option permission");
    const bypass = BYPASS_PERMISSION[agent];
    if (!bypass) throw new Error(`No bypass permission defined for ${agent}`);
    // Turn 1 in a prompting mode: a tool that needs approval MUST prompt.
    const toolTask =
      agent === "claude"
        ? `Use the Write tool to create the file ${probeFile} with the content 'one'. If permission is denied do NOT retry; reply: denied.`
        : `Run the shell command \`touch ${probeFile}\` (it needs approval). Then reply exactly DONE.`;
    threadId = await startThread(toolTask, { permission: BASELINE_PERMISSION[agent] });
    log({ phase: "started", agent, threadId, mode: "behavioral", permission: BASELINE_PERMISSION[agent] });
    const st1 = await waitForSettle(threadId, "turn1");
    const promptsTurn1 = prompts;
    log({ phase: "turn1", settled: st1, promptsTurn1 });

    // Flip permission to bypass mid-thread.
    const applied = await setLaunchOption(threadId, { permission: bypass }, "flip-permission");
    log({ phase: "flip", to: bypass, applied });

    // Turn 2: the same tool MUST run with no prompt now.
    prompts = 0;
    await send("composer.sendInput", { threadId, input: toolTask }, "turn2");
    const st2 = await waitForSettle(threadId, "turn2");
    await answering;
    const promptsTurn2 = prompts;
    const wrote = existsSync(probeFile);
    log({ phase: "turn2", settled: st2, promptsTurn2, fileWritten: wrote });

    if (promptsTurn1 === 0) {
      log({ phase: "FAIL", reason: `turn 1 (${BASELINE_PERMISSION[agent]}) surfaced no prompt — baseline never asked, test inconclusive` });
      exitCode = 1;
    } else if (promptsTurn2 > 0) {
      log({ phase: "FAIL", reason: `turn 2 still prompted after flip to ${bypass} — permission change did NOT apply to the running session` });
      exitCode = 1;
    } else if (!wrote) {
      log({ phase: "FAIL", reason: "turn 2 did not write the file — tool did not run under the bypass mode" });
      exitCode = 1;
    } else {
      log({ phase: "PASS", agent, proof: `prompted in ${BASELINE_PERMISSION[agent]} (${promptsTurn1}x) → silent in ${bypass} + file written`, applied });
    }
  } else {
    // Routing mode: change ONE option mid-thread, assert the `applied` signal.
    const target = TARGET[agent][option];
    if (target === undefined) throw new Error(`No ${option} target for ${agent}`);
    threadId = await startThread("Reply with the single word READY and nothing else.", {
      permission: BASELINE_PERMISSION[agent],
    });
    log({ phase: "started", agent, threadId, mode: "routing", option });
    const st1 = await waitForSettle(threadId, "turn1");
    log({ phase: "runtime-alive", settled: st1 });
    if (st1 === "timeout") {
      log({ phase: "FAIL", reason: "runtime never settled — could not establish a live session to change" });
      exitCode = 1;
    } else {
      const applied = await setLaunchOption(threadId, { [option]: target }, `change-${option}`);
      const expected = EXPECTED[agent][option];
      log({ phase: "change", option, target, applied, expected });
      if (applied === expected) {
        log({ phase: "PASS", agent, option, applied, note: applied === "live" ? "routed live to the running session" : "routed to a transparent restart at next send" });
      } else {
        log({ phase: "FAIL", reason: `applied=${applied} but matrix expects ${expected}` });
        exitCode = 1;
      }
    }
  }
} catch (error) {
  log({ phase: "ERROR", error: String(error?.stack ?? error?.message ?? error) });
  exitCode = 1;
} finally {
  if (threadId) {
    await send("agentRuntime.stop", { threadId }, "stop").catch(() => {});
  }
  process.exit(exitCode);
}
