#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createProductShellState,
  selectProductShellChoiceSurfaceRow,
  setProductShellComposerActiveSurface,
  submitProductShellComposerDraft,
  updateProductShellComposerDraft,
} from "../src/desktop/application/domains/product-shell/product-shell.ts";
import { CONTRACT_VERSION } from "../src/shared/contracts/index.ts";

const require = createRequire(import.meta.url);
const electronPath = require("electron");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const selectableAgents = new Set(["codex", "claude", "opencode", "qwen"]);

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}

if (!selectableAgents.has(options.agent)) {
  throw new Error(`Unsupported --agent value: ${options.agent}`);
}

const electronMain = path.join(repoRoot, "out/main/electron-main.js");
if (!existsSync(electronMain)) {
  throw new Error("Built Electron Main is missing. Run npm run build before Electron smoke.");
}

const token = `TIDE_ELECTRON_SMOKE_${options.agent}_${Date.now()}`;
const appDataRoot = options.appDataRoot ?? mkdtempSync(path.join(tmpdir(), "tide-electron-smoke-"));
const submitted = createStartCommand({
  agent: options.agent,
  message: options.message ?? `Reply exactly with this token and nothing else: ${token}`,
});

const command = {
  contractVersion: CONTRACT_VERSION,
  requestId: `electron-smoke-start-${token}`,
  kind: submitted.kind,
  issuedAt: new Date().toISOString(),
  payload: submitted.payload,
};

