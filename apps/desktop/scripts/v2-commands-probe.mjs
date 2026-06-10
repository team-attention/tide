// Live probe for the slash-command menu: drive a real provider and assert the
// agentRuntime.commandsChanged event fires with the agent's actual commands
// (claude init.slash_commands + skills / codex skills/list). --agent claude|codex
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLiveBackendContractMessageAdapter } from "../src/backend/infrastructure/node/live-backend.ts";
import { CONTRACT_VERSION } from "../src/shared/contracts/index.ts";

const agent = (() => { const i = process.argv.indexOf("--agent"); return i >= 0 ? process.argv[i + 1] : "claude"; })();
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appDataRoot = mkdtempSync(path.join(tmpdir(), "tide-cmd-"));
const log = (o) => console.log(JSON.stringify(o));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cmd = (kind, payload) => ({ contractVersion: CONTRACT_VERSION, requestId: `${kind}-${Math.random().toString(36).slice(2)}`, kind, issuedAt: new Date().toISOString(), payload });

let threadId = null;
let commands = [];
const adapter = createLiveBackendContractMessageAdapter({
  appDataRoot,
  env: { ...process.env, TIDE_APP_DATA_ROOT: appDataRoot, TIDE_MCP_ENTRYPOINT: path.join(repoRoot, "out/main/backend-entrypoint.js") },
  onEvent: (e) => {
    if (e.kind === "agentRuntime.commandsChanged" && Array.isArray(e.payload?.commands)) {
      if (e.payload.commands.length > commands.length) commands = e.payload.commands;
    }
  },
});
try {
  const started = await adapter.handleMessage(cmd("thread.start", {
    initialMessage: "Reply with just: ok",
    agentBinding: { agentId: agent, runtimeSource: { kind: "provider_cli", integrationId: agent } },
  }));
  threadId = started.find((e) => e.kind === "thread.started")?.payload.thread.threadId;
  for (let i = 0; i < 40; i += 1) { await sleep(500); if (commands.length > 0) break; }
  const slash = commands.filter((c) => c.trigger === "/").length;
  const skills = commands.filter((c) => c.trigger === "$").length;
  const pass = commands.length > 0;
  log({ phase: pass ? "PASS" : "FAIL", agent, total: commands.length, slash, skills, sample: commands.slice(0, 5).map((c) => `${c.trigger}${c.name}`) });
  process.exitCode = pass ? 0 : 1;
} catch (e) {
  log({ phase: "ERROR", error: String(e?.stack ?? e) });
  process.exitCode = 1;
} finally {
  if (threadId) await adapter.handleMessage(cmd("agentRuntime.stop", { threadId })).catch(() => {});
  process.exit(process.exitCode);
}
