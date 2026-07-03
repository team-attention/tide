#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createLiveBackendContractMessageAdapter } from "../src/backend/infrastructure/node/live/live-backend.ts";
import { parseOpencodeSessionListText } from "../src/backend/application/services/provider/provider-session-discovery.ts";
import { CONTRACT_VERSION } from "../src/shared/contracts/index.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = parseArgs(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}

const sessions = listOpencodeSessions();
const selected = selectSession(sessions, options);
const cwd = path.resolve(options.cwd ?? selected.directory);
const token = `TIDE_OPENCODE_ADOPTION_SMOKE_${Date.now()}`;
const message = options.message ?? `Reply exactly with ${token} and nothing else.`;
const appDataRoot = options.appDataRoot ?? mkdtempSync(path.join(tmpdir(), "tide-opencode-adoption-smoke-"));
const pushedEvents = [];
let adoptedThreadId = null;

writeFileSync(
  path.join(appDataRoot, "project-registry.json"),
  `${JSON.stringify([{ projectId: "opencode-adoption-smoke", name: "opencode adoption smoke", cwd }], null, 2)}\n`,
  "utf8",
);

const adapter = createLiveBackendContractMessageAdapter({
  appDataRoot,
  env: {
    ...process.env,
    TIDE_APP_DATA_ROOT: appDataRoot,
    TIDE_MCP_ENTRYPOINT: path.join(repoRoot, "out/main/backend-entrypoint.js"),
  },
  onEvent: (event) => {
    pushedEvents.push(event);
  },
});

try {
  log({
    phase: "selected-session",
    appDataRoot,
    sessionId: selected.id,
    cwd,
    title: selected.title,
  });

  await sendCommand(adapter, "thread.list", {});
  const adopted = await waitForAdoptedThread(adapter, pushedEvents, selected.id, options.timeoutMs);
  adoptedThreadId = adopted.threadId;
  log({ phase: "adopted", threadId: adoptedThreadId, title: adopted.title });

  const firstHydrate = await sendCommand(adapter, "thread.hydrate", { threadId: adoptedThreadId });
  const firstHydrated = firstHydrate.find((event) => event.kind === "thread.hydrated");
  const firstBlocks = firstHydrated?.payload.blocks ?? [];
  if (firstBlocks.length === 0) {
    throw new Error("Adopted opencode thread hydrated with no Agent Session blocks.");
  }
  log({ phase: "hydrated", blockCount: firstBlocks.length });

  const sent = await sendCommand(adapter, "composer.sendInput", {
    threadId: adoptedThreadId,
    input: message,
  });
  const readiness = sent.find((event) => event.kind === "providerReadiness.changed");
  if (readiness !== undefined) {
    log({ phase: "provider-not-ready", readiness: readiness.payload.readiness });
    throw new Error("opencode was not ready for the adoption follow-up.");
  }
  log({ phase: "follow-up-sent", threadId: adoptedThreadId, token });

  await sleep(options.followupWaitMs);
  const secondHydrate = await sendCommand(adapter, "thread.hydrate", { threadId: adoptedThreadId });
  const secondHydrated = secondHydrate.find((event) => event.kind === "thread.hydrated");
  log({
    phase: "follow-up-hydrated",
    blockCount: secondHydrated?.payload.blocks?.length ?? 0,
  });

  const exported = exportOpencodeSession(selected.id);
  if (!exported.includes(token)) {
    throw new Error("opencode export did not include the follow-up token in the adopted session.");
  }
  log({ phase: "passed", sessionId: selected.id, threadId: adoptedThreadId, token });
} finally {
  if (adoptedThreadId !== null) {
    await sendCommand(adapter, "agentRuntime.stop", { threadId: adoptedThreadId }).catch((error) => {
      process.emitWarning(
        error instanceof Error ? error.message : "Failed to stop opencode adoption smoke runtime.",
        { type: "TideOpencodeAdoptionSmokeStopWarning" },
      );
    });
  }
}

