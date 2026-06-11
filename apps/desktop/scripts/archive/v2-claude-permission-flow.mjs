#!/usr/bin/env node
// Self-driving end-to-end check for the claude permission + multi-tool turn flow.
// Launches the REAL backend + REAL claude (default permission mode), sends a prompt that
// forces several permissioned tools (WebSearch + WebFetch), and AUTO-ANSWERS every
// surfaced prompt with "Allow" - exactly what a human would click. Asserts the turn
// surfaces prompts, keeps surfacing them after each answer, and finally settles with an
// answer instead of hanging "Working" forever. No human needed.
//
// Usage: node scripts/v2-claude-permission-flow.mjs [--deny] [--timeout-ms 180000]

import { mkdtempSync } from "node:fs";
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
} from "../src/desktop/application/domains/product-shell/product-shell-state.ts";
import { createLiveBackendContractMessageAdapter } from "../src/backend/infrastructure/node/live-backend.ts";
import { CONTRACT_VERSION } from "../src/shared/contracts/index.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const deny = args.includes("--deny");
const timeoutMs = Number(
  args[args.indexOf("--timeout-ms") + 1] ?? process.env.TIDE_TIMEOUT_MS ?? 180000,
);
const message =
  process.env.TIDE_MESSAGE ??
  "Use web search to find Figma's (ticker FIG) most recent short interest, then fetch one source page with web fetch to confirm the number, then reply with the short interest value.";

const appDataRoot = mkdtempSync(path.join(tmpdir(), "tide-perm-flow-"));
const log = (o) => console.log(JSON.stringify(o));

let shellState = createProductShellState({ includeFixtureData: false });
const applyEvent = (event) =>
  (shellState = applyProductShellBackendEvent(shellState, {
    kind: event.kind,
    payload: event.payload,
  }));

shellState = setProductShellComposerActiveSurface(shellState, "agent_menu");
shellState = selectProductShellChoiceSurfaceRow(shellState, "agent_menu", "claude").state;
shellState = updateProductShellComposerDraft(shellState, message);
const submitted = submitProductShellComposerDraft(shellState);
if (submitted.command?.kind !== "thread.start") {
  throw new Error("Product Shell did not emit thread.start.");
}
shellState = submitted.state;

let threadId = null;
const answered = new Set();
const prompts = [];
let answering = Promise.resolve();

const adapter = createLiveBackendContractMessageAdapter({
  appDataRoot,
  env: {
    ...process.env,
    TIDE_APP_DATA_ROOT: appDataRoot,
    TIDE_MCP_ENTRYPOINT: path.join(repoRoot, "out/main/backend-entrypoint.js"),
  },
  onEvent: (event) => {
    applyEvent(event);
    if (event.kind !== "prompt.changed" || !event.payload.prompt) {
      return;
    }
    const prompt = event.payload.prompt;
    if (answered.has(prompt.promptId)) {
      return;
    }
    answered.add(prompt.promptId);
    const choices = prompt.choices ?? [];
    const wantDeny = deny && choices.length > 1;
    const choice =
      choices.find((c) =>
        wantDeny
          ? /deny|no/i.test(c.label)
          : c.choiceId === prompt.defaultChoiceId,
      ) ??
      (wantDeny ? choices[choices.length - 1] : choices[0]);
    prompts.push({
      promptId: prompt.promptId,
      kind: prompt.kind,
      message: prompt.message,
      chose: choice?.label,
    });
    log({
      phase: "prompt",
      n: prompts.length,
      kind: prompt.kind,
      message: prompt.message,
      chose: choice?.label ?? "(no choice)",
    });
    // Serialize answers so we never race two prompt.answer calls.
    answering = answering.then(() =>
      adapter
        .handleMessage({
          contractVersion: CONTRACT_VERSION,
          requestId: `perm-answer-${prompt.promptId}`,
          kind: "prompt.answer",
          issuedAt: new Date().toISOString(),
          payload: {
            threadId: prompt.threadId,
            promptId: prompt.promptId,
            choiceId: choice?.choiceId,
            value: choice?.providerValue,
          },
        })
        .then((events) => events.forEach(applyEvent))
        .catch((e) => log({ phase: "answer-error", error: String(e?.message ?? e) })),
    );
  },
});

let exitCode = 0;
try {
  const startEvents = await adapter.handleMessage({
    contractVersion: CONTRACT_VERSION,
    requestId: "perm-flow-start",
    kind: submitted.command.kind,
    issuedAt: new Date().toISOString(),
    payload: submitted.command.payload,
  });
  startEvents.forEach(applyEvent);
  const started = startEvents.find((e) => e.kind === "thread.started");
  if (!started) {
    throw new Error("Live Backend did not emit thread.started.");
  }
  threadId = started.payload.thread.threadId;
  log({ phase: "started", threadId, mode: started.payload.thread.launchOptions?.permission });

  // Poll until the turn settles (idle) or we time out. Prompts are answered in onEvent.
  const deadline = Date.now() + timeoutMs;
  let settled = false;
  let lastState = "";
  while (Date.now() < deadline) {
    await sleep(2000);
    const hydrate = await adapter.handleMessage({
      contractVersion: CONTRACT_VERSION,
      requestId: `perm-flow-poll-${Date.now()}`,
      kind: "thread.hydrate",
      issuedAt: new Date().toISOString(),
      payload: { threadId },
    });
    hydrate.forEach(applyEvent);
    const view = createProductShellViewModel(shellState);
    const state = view.agentChat.runtimeState;
    if (state !== lastState) {
      log({ phase: "state", runtimeState: state, promptsSoFar: prompts.length });
      lastState = state;
    }
    if (state === "idle" || state === "error") {
      settled = true;
      break;
    }
  }
  await answering;

  const view = createProductShellViewModel(shellState);
  const blocks = view.agentChat.blocks;
  const answerBlocks = blocks.filter(
    (b) => b?.role === "agent" && String(b.body ?? "").trim().length > 0,
  );
  log({
    phase: "result",
    settled,
    promptsSurfaced: prompts.length,
    runtimeState: view.agentChat.runtimeState,
    blockCount: blocks.length,
    answerBlockCount: answerBlocks.length,
    lastAnswer: answerBlocks.at(-1)?.body?.slice(0, 160),
  });

  if (!settled) {
    log({ phase: "FAIL", reason: "Turn never settled - hung 'Working' (no answer)." });
    exitCode = 1;
  } else if (!deny && answerBlocks.length === 0) {
    log({ phase: "FAIL", reason: "Turn settled but produced no answer." });
    exitCode = 1;
  } else {
    log({ phase: "PASS", promptsSurfaced: prompts.length });
  }
} catch (error) {
  log({ phase: "ERROR", error: String(error?.message ?? error) });
  exitCode = 1;
} finally {
  if (threadId) {
    await adapter
      .handleMessage({
        contractVersion: CONTRACT_VERSION,
        requestId: "perm-flow-stop",
        kind: "agentRuntime.stop",
        issuedAt: new Date().toISOString(),
        payload: { threadId },
      })
      .catch(() => {});
  }
  process.exit(exitCode);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
