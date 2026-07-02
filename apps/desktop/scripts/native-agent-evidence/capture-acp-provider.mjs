#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";

class NativeEventBuilder {
  constructor(provider) {
    this.provider = provider;
    this.events = [];
    this.sequence = 0;
    this.runtimeId = `${provider}-acp-capture-runtime`;
    this.threadId = `${provider}-acp-capture-thread`;
  }

  push(nativeKind, nativeIds, payload, providerSessionId) {
    this.sequence += 1;
    this.events.push({
      eventId: `${this.provider}-acp-capture-${this.sequence}`,
      provider: this.provider,
      transport: "acp",
      runtimeId: this.runtimeId,
      tideThreadId: this.threadId,
      ...(providerSessionId !== undefined ? { providerSessionId } : {}),
      nativeSequence: this.sequence,
      receivedAt: new Date().toISOString(),
      nativeKind,
      nativeIds,
      payload,
      redaction: "reduced",
    });
  }
}

const args = parseArgs(process.argv.slice(2));
const provider = args.provider ?? "opencode";
const command = args.command ?? provider;
const runtimeArgs = args.args.length > 0 ? args.args : ["acp"];
const timeoutMs = Number(args["timeout-ms"] ?? 5000);
const postSessionWaitMs = Number(args["post-session-wait-ms"] ?? 300);
if (!args.out) {
  fail("usage: capture-acp-provider.mjs --provider <name> --command <cmd> --args <args...> --out <dir>");
}

const version = run(command, ["--version"]);
const help = run(command, [...runtimeArgs, "--help"]);
const capture = args["skip-handshake"]
  ? skippedCapture(provider)
  : await captureHandshake({
      provider,
      command,
      runtimeArgs,
      cwd: args.cwd ?? process.cwd(),
      timeoutMs,
      postSessionWaitMs,
    });

mkdirSync(args.out, { recursive: true });
writeFileSync(join(args.out, "runtime-help.txt"), help.stdout);
writeFileSync(join(args.out, "provider.json"), JSON.stringify({
  provider,
  executable: commandName(command),
  version: firstLine(version.stdout),
  surfaces: ["acp"],
  runtimeArgs,
  helpSha256: sha256(help.stdout),
  capturedAt: new Date().toISOString(),
  redaction: capture.redaction,
  handshakeStatus: capture.summary.status,
}, null, 2));
writeFileSync(join(args.out, "acp-handshake-summary.json"), JSON.stringify(capture.summary, null, 2));
if (capture.nativeEvents.length > 0) {
  writeFileSync(
    join(args.out, "native-handshake.native.jsonl"),
    `${capture.nativeEvents.map((event) => JSON.stringify(event)).join("\n")}\n`,
  );
}

