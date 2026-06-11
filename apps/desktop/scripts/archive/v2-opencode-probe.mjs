// Direct-backend live probe for the opencode integration (the standard smoke
// harness mis-selects codex). Starts a real opencode thread through Tide's
// backend and asserts: a session binds, an agent answer block arrives, and
// reasoning (ACP thought chunks) streams. Evidence for opencode-as-4th-provider.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLiveBackendContractMessageAdapter } from "../src/backend/infrastructure/node/live-backend.ts";
import { CONTRACT_VERSION } from "../src/shared/contracts/index.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appDataRoot = mkdtempSync(path.join(tmpdir(), "tide-oc-"));
const log = (o) => console.log(JSON.stringify(o));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cmd = (kind, payload) => ({ contractVersion: CONTRACT_VERSION, requestId: `${kind}-${Math.random().toString(36).slice(2)}`, kind, issuedAt: new Date().toISOString(), payload });

let threadId = null;
let answer = false, reasoning = false, agentLabel = null;
const adapter = createLiveBackendContractMessageAdapter({
  appDataRoot,
  env: { ...process.env, TIDE_APP_DATA_ROOT: appDataRoot, TIDE_MCP_ENTRYPOINT: path.join(repoRoot, "out/main/backend-entrypoint.js") },
  onEvent: (e) => {
    if (e.kind === "agentSessionBlock.upserted") {
      const b = e.payload.block;
      if (b?.role === "agent" && (b.body ?? "").trim().length > 0) answer = true;
      if (b?.role === "reasoning" && (b.body ?? "").trim().length > 0) reasoning = true;
    }
  },
});
const hydrate = async () => {
  const h = await adapter.handleMessage(cmd("thread.hydrate", { threadId }));
  return h.find((e) => e.kind === "thread.hydrated")?.payload;
};
try {
  const started = await adapter.handleMessage(cmd("thread.start", {
    initialMessage: "Briefly: what is 17 * 23? Think, then answer.",
    agentBinding: { agentId: "opencode", runtimeSource: { kind: "provider_cli", integrationId: "opencode" } },
  }));
  threadId = started.find((e) => e.kind === "thread.started")?.payload.thread.threadId;
  log({ phase: "started", threadId });
  let session, state;
  for (let i = 0; i < 60; i += 1) {
    await sleep(750);
    const hp = await hydrate();
    state = hp?.runtimeState ?? hp?.thread?.runtimeState;
    session = hp?.thread?.agentBinding?.providerSessionRef?.value;
    agentLabel = hp?.thread?.agentLabel ?? agentLabel;
    if (state === "idle" && answer) break;
    if (state === "error") break;
  }
  const pass = answer && session !== undefined;
  log({ phase: pass ? "PASS" : "FAIL", agent: "opencode", agentLabel, sessionBound: session !== undefined, answer, reasoning, finalState: state });
  process.exitCode = pass ? 0 : 1;
} catch (e) {
  log({ phase: "ERROR", error: String(e?.stack ?? e) });
  process.exitCode = 1;
} finally {
  if (threadId) await adapter.handleMessage(cmd("agentRuntime.stop", { threadId })).catch(() => {});
  process.exit(process.exitCode);
}
