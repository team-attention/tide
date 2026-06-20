#!/usr/bin/env node

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
} from "../src/desktop/application/domains/product-shell/product-shell.ts";
import { createLiveBackendContractMessageAdapter } from "../src/backend/infrastructure/node/live/live-backend.ts";
import { CONTRACT_VERSION } from "../src/shared/contracts/index.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const providerCliAgents = new Set(["codex", "claude", "gemini", "opencode"]);
const selectableAgents = providerCliAgents;

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}

if (!selectableAgents.has(options.agent)) {
  throw new Error(`Unsupported --agent value: ${options.agent}`);
}

const token = `TIDE_PROVIDER_SMOKE_${options.agent}_${Date.now()}`;
const appDataRoot = options.appDataRoot ?? mkdtempSync(path.join(tmpdir(), "tide-provider-smoke-"));
let shellState = createProductShellState({ includeFixtureData: false });
const pushedEvents = [];

function applyEvent(event) {
  shellState = applyProductShellBackendEvent(shellState, {
    kind: event.kind,
    payload: event.payload,
  });
}

function log(payload) {
  console.log(JSON.stringify(payload));
}

shellState = setProductShellComposerActiveSurface(shellState, "agent_menu");
shellState = selectProductShellChoiceSurfaceRow(
  shellState,
  "agent_menu",
  rowIdForAgent(options.agent),
).state;
shellState = updateProductShellComposerDraft(
  shellState,
  options.message ?? `Reply exactly with this token and nothing else: ${token}`,
);
const submitted = submitProductShellComposerDraft(shellState);
if (submitted.command?.kind !== "thread.start") {
  throw new Error("Product Shell did not emit thread.start.");
}
if (process.env.TIDE_PROVIDER_SMOKE_PERMISSION) {
  submitted.command.payload.launchOptions = {
    ...submitted.command.payload.launchOptions,
    permission: process.env.TIDE_PROVIDER_SMOKE_PERMISSION,
  };
}
shellState = submitted.state;

const adapter = createLiveBackendContractMessageAdapter({
  appDataRoot,
  env: {
    ...process.env,
    TIDE_APP_DATA_ROOT: appDataRoot,
    TIDE_MCP_ENTRYPOINT: path.join(repoRoot, "out/main/backend-entrypoint.js"),
  },
  onEvent: (event) => {
    pushedEvents.push(event);
    applyEvent(event);
  },
});

log({
  phase: "submitted",
  token,
  appDataRoot,
  agent: submitted.command.payload.agentBinding.agentId,
  runtimeSource: submitted.command.payload.agentBinding.runtimeSource,
  launchOptions: submitted.command.payload.launchOptions,
});