function parseArgs(argv) {
  const known = new Set([
    "--provider",
    "--command",
    "--out",
    "--cwd",
    "--timeout-ms",
    "--post-session-wait-ms",
    "--skip-handshake",
  ]);
  const out = { args: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--skip-handshake") {
      out["skip-handshake"] = true;
      continue;
    }
    if (arg === "--args") {
      i += 1;
      while (i < argv.length && !known.has(argv[i])) {
        out.args.push(argv[i]);
        i += 1;
      }
      i -= 1;
      continue;
    }
    if (known.has(arg)) {
      out[arg.slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return out;
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { encoding: "utf8" });
  if (result.status !== 0) {
    fail(`${command} ${commandArgs.join(" ")} failed: ${result.stderr || result.error?.message || result.status}`);
  }
  return { stdout: result.stdout, stderr: result.stderr };
}

async function captureHandshake(input) {
  const native = new NativeEventBuilder(input.provider);
  const frames = [];
  const summary = {
    provider: input.provider,
    runtimeArgs: input.runtimeArgs,
    status: "started",
    protocolVersion: undefined,
    agentInfo: undefined,
    authMethodCount: 0,
    capabilityGroups: [],
    configOptionCount: 0,
    modelCount: 0,
    commandCount: 0,
    sessionIdRedacted: false,
    protocolFrames: frames,
  };
  const child = spawn(input.command, input.runtimeArgs, {
    cwd: input.cwd,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  let buffer = "";
  let stderrBytes = 0;
  let settled = false;
  let nextId = 1;
  let providerSessionId;
  const cleanup = () => {
    try {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 500).unref();
    } catch {
      // process already gone
    }
  };
  const writeRequest = (method, params) => {
    const id = nextId;
    nextId += 1;
    frames.push({ direction: "out", method });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return id;
  };

  return await new Promise((resolve) => {
    const done = (status) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      summary.status = status;
      summary.stderrBytes = stderrBytes;
      cleanup();
      resolve({ summary: stripUndefined(summary), nativeEvents: native.events, redaction: "reduced_handshake" });
    };
    const timeout = setTimeout(() => done("timeout"), input.timeoutMs);
    child.stderr.on("data", (chunk) => {
      stderrBytes += Buffer.byteLength(chunk);
    });
    child.on("error", () => done("spawn_error"));
    child.on("exit", (code) => {
      if (!settled && summary.status === "started") {
        summary.exitCode = code;
        done("exited_before_handshake");
      }
    });
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let index = buffer.indexOf("\n");
      while (index >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf("\n");
        if (line.length === 0) continue;
        handleProtocolLine(line);
      }
    });

    const initializeId = writeRequest("initialize", {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: "tide-evidence", title: "Tide Evidence", version: "1.0" },
    });

    function handleProtocolLine(line) {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        frames.push({ direction: "in", parseError: true });
        return;
      }
      if (message.id === initializeId) {
        const result = recordResponseFrame(frames, "initialize", message);
        if (result === undefined) {
          native.push("turn_completed", {}, {
            kind: "turn_completed",
            notice: errorMessage(message) ?? "ACP initialize failed.",
          });
          done("initialize_error");
          return;
        }
        recordInitializeResult(summary, native, result);
        writeRequest("session/new", { cwd: input.cwd, mcpServers: [] });
        return;
      }
      if (message.id === 2) {
        const result = recordResponseFrame(frames, "session/new", message);
        if (result === undefined) {
          native.push("turn_completed", {}, {
            kind: "turn_completed",
            notice: errorMessage(message) ?? "ACP session could not be started.",
          });
          done("session_rejected");
          return;
        }
        const sessionId = stringField(result, "sessionId");
        providerSessionId = sessionId !== undefined ? `${input.provider}-session-captured` : undefined;
        if (providerSessionId !== undefined) {
          summary.sessionIdRedacted = true;
          native.push("session_ref", { sessionId: providerSessionId }, {
            kind: "session_ref",
            ref: { kind: providerSessionKind(input.provider), value: providerSessionId },
          }, providerSessionId);
        }
        recordSessionModelCatalog(summary, native, result, providerSessionId);
        setTimeout(() => done("session_started"), input.postSessionWaitMs);
        return;
      }
      if (typeof message.method === "string") {
        frames.push({ direction: "in", method: message.method });
        recordNotification(summary, native, message, providerSessionId);
      }
    }
  });
}

function recordResponseFrame(frames, method, message) {
  if (message.error !== undefined) {
    frames.push({ direction: "in", method, status: "error", error: errorMessage(message) });
    return undefined;
  }
  const result = isRecord(message.result) ? message.result : {};
  frames.push({ direction: "in", method, status: "ok" });
  return result;
}

