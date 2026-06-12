#!/usr/bin/env node
// Isolates the live report: claude asks WebSearch permission, then (after that is
// answered) WebFetch permission — and the SECOND card never surfaces, hanging the
// turn. Real backend + real claude. Answers ONLY the first prompt, then watches
// whether a SECOND distinct prompt.changed ever arrives within the window.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLiveBackendContractMessageAdapter } from "../src/backend/infrastructure/node/live/live-backend.ts";
import { CONTRACT_VERSION } from "../src/shared/contracts/index.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appDataRoot = mkdtempSync(path.join(tmpdir(), "tide-2nd-perm-"));
const log = (o) => console.log(JSON.stringify(o));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cmd = (kind, payload) => ({
  contractVersion: CONTRACT_VERSION,
  requestId: `${kind}-${Math.random().toString(36).slice(2)}`,
  kind,
  issuedAt: new Date().toISOString(),
  payload,
});

const message =
  "Use web search to find Figma's (FIG) most recent short interest, then use web fetch on one source page to confirm it, then reply with the number.";

let threadId = null;
const promptsSeen = []; // { promptId, message, at }
let answeredFirst = false;
let answering = Promise.resolve();

const adapter = createLiveBackendContractMessageAdapter({
  appDataRoot,
  env: {
    ...process.env,
    TIDE_APP_DATA_ROOT: appDataRoot,
    TIDE_MCP_ENTRYPOINT: path.join(repoRoot, "out/main/backend-entrypoint.js"),
  },
  onEvent: (event) => {
    if (event.kind !== "prompt.changed") return;
    const prompt = event.payload.prompt;
    if (!prompt) {
      log({ phase: "prompt.cleared", at: elapsed() });
      return;
    }
    if (promptsSeen.some((p) => p.promptId === prompt.promptId)) return;
    promptsSeen.push({ promptId: prompt.promptId, message: prompt.message, at: elapsed() });
    log({ phase: "prompt.changed", n: promptsSeen.length, promptId: prompt.promptId, message: prompt.message, at: elapsed() });
    // Answer ONLY the first prompt; leave the second pending to observe surfacing.
    if (!answeredFirst) {
      answeredFirst = true;
      const choice = (prompt.choices ?? [])[0];
      answering = answering.then(() =>
        adapter.handleMessage(cmd("prompt.answer", {
          threadId: prompt.threadId,
          promptId: prompt.promptId,
          choiceId: choice?.choiceId,
          value: choice?.providerValue,
        })).catch((e) => log({ phase: "answer-error", error: String(e?.message ?? e) })),
      );
      log({ phase: "answered-first", promptId: prompt.promptId });
    }
  },
});

let t0 = Date.now();
const elapsed = () => `${Math.round((Date.now() - t0) / 1000)}s`;

try {
  const startEvents = await adapter.handleMessage(cmd("thread.start", {
    initialMessage: message,
    agentBinding: { agentId: "claude", runtimeSource: { kind: "provider_cli", integrationId: "claude" } },
  }));
  threadId = startEvents.find((e) => e.kind === "thread.started")?.payload.thread.threadId;
  t0 = Date.now();
  log({ phase: "started", threadId });

  const deadline = Date.now() + 180000;
  let lastState = "";
  while (Date.now() < deadline) {
    await sleep(2000);
    const h = await adapter.handleMessage(cmd("thread.hydrate", { threadId }));
    const hp = h.find((e) => e.kind === "thread.hydrated")?.payload;
    const st = hp?.thread?.runtimeState ?? hp?.runtimeState;
    if (st !== lastState) { log({ phase: "state", runtimeState: st, prompts: promptsSeen.length, at: elapsed() }); lastState = st; }
    // Stop once we either got the 2nd prompt or settled.
    if (promptsSeen.length >= 2) { log({ phase: "SECOND_PROMPT_OK", at: elapsed() }); break; }
    if (st === "idle" || st === "error") { log({ phase: "settled-without-2nd", at: elapsed() }); break; }
  }
  await answering;
  log({ phase: promptsSeen.length >= 2 ? "PASS" : "FAIL", promptsSeen: promptsSeen.length });
} catch (e) {
  log({ phase: "ERROR", error: String(e?.stack ?? e) });
} finally {
  if (threadId) await adapter.handleMessage(cmd("agentRuntime.stop", { threadId })).catch(() => {});
  process.exit(0);
}
