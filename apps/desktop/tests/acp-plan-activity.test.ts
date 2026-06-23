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