let threadId = null;
let smokeExitCode = 0;
try {
  const startEvents = await adapter.handleMessage({
    contractVersion: CONTRACT_VERSION,
    requestId: `provider-smoke-start-${token}`,
    kind: submitted.command.kind,
    issuedAt: new Date().toISOString(),
    payload: submitted.command.payload,
  });
  startEvents.forEach(applyEvent);

  const providerReadiness = startEvents.find((event) => event.kind === "providerReadiness.changed");
  if (providerReadiness) {
    threadId = providerReadiness.payload.threadId;
    log({
      phase: "provider-not-ready",
      threadId,
      readiness: providerReadiness.payload.readiness,
    });

    if (options.openSetupSurface) {
      await openProviderSetupSurfaceSmoke({
        adapter,
        threadId,
        readiness: providerReadiness.payload.readiness,
        token,
        applyEvent,
        log,
      });
    }

    if (!options.expectProviderNotReady) {
      process.exitCode = 2;
      throw new Error("Provider is not ready.");
    }
  } else {
    const started = startEvents.find((event) => event.kind === "thread.started");
    if (!started) {
      log({ phase: "start-events", events: startEvents });
      throw new Error("Live Backend did not emit thread.started.");
    }

    threadId = started.payload.thread.threadId;
    log({
      phase: "started",
      threadId,
      agent: started.payload.thread.agentBinding.agentId,
      runtimeSource: started.payload.thread.agentBinding.runtimeSource,
      launchOptions: started.payload.thread.launchOptions,
    });

    await sleep(options.timeoutMs);

    const hydrateEvents = await adapter.handleMessage({
      contractVersion: CONTRACT_VERSION,
      requestId: `provider-smoke-hydrate-${token}`,
      kind: "thread.hydrate",
      issuedAt: new Date().toISOString(),
      payload: { threadId },
    });
    hydrateEvents.forEach(applyEvent);

    const view = createProductShellViewModel(shellState);
    const agentOutputFound = agentOutputContainsToken(
      [...startEvents, ...pushedEvents, ...hydrateEvents],
      token,
    );
    // The turn's reply must render exactly once. Both the streaming history reader and
    // the turn-end fallback can carry the same answer; the one-source rule guarantees a
    // single rendered copy. Assert it so a regression can never re-introduce the dup.
    const answerBlocksWithToken = view.agentChat.blocks.filter(
      (block) => block?.role === "agent" && String(block.body ?? "").includes(token),
    ).length;

    log({
      phase: "hydrated",
      threadId,
      agentLabel: view.agentChat.thread?.agentLabel,
      composerMode: view.agentChat.composer.mode,
      modelLabel: view.agentChat.composer.modelLabel,
      runtimeState: view.agentChat.runtimeState,
      blockCount: view.agentChat.blocks.length,
      answerBlocksWithToken,
      agentOutputFound,
      pushedCount: pushedEvents.length,
    });

    if (view.agentChat.thread?.agentLabel !== labelForAgent(options.agent)) {
      throw new Error(`Unexpected Agent label: ${view.agentChat.thread?.agentLabel}`);
    }
    if (providerCliAgents.has(options.agent) && !agentOutputFound) {
      throw new Error("Hydrated Agent Session did not include the live token in an Agent output block.");
    }
    if (answerBlocksWithToken > 1) {
      throw new Error(
        `Final answer rendered ${answerBlocksWithToken} times — the one-source rule should make it exactly once.`,
      );
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  smokeExitCode = process.exitCode === 2 ? 2 : 1;
} finally {
  if (threadId !== null) {
    await adapter.handleMessage({
      contractVersion: CONTRACT_VERSION,
      requestId: `provider-smoke-stop-${token}`,
      kind: "agentRuntime.stop",
      issuedAt: new Date().toISOString(),
      payload: { threadId },
    }).catch((error) => {
      process.emitWarning(
        error instanceof Error ? error.message : "Failed to stop provider smoke runtime.",
        { type: "TideProviderSmokeStopWarning" },
      );
    });
  }

  process.exit(smokeExitCode);
}

function parseArgs(args) {
  const parsed = {
    agent: process.env.TIDE_PROVIDER_SMOKE_AGENT ?? "codex",
    timeoutMs: Number(process.env.TIDE_PROVIDER_SMOKE_TIMEOUT_MS ?? 75000),
    appDataRoot: process.env.TIDE_PROVIDER_SMOKE_APP_DATA_ROOT,
    message: process.env.TIDE_PROVIDER_SMOKE_MESSAGE,
    expectProviderNotReady: process.env.TIDE_PROVIDER_SMOKE_EXPECT_PROVIDER_NOT_READY === "1",
    openSetupSurface: process.env.TIDE_PROVIDER_SMOKE_OPEN_SETUP_SURFACE === "1",
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      case "--agent":
        parsed.agent = normalizeAgentArg(readValue(args, ++index, "--agent"));
        break;
      case "--timeout-ms":
        parsed.timeoutMs = Number(readValue(args, ++index, "--timeout-ms"));
        break;
      case "--app-data-root":
        parsed.appDataRoot = readValue(args, ++index, "--app-data-root");
        break;
      case "--message":
        parsed.message = readValue(args, ++index, "--message");
        break;
      case "--expect-provider-not-ready":
        parsed.expectProviderNotReady = true;
        break;
      case "--open-setup-surface":
        parsed.openSetupSurface = true;
        break;
      default:
        throw new Error(`Unknown provider smoke argument: ${arg}`);
    }
  }

  if (!Number.isFinite(parsed.timeoutMs) || parsed.timeoutMs < 1000) {
    throw new Error("--timeout-ms must be at least 1000.");
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

function rowIdForAgent(agent) {
  return agent;
}

function normalizeAgentArg(agent) {
  return agent;
}

function labelForAgent(agent) {
  switch (agent) {
    case "codex":
      return "Codex CLI";
    case "claude":
      return "Claude Code";
    case "gemini":
      return "Gemini CLI";
    case "opencode":
      return "opencode";
    default:
      return agent;
  }
}

function agentOutputContainsToken(events, token) {
  if (token.length === 0) {
    return false;
  }
  for (const event of events) {
    if (event.kind === "agentSessionBlock.upserted") {
      if (blockContainsToken(event.payload.block, token)) {
        return true;
      }
    }
    if (event.kind === "thread.hydrated") {
      for (const block of event.payload.blocks ?? []) {
        if (blockContainsToken(block, token)) {
          return true;
        }
      }
    }
  }
  return false;
}

function blockContainsToken(block, token) {
  if (block?.role !== "agent") {
    return false;
  }
  return String(block.body ?? "").includes(token) ||
    String(block.rawFallback ?? "").includes(token);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function openProviderSetupSurfaceSmoke(input) {
  const setup = input.readiness.blockers.find((blocker) => blocker.setup)?.setup;
  if (setup === undefined) {
    throw new Error("Provider readiness did not include a setup action.");
  }

  const openEvents = await input.adapter.handleMessage({
    contractVersion: CONTRACT_VERSION,
    requestId: `provider-smoke-open-setup-${input.token}`,
    kind: "workbench.command",
    issuedAt: new Date().toISOString(),
    payload: {
      threadId: input.threadId,
      command: "open_provider_setup_surface",
      data: { setup },
    },
  });
  openEvents.forEach(input.applyEvent);
  const workbenchChanged = openEvents.find((event) => event.kind === "workbench.changed");
  const pane = workbenchChanged?.payload.panes.find((candidate) => candidate.kind === "terminal");
  if (pane === undefined) {
    throw new Error("Provider setup surface did not open a Terminal Pane.");
  }

  input.log({
    phase: "provider-setup-surface-opened",
    threadId: input.threadId,
    paneId: pane.paneId,
    title: pane.title,
    status: pane.status,
    command: pane.command,
    expectedCompletion: pane.expectedCompletion,
  });

  const closeEvents = await input.adapter.handleMessage({
    contractVersion: CONTRACT_VERSION,
    requestId: `provider-smoke-close-setup-${input.token}`,
    kind: "workbench.command",
    issuedAt: new Date().toISOString(),
    payload: {
      threadId: input.threadId,
      command: "close_pane",
      targetPaneId: pane.paneId,
    },
  });
  closeEvents.forEach(input.applyEvent);
  const closeWorkbenchChanged = closeEvents.find((event) => event.kind === "workbench.changed");
  const closedPane = closeWorkbenchChanged?.payload.panes.find(
    (candidate) => candidate.paneId === pane.paneId,
  );
  input.log({
    phase: "provider-setup-surface-closed",
    threadId: input.threadId,
    paneId: pane.paneId,
    visible: closedPane?.visible,
    status: closedPane?.status,
  });
}

function printHelp() {
  console.log(`Usage: npm run test:smoke:providers -- --agent codex

Options:
  --agent codex|claude|gemini|opencode
  --timeout-ms 75000
  --app-data-root /tmp/tide-provider-smoke
  --message "Prompt text"
  --expect-provider-not-ready
  --open-setup-surface

The smoke uses Product Shell start state, sends it through the live Backend
adapter, waits for provider-owned Agent Session output, hydrates the Thread,
and verifies the selected Agent remains active in the Composer chrome.
Use --expect-provider-not-ready --open-setup-surface to verify a Provider
Readiness setup action opens and closes a Workbench Terminal Pane without
auto-accepting provider-native setup prompts.`);
}
