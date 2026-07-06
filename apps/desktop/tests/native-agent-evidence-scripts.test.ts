import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { replayNativeFixtureText } from "../src/backend/adapters/outbound/agent-runtime/evidence/native-fixture-replay.ts";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const captureScript = path.join(desktopRoot, "scripts/native-agent-evidence/capture-acp-provider.mjs");
const codexCaptureScript = path.join(desktopRoot, "scripts/native-agent-evidence/capture-codex-app-server.mjs");

test("capture-acp-provider records a reduced ACP handshake fixture", () => {
  const fixture = createFakeAcpFixture();
  const out = path.join(fixture.root, "success");
  const result = runCapture({
    provider: "opencode",
    command: fixture.provider,
    runtimeArgs: ["acp"],
    out,
    mode: "success",
  });

  assert.equal(result.status, 0, result.stderr);
  const provider = readJson(path.join(out, "provider.json"));
  assert.equal(provider.redaction, "reduced_handshake");
  assert.deepEqual(provider.runtimeArgs, ["acp"]);

  const summary = readJson(path.join(out, "acp-handshake-summary.json"));
  assert.equal(summary.status, "session_started");
  assert.equal(summary.modelCount, 1);
  assert.equal(summary.commandCount, 1);
  assert.equal(summary.sessionIdRedacted, true);

  const fixtureText = fs.readFileSync(path.join(out, "native-handshake.native.jsonl"), "utf8");
  assert.equal(fixtureText.includes("secret-session-123"), false);
  assert.equal(fixtureText.includes(fixture.root), false);
  const events = parseJsonl(fixtureText);
  assert.deepEqual(events.map((event) => event.nativeKind), [
    "provider_capabilities",
    "session_ref",
    "model_catalog",
    "commands",
  ]);
  assert.equal(events[1]?.nativeIds.sessionId, "opencode-session-captured");
  assert.equal(events[2]?.payload.currentModel, "openai/gpt-5.5");

  const replay = replayNativeFixtureText(fixtureText);
  assert.equal(replay.frames, 4);
  assert.equal(replay.semanticKinds.config_state, 3);
  assert.equal(replay.semanticKinds.session_event, 1);
});

test("capture-acp-provider supports --args values that start with dashes", () => {
  const fixture = createFakeAcpFixture();
  const out = path.join(fixture.root, "qwen-auth");
  const result = runCapture({
    provider: "qwen",
    command: fixture.provider,
    runtimeArgs: ["--acp"],
    out,
    mode: "auth_required",
  });

  assert.equal(result.status, 0, result.stderr);
  const provider = readJson(path.join(out, "provider.json"));
  assert.deepEqual(provider.runtimeArgs, ["--acp"]);

  const summary = readJson(path.join(out, "acp-handshake-summary.json"));
  assert.equal(summary.status, "session_rejected");
  assert.equal(summary.authMethodCount, 1);

  const events = parseJsonl(fs.readFileSync(path.join(out, "native-handshake.native.jsonl"), "utf8"));
  assert.deepEqual(events.map((event) => event.nativeKind), ["provider_capabilities", "turn_completed"]);
  assert.equal(
    events[1]?.payload.notice,
    "Authentication required: Use provider CLI to authenticate first.",
  );
  const replay = replayNativeFixtureText(fs.readFileSync(path.join(out, "native-handshake.native.jsonl"), "utf8"));
  assert.equal(replay.semanticKinds.config_state, 1);
  assert.equal(replay.semanticKinds.session_event, 1);
});