let exitCode = 0;
try {
  const result = await runElectronSmoke({
    command,
    token,
    appDataRoot,
    timeoutMs: options.timeoutMs,
    expectPushedAgentOutput: false,
    expectProviderNotReady: options.expectProviderNotReady,
    openReadinessTerminal: options.openReadinessTerminal,
  });

  if (result.status !== 0) {
    exitCode = result.status ?? 1;
  } else {
    const smokeResult = parseSmokeResult(result.stdout);
    if (smokeResult === null) {
      console.error("Electron smoke did not print TIDE_ELECTRON_SMOKE_RESULT.");
      exitCode = 1;
    } else if (smokeResult.ok === false) {
      if (options.expectProviderNotReady && smokeResult.phase === "provider-not-ready") {
        if (options.openReadinessTerminal && smokeResult.readinessTerminal?.opened !== true) {
          console.error(JSON.stringify(smokeResult, null, 2));
          throw new Error("Electron smoke did not open the Provider readiness terminal.");
        }
        console.log(JSON.stringify({
          phase: "electron-smoke-provider-not-ready",
          appDataRoot,
          threadId: smokeResult.threadId,
          readiness: smokeResult.readiness,
          readinessTerminal: smokeResult.readinessTerminal,
        }));
      } else {
        console.error(JSON.stringify(smokeResult, null, 2));
        exitCode = smokeResult.phase === "provider-not-ready" ? 2 : 1;
      }
    } else {
      if (smokeResult.agent !== options.agent || smokeResult.hydratedAgent !== options.agent) {
        console.error(JSON.stringify(smokeResult, null, 2));
        throw new Error(`Electron smoke used ${smokeResult.agent}/${smokeResult.hydratedAgent}, expected ${options.agent}.`);
      }

      if (smokeResult.launchOptions?.model !== submitted.payload.launchOptions?.model) {
        throw new Error(`Electron smoke changed model to ${smokeResult.launchOptions?.model}.`);
      }

      if (smokeResult.hydratedLaunchOptions?.model !== submitted.payload.launchOptions?.model) {
        throw new Error(`Electron hydrate changed model to ${smokeResult.hydratedLaunchOptions?.model}.`);
      }

      if (!smokeResult.agentOutputFound) {
        throw new Error("Electron smoke did not find the token in an Agent output block.");
      }

      console.log(JSON.stringify({
        phase: "electron-smoke-passed",
        appDataRoot,
        threadId: smokeResult.threadId,
        agent: smokeResult.agent,
        launchOptions: smokeResult.launchOptions,
        blockCount: smokeResult.blockCount,
        pushedAgentOutputFound: smokeResult.pushedAgentOutputFound,
        pushedCount: smokeResult.pushedCount,
      }));
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  exitCode = 1;
}

if (exitCode !== 0) {
  process.exit(exitCode);
}

function createStartCommand(input) {
  let shellState = createProductShellState({ includeFixtureData: false });
  shellState = setProductShellComposerActiveSurface(shellState, "agent_menu");
  shellState = selectProductShellChoiceSurfaceRow(
    shellState,
    "agent_menu",
    rowIdForAgent(input.agent),
  ).state;
  shellState = updateProductShellComposerDraft(shellState, input.message);
  const submitted = submitProductShellComposerDraft(shellState);
  if (submitted.command?.kind !== "thread.start") {
    throw new Error("Product Shell did not emit thread.start.");
  }
  return submitted.command;
}

function runElectronSmoke(input) {
  return new Promise((resolve) => {
    const child = spawn(electronPath, [electronMain], {
      cwd: repoRoot,
      env: {
        ...process.env,
        TIDE_APP_DATA_ROOT: input.appDataRoot,
        TIDE_ELECTRON_SMOKE_COMMAND: JSON.stringify(input.command),
        TIDE_ELECTRON_SMOKE_TOKEN: input.token,
        TIDE_ELECTRON_SMOKE_TIMEOUT_MS: String(input.timeoutMs),
        TIDE_ELECTRON_SMOKE_EXPECT_PUSHED_AGENT_OUTPUT: input.expectPushedAgentOutput ? "1" : "0",
        TIDE_ELECTRON_SMOKE_OPEN_READINESS_TERMINAL: input.openReadinessTerminal ? "1" : "0",
        TIDE_BACKEND_COMMAND_TIMEOUT_MS: String(input.timeoutMs + 10000),
        TIDE_BACKEND_TRACE: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const killTimer = setTimeout(() => {
      child.kill();
    }, input.timeoutMs + 15000);

    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      process.stderr.write(text);
    });
    child.on("close", (status) => {
      clearTimeout(killTimer);
      resolve({ status, stdout, stderr });
    });
  });
}

function parseSmokeResult(stdout) {
  const line = stdout
    .split(/\r?\n/)
    .find((entry) => entry.startsWith("TIDE_ELECTRON_SMOKE_RESULT "));
  if (line === undefined) {
    return null;
  }
  return JSON.parse(line.slice("TIDE_ELECTRON_SMOKE_RESULT ".length));
}

function parseArgs(args) {
  const parsed = {
    agent: process.env.TIDE_ELECTRON_SMOKE_AGENT ?? "codex",
    timeoutMs: Number(process.env.TIDE_ELECTRON_SMOKE_TIMEOUT_MS ?? 75000),
    appDataRoot: process.env.TIDE_ELECTRON_SMOKE_APP_DATA_ROOT,
    message: process.env.TIDE_ELECTRON_SMOKE_MESSAGE,
    expectProviderNotReady: process.env.TIDE_ELECTRON_SMOKE_EXPECT_PROVIDER_NOT_READY === "1",
    openReadinessTerminal: process.env.TIDE_ELECTRON_SMOKE_OPEN_READINESS_TERMINAL === "1",
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
      case "--open-readiness-terminal":
        parsed.openReadinessTerminal = true;
        break;
      default:
        throw new Error(`Unknown Electron smoke argument: ${arg}`);
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

function printHelp() {
  console.log(`Usage: npm run test:smoke:electron -- --agent codex

Options:
  --agent codex|claude|opencode|qwen
  --timeout-ms 75000
  --app-data-root /tmp/tide-electron-smoke
  --message "Prompt text"
  --expect-provider-not-ready
  --open-readiness-terminal

The smoke requires npm run build first. It launches the built Electron app,
uses the Renderer preload surface window.tide, sends a Product Shell
thread.start command through Main IPC to the Backend utilityProcess, hydrates
the Thread, and verifies the selected Agent produced an output block.
Use --expect-provider-not-ready --open-readiness-terminal to verify a Provider
Readiness blocker and readiness terminal path without treating the blocker as failure.`);
}
