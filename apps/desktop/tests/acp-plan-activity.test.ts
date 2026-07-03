import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createAcpClient } from "../src/backend/adapters/outbound/agent-runtime/structured/acp-client.ts";
import type {
  StructuredProviderEvent,
  StructuredRuntimeClient,
} from "../src/backend/adapters/outbound/agent-runtime/structured/structured-runtime-events.ts";
import type { ProviderLaunchPlan } from "../src/backend/application/ports/outbound/agent-integration-port.ts";

test("opencode todowrite tool result emits ACP live plan activity", async () => {
  const root = fs.mkdtempSync(path.join(tmpdir(), "tide-acp-plan-"));
  const scriptPath = path.join(root, "fake-acp.cjs");
  fs.writeFileSync(scriptPath, fakeAcpScript());
  const plan: ProviderLaunchPlan = {
    command: process.execPath,
    args: [scriptPath],
    env: {},
    cwd: root,
    transport: "acp",
  };
  const events: StructuredProviderEvent[] = [];
  let client: StructuredRuntimeClient | undefined;
  const liveActivity = new Promise<StructuredProviderEvent>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for live_activity")), 3000);
    client = createAcpClient({
      plan,
      agentId: "opencode",
      sessionRefKind: "opencode_session",
      threadId: "thread-acp-plan",
      runtimeId: "runtime-acp-plan",
      initialPrompt: "make a plan",
      onEvent: (event) => {
        events.push(event);
        if (event.kind === "live_activity") {
          clearTimeout(timer);
          resolve(event);
        }
      },
    });
  });

  try {
    assert.deepEqual(await liveActivity, {
      kind: "live_activity",
      planTotal: 4,
      planCompleted: 1,
    });
  } finally {
    await client?.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("unknown ACP server request returns JSON-RPC error instead of hanging", async () => {
  const root = fs.mkdtempSync(path.join(tmpdir(), "tide-acp-unknown-"));
  const receivedFile = path.join(root, "received.jsonl");
  const scriptPath = path.join(root, "fake-acp.cjs");
  fs.writeFileSync(scriptPath, fakeAcpServerRequestScript(receivedFile, {
    jsonrpc: "2.0",
    id: 99,
    method: "session/future_request",
    params: {},
  }));
  const client = createAcpClient({
    plan: { command: process.execPath, args: [scriptPath], env: {}, cwd: root, transport: "acp" },
    agentId: "opencode",
    sessionRefKind: "opencode_session",
    threadId: "thread-acp-unknown",
    runtimeId: "runtime-acp-unknown",
    onEvent: () => undefined,
  });
  try {
    const response = await waitForAcpResponse(receivedFile, 99);
    assert.equal((response.error as Record<string, unknown>).code, -32601);
    assert.match(String((response.error as Record<string, unknown>).message), /session\/future_request/);
  } finally {
    await client.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("ACP permission request with no choices is cancelled instead of hanging", async () => {
  const root = fs.mkdtempSync(path.join(tmpdir(), "tide-acp-empty-perm-"));
  const receivedFile = path.join(root, "received.jsonl");
  const scriptPath = path.join(root, "fake-acp.cjs");
  fs.writeFileSync(scriptPath, fakeAcpServerRequestScript(receivedFile, {
    jsonrpc: "2.0",
    id: 100,
    method: "session/request_permission",
    params: { options: [], toolCall: { title: "Allow impossible action?" } },
  }));
  const client = createAcpClient({
    plan: { command: process.execPath, args: [scriptPath], env: {}, cwd: root, transport: "acp" },
    agentId: "opencode",
    sessionRefKind: "opencode_session",
    threadId: "thread-acp-empty-perm",
    runtimeId: "runtime-acp-empty-perm",
    onEvent: () => undefined,
  });
  try {
    const response = await waitForAcpResponse(receivedFile, 100);
    assert.deepEqual(response.result, { outcome: { outcome: "cancelled" } });
  } finally {
    await client.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("opencode ACP resume loads the adopted opencode session id", async () => {
  const root = fs.mkdtempSync(path.join(tmpdir(), "tide-acp-resume-"));
  const receivedFile = path.join(root, "received.jsonl");
  const scriptPath = path.join(root, "fake-acp-resume.cjs");
  fs.writeFileSync(scriptPath, fakeAcpResumeScript(receivedFile));
  const client = createAcpClient({
    plan: {
      command: process.execPath,
      args: [scriptPath],
      env: {},
      cwd: root,
      transport: "acp",
      protocolParams: { cwd: root },
    },
    agentId: "opencode",
    sessionRefKind: "opencode_session",
    threadId: "thread-opencode-adopted",
    runtimeId: "runtime-opencode-adopted",
    resumeSessionId: "opencode-session-123",
    onEvent: () => undefined,
  });
  try {
    const request = await waitForAcpRequest(receivedFile, "session/load");
    assert.deepEqual(request.params, {
      sessionId: "opencode-session-123",
      cwd: root,
      mcpServers: [],
    });
  } finally {
    await client.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function fakeAcpScript(): string {
  return `
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const todos = [
  { content: "Step 1", status: "completed" },
  { content: "Step 2", status: "in_progress" },
  { content: "Step 3", status: "pending" },
  { content: "Step 4", status: "pending" },
];
rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: {} });
    return;
  }
  if (message.method === "session/new") {
    send({ jsonrpc: "2.0", id: message.id, result: { sessionId: "session-1" } });
    return;
  }
  if (message.method === "session/prompt") {
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: { update: { sessionUpdate: "tool_call", toolCallId: "todo-1", title: "todowrite" } },
    });
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "todo-1",
          title: "3 todos",
          status: "completed",
          content: [{ content: { text: JSON.stringify(todos) } }],
        },
      },
    });
    send({ jsonrpc: "2.0", id: message.id, result: { stopReason: "end_turn" } });
  }
});
setInterval(() => undefined, 1000);
`;
}

function fakeAcpServerRequestScript(receivedFile: string, request: Record<string, unknown>): string {
  return `
const fs = require("node:fs");
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
send(${JSON.stringify(request)});
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (line.trim().length > 0) fs.appendFileSync(${JSON.stringify(receivedFile)}, line + "\\n");
  }
});
setInterval(() => undefined, 1000);
`;
}

function fakeAcpResumeScript(receivedFile: string): string {
  return `
const fs = require("node:fs");
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
rl.on("line", (line) => {
  if (line.trim().length === 0) return;
  fs.appendFileSync(${JSON.stringify(receivedFile)}, line + "\\n");
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: {} });
    return;
  }
  if (message.method === "session/load") {
    send({ jsonrpc: "2.0", id: message.id, result: { sessionId: message.params.sessionId } });
  }
});
setInterval(() => undefined, 1000);
`;
}

async function waitForAcpResponse(receivedFile: string, id: number): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    if (fs.existsSync(receivedFile)) {
      for (const line of fs.readFileSync(receivedFile, "utf8").split("\n")) {
        if (line.trim().length === 0) continue;
        const parsed = JSON.parse(line) as Record<string, unknown>;
        if (parsed.id === id && (parsed.result !== undefined || parsed.error !== undefined)) {
          return parsed;
        }
      }
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ACP response ${id}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function waitForAcpRequest(receivedFile: string, method: string): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    if (fs.existsSync(receivedFile)) {
      for (const line of fs.readFileSync(receivedFile, "utf8").split("\n")) {
        if (line.trim().length === 0) continue;
        const parsed = JSON.parse(line) as Record<string, unknown>;
        if (parsed.method === method) {
          return parsed;
        }
      }
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ACP request ${method}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