function recordInitializeResult(summary, native, result) {
  const agentInfo = isRecord(result.agentInfo) ? result.agentInfo : undefined;
  const authMethods = Array.isArray(result.authMethods) ? result.authMethods : [];
  const agentCapabilities = isRecord(result.agentCapabilities) ? result.agentCapabilities : {};
  summary.protocolVersion = numberField(result, "protocolVersion");
  summary.agentInfo = agentInfo === undefined ? undefined : {
    name: stringField(agentInfo, "name"),
    title: stringField(agentInfo, "title"),
    version: stringField(agentInfo, "version"),
  };
  summary.authMethodCount = authMethods.length;
  summary.capabilityGroups = Object.keys(agentCapabilities).sort();
  native.push("provider_capabilities", {}, {
    kind: "provider_capabilities",
    ...(summary.protocolVersion !== undefined ? { protocolVersion: summary.protocolVersion } : {}),
    ...(agentInfo !== undefined ? { agentInfo } : {}),
    ...(authMethods.length > 0 ? { authMethods } : {}),
    ...(Object.keys(agentCapabilities).length > 0 ? { agentCapabilities } : {}),
    nativePayload: result,
  });
}

function recordSessionModelCatalog(summary, native, result, providerSessionId) {
  const catalog = modelCatalogFromSessionResult(result);
  summary.configOptionCount = Array.isArray(result.configOptions) ? result.configOptions.length : 0;
  summary.modelCount = catalog?.models.length ?? 0;
  if (catalog !== undefined) {
    native.push("model_catalog", {}, {
      kind: "model_catalog",
      models: catalog.models,
      currentModel: catalog.currentModel,
    }, providerSessionId);
  }
}

function recordNotification(summary, native, message, providerSessionId) {
  if (message.method !== "session/update" || !isRecord(message.params)) return;
  const update = isRecord(message.params.update) ? message.params.update : {};
  if (stringField(update, "sessionUpdate") !== "available_commands_update") return;
  const commands = Array.isArray(update.availableCommands)
    ? update.availableCommands.filter(isRecord).map((command) => ({
        name: stringField(command, "name") ?? "",
        description: stringField(command, "description") ?? "ACP command",
        trigger: "/",
      })).filter((command) => command.name.length > 0)
    : [];
  if (commands.length === 0) return;
  summary.commandCount = commands.length;
  native.push("commands", {}, { kind: "commands", commands }, providerSessionId);
}

function modelCatalogFromSessionResult(result) {
  if (isRecord(result.models) && Array.isArray(result.models.availableModels)) {
    const models = result.models.availableModels.filter(isRecord).map((entry) => {
      const value = stringField(entry, "modelId") ?? "";
      return { value, label: stringField(entry, "name") ?? value };
    }).filter((model) => model.value.length > 0);
    if (models.length > 0) {
      return { models, currentModel: stringField(result.models, "currentModelId") };
    }
  }
  if (Array.isArray(result.configOptions)) {
    const option = result.configOptions
      .filter(isRecord)
      .find((entry) => stringField(entry, "category") === "model" || stringField(entry, "id") === "model");
    if (option !== undefined && Array.isArray(option.options)) {
      const models = option.options.filter(isRecord).map((entry) => {
        const value = stringField(entry, "value") ?? "";
        const slash = value.indexOf("/");
        return {
          value,
          label: slash > 0 ? value.slice(slash + 1) : stringField(entry, "name") ?? value,
          ...(slash > 0 ? { vendor: value.slice(0, slash) } : {}),
        };
      }).filter((model) => model.value.length > 0);
      if (models.length > 0) {
        return { models, currentModel: stringField(option, "currentValue") };
      }
    }
  }
  return undefined;
}

function skippedCapture(provider) {
  return {
    redaction: "help_only",
    nativeEvents: [],
    summary: {
      provider,
      status: "skipped",
      protocolFrames: [],
    },
  };
}

function providerSessionKind(provider) {
  if (provider === "opencode") return "opencode_session";
  return "provider_native";
}

function errorMessage(message) {
  return isRecord(message.error) && typeof message.error.message === "string"
    ? message.error.message
    : undefined;
}

function commandName(command) {
  return command.split(/[\\/]/).pop() || command;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record, key) {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberField(record, key) {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stripUndefined(value) {
  return JSON.parse(JSON.stringify(value));
}

function firstLine(value) {
  return value.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? "";
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}