test("capture-codex-app-server refuses review/start without explicit approval", () => {
  const fixture = createFakeCodexFixture();
  const out = path.join(fixture.root, "refused");
  const result = spawnSync(process.execPath, [
    codexCaptureScript,
    "--codex",
    fixture.codex,
    "--out",
    out,
    "--review-start",
    "--cwd",
    fixture.root,
  ], {
    cwd: desktopRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /refusing to run review\/start/);
});

test("capture-codex-app-server records a reduced review/start protocol fixture", () => {
  const fixture = createFakeCodexFixture();
  const out = path.join(fixture.root, "review-start");
  const result = spawnSync(process.execPath, [
    codexCaptureScript,
    "--codex",
    fixture.codex,
    "--out",
    out,
    "--review-start",
    "--allow-provider-review",
    "--cwd",
    fixture.root,
    "--target",
    "base",
    "--base-branch",
    "secret-feature-branch",
    "--delivery",
    "detached",
    "--timeout-ms",
    "2000",
    "--post-review-wait-ms",
    "50",
  ], {
    cwd: desktopRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  const provider = readJson(path.join(out, "provider.json"));
  assert.equal(provider.redaction, "reduced_review_start");
  assert.equal(provider.reviewStartStatus, "review_started");

  const summary = readJson(path.join(out, "codex-review-start-summary.json"));
  assert.equal(summary.status, "review_started");
  assert.equal(summary.targetType, "baseBranch");
  assert.equal(summary.delivery, "detached");
  assert.equal(summary.threadIdRedacted, true);
  assert.equal(summary.reviewThreadIdRedacted, true);
  assert.equal(summary.turnIdRedacted, true);
  assert.deepEqual(summary.notificationMethods, ["turn/started"]);

  const protocolText = fs.readFileSync(path.join(out, "app-server-review-start.protocol.jsonl"), "utf8");
  assert.equal(protocolText.includes(fixture.root), false);
  assert.equal(protocolText.includes("secret-thread-123"), false);
  assert.equal(protocolText.includes("secret-feature-branch"), false);
  const protocol = parseJsonl(protocolText);
  const reviewStart = protocol.find((frame) => frame.direction === "out" && frame.method === "review/start");
  assert.deepEqual(reviewStart?.params, {
    threadId: "[REDACTED_ID]",
    target: { type: "baseBranch", branch: "[REDACTED_BRANCH]" },
    delivery: "detached",
  });
});

function runCapture(input: {
  provider: string;
  command: string;
  runtimeArgs: string[];
  out: string;
  mode: "success" | "auth_required";
}) {
  return spawnSync(process.execPath, [
    captureScript,
    "--provider",
    input.provider,
    "--command",
    input.command,
    "--args",
    ...input.runtimeArgs,
    "--out",
    input.out,
    "--timeout-ms",
    "2000",
    "--post-session-wait-ms",
    "100",
  ], {
    cwd: desktopRoot,
    encoding: "utf8",
    env: { ...process.env, FAKE_ACP_MODE: input.mode },
  });
}

function createFakeAcpFixture(): { root: string; provider: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tide-acp-evidence-"));
  const provider = path.join(root, "fake-acp-provider.mjs");
  fs.writeFileSync(provider, fakeAcpProviderSource());
  fs.chmodSync(provider, 0o755);
  return { root, provider };
}

function createFakeCodexFixture(): { root: string; codex: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tide-codex-evidence-"));
  const codex = path.join(root, "fake-codex.mjs");
  fs.writeFileSync(codex, fakeCodexProviderSource());
  fs.chmodSync(codex, 0o755);
  return { root, codex };
}

function fakeAcpProviderSource(): string {
  return `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log("fake-acp 1.2.3");
  process.exit(0);
}
if (args.includes("--help")) {
  console.log("Fake ACP help");
  process.exit(0);
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index = buffer.indexOf("\\n");
  while (index >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    index = buffer.indexOf("\\n");
    if (line.length > 0) handle(JSON.parse(line));
  }
});

function handle(message) {
  if (message.method === "initialize") {
    write({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: 1,
        agentInfo: { name: "fake-acp", title: "Fake ACP", version: "1.2.3" },
        authMethods: [{ id: "openai", name: "Use OpenAI API key" }],
        agentCapabilities: { loadSession: true, promptCapabilities: { image: true } },
      },
    });
    return;
  }
  if (message.method === "session/new" && process.env.FAKE_ACP_MODE === "auth_required") {
    write({
      jsonrpc: "2.0",
      id: message.id,
      error: {
        code: -32000,
        message: "Authentication required: Use provider CLI to authenticate first.",
      },
    });
    return;
  }
  if (message.method === "session/new") {
    write({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        sessionId: "secret-session-123",
        configOptions: [{
          id: "model",
          category: "model",
          currentValue: "openai/gpt-5.5",
          options: [{ value: "openai/gpt-5.5", name: "GPT 5.5" }],
        }],
      },
    });
    setTimeout(() => write({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "available_commands_update",
          availableCommands: [{ name: "compact", description: "Compact context" }],
        },
      },
    }), 10);
  }
}

function write(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}
`;
}

function fakeCodexProviderSource(): string {
  return `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log("codex-cli 9.9.9");
  process.exit(0);
}
if (args[0] === "app-server" && args.includes("--help")) {
  console.log("Fake Codex app-server help");
  process.exit(0);
}
if (args[0] !== "app-server") {
  process.stderr.write("unexpected fake codex args: " + args.join(" ") + "\\n");
  process.exit(2);
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index = buffer.indexOf("\\n");
  while (index >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    index = buffer.indexOf("\\n");
    if (line.length > 0) handle(JSON.parse(line));
  }
});

function handle(message) {
  if (message.method === "initialize") {
    write({ id: message.id, result: {} });
    return;
  }
  if (message.method === "thread/start") {
    write({ id: message.id, result: { thread: { id: "secret-thread-123", path: "/secret/codex/rollout.jsonl" } } });
    return;
  }
  if (message.method === "review/start") {
    write({ id: message.id, result: { reviewThreadId: "secret-review-thread-456", turn: { id: "secret-turn-789" } } });
    setTimeout(() => write({ method: "turn/started", params: { turn: { id: "secret-turn-789" } } }), 10);
  }
}

function write(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}
`;
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
}

function parseJsonl(text: string): Array<Record<string, any>> {
  return text.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}
