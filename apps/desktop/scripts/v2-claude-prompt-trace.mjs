#!/usr/bin/env node
// Traces EVERY backend event during a claude permission turn so we can see if the
// permission card flickers (prompt set -> cleared -> set for the same prompt) or
// if a redundant approval_prompt history block is created alongside the live card.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLiveBackendContractMessageAdapter } from "../src/backend/infrastructure/node/live-backend.ts";
import { CONTRACT_VERSION } from "../src/shared/contracts/index.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appDataRoot = mkdtempSync(path.join(tmpdir(), "tide-trace-"));
const log = (o) => console.log(JSON.stringify(o));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cmd = (kind, payload) => ({ contractVersion: CONTRACT_VERSION, requestId: `${kind}-${Math.random().toString(36).slice(2)}`, kind, issuedAt: new Date().toISOString(), payload });
let t0 = Date.now();
const el = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

let answered = false;
let threadId = null;
const adapter = createLiveBackendContractMessageAdapter({
  appDataRoot,
  env: { ...process.env, TIDE_APP_DATA_ROOT: appDataRoot, TIDE_MCP_ENTRYPOINT: path.join(repoRoot, "out/main/backend-entrypoint.js") },
  onEvent: (event) => {
    if (event.kind === "prompt.changed") {
      const p = event.payload.prompt;
      log({ t: el(), ev: "prompt.changed", prompt: p ? `${p.kind}:${p.message}` : null, promptId: p?.promptId });
      if (p && !answered) {
        answered = true;
        const c = (p.choices ?? [])[0];
        adapter.handleMessage(cmd("prompt.answer", { threadId: p.threadId, promptId: p.promptId, choiceId: c?.choiceId, value: c?.providerValue })).catch(() => {});
        log({ t: el(), ev: "answered", promptId: p.promptId });
      }
    } else if (event.kind === "agentSessionBlock.upserted") {
      const b = event.payload.block;
      log({ t: el(), ev: "block.upserted", kind: b?.kind, body: String(b?.body ?? "").slice(0, 40) });
    } else if (event.kind === "agentRuntime.stateChanged") {
      log({ t: el(), ev: "state", state: event.payload.state });
    }
  },
});

try {
  const startEvents = await adapter.handleMessage(cmd("thread.start", {
    initialMessage: "Use web search to find Figma (FIG) short interest, then reply with the number.",
    agentBinding: { agentId: "claude", runtimeSource: { kind: "provider_cli", integrationId: "claude" } },
  }));
  threadId = startEvents.find((e) => e.kind === "thread.started")?.payload.thread.threadId;
  t0 = Date.now();
  log({ t: "0s", ev: "started", threadId });
  // Run for a window, hydrating to keep polls alive.
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    await sleep(2000);
    const h = await adapter.handleMessage(cmd("thread.hydrate", { threadId }));
    const st = h.find((e) => e.kind === "thread.hydrated")?.payload?.thread?.runtimeState;
    if (st === "idle" || st === "error") { log({ t: el(), ev: "settled", state: st }); break; }
  }
} finally {
  if (threadId) await adapter.handleMessage(cmd("agentRuntime.stop", { threadId })).catch(() => {});
  process.exit(0);
}