function listOpencodeSessions() {
  const result = spawnSync("opencode", ["session", "list", "--format", "json", "--max-count", "200"], {
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
    timeout: 10_000,
  });
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(`opencode session list failed: ${result.error?.message ?? result.stderr}`);
  }
  return parseOpencodeSessionListText(result.stdout);
}

function selectSession(sessions, input) {
  const cwd = input.cwd === undefined ? undefined : path.resolve(input.cwd);
  const matches = sessions.filter((session) => {
    if (input.sessionId !== undefined && session.id !== input.sessionId) {
      return false;
    }
    if (cwd !== undefined && path.resolve(session.directory) !== cwd) {
      return false;
    }
    return true;
  });
  const selected = matches[0];
  if (selected === undefined) {
    throw new Error("No matching opencode session found. Pass --cwd and/or --session-id.");
  }
  return selected;
}

function exportOpencodeSession(sessionId) {
  const result = spawnSync("opencode", ["export", sessionId], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout: 10_000,
  });
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(`opencode export failed: ${result.error?.message ?? result.stderr}`);
  }
  return result.stdout;
}

async function waitForAdoptedThread(adapter, pushed, sessionId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const pushedThread = findAdoptedThread(pushed, sessionId);
    if (pushedThread !== undefined) {
      return pushedThread;
    }
    const listed = await sendCommand(adapter, "thread.list", {});
    const listedThread = findAdoptedThread(listed, sessionId);
    if (listedThread !== undefined) {
      return listedThread;
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for opencode session ${sessionId} adoption.`);
    }
    await sleep(250);
  }
}

function findAdoptedThread(events, sessionId) {
  for (const event of events) {
    if (event.kind !== "thread.listed") {
      continue;
    }
    const match = event.payload.threads.find((thread) =>
      thread.agentBinding?.providerSessionRef?.kind === "opencode_session" &&
      thread.agentBinding.providerSessionRef.value === sessionId
    );
    if (match !== undefined) {
      return match;
    }
  }
  return undefined;
}

function sendCommand(adapter, kind, payload) {
  return adapter.handleMessage({
    contractVersion: CONTRACT_VERSION,
    requestId: `${kind}:${Date.now()}:${Math.random().toString(16).slice(2)}`,
    kind,
    issuedAt: new Date().toISOString(),
    payload,
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(payload) {
  console.log(JSON.stringify(payload));
}

function parseArgs(args) {
  const parsed = {
    appDataRoot: process.env.TIDE_OPENCODE_ADOPTION_SMOKE_APP_DATA_ROOT,
    cwd: process.env.TIDE_OPENCODE_ADOPTION_SMOKE_CWD,
    followupWaitMs: Number(process.env.TIDE_OPENCODE_ADOPTION_SMOKE_FOLLOWUP_WAIT_MS ?? 75_000),
    help: false,
    message: process.env.TIDE_OPENCODE_ADOPTION_SMOKE_MESSAGE,
    sessionId: process.env.TIDE_OPENCODE_ADOPTION_SMOKE_SESSION_ID,
    timeoutMs: Number(process.env.TIDE_OPENCODE_ADOPTION_SMOKE_TIMEOUT_MS ?? 20_000),
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      case "--app-data-root":
        parsed.appDataRoot = readValue(args, ++index, arg);
        break;
      case "--cwd":
        parsed.cwd = readValue(args, ++index, arg);
        break;
      case "--followup-wait-ms":
        parsed.followupWaitMs = Number(readValue(args, ++index, arg));
        break;
      case "--message":
        parsed.message = readValue(args, ++index, arg);
        break;
      case "--session-id":
        parsed.sessionId = readValue(args, ++index, arg);
        break;
      case "--timeout-ms":
        parsed.timeoutMs = Number(readValue(args, ++index, arg));
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function readValue(args, index, flag) {
  const value = args[index];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function printHelp() {
  console.log(`Usage: npm run test:smoke:opencode-adoption -- --cwd /repo [--session-id <id>]

Adopts an existing local opencode session into a temporary Tide appData root,
hydrates the adopted Thread, sends a real follow-up through opencode ACP, and
verifies opencode export for the same session contains the follow-up token.

This is opt-in because it sends a real provider message and mutates the selected
opencode session history.`);
}
