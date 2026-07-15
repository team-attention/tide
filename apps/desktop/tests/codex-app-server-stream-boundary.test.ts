import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createCodexAppServerClient } from "../src/backend/adapters/outbound/agent-runtime/structured/codex-app-server-client.ts";
import type { StructuredProviderEvent } from "../src/backend/adapters/outbound/agent-runtime/structured/structured-runtime-events.ts";
import type { ProviderLaunchPlan } from "../src/backend/application/ports/outbound/agent-integration-port.ts";

function fakeCodexStreamingBoundaryServer(): ProviderLaunchPlan {
  const script = [
    "let buffer = '';",
    "let turn = 0;",
    "function send(value) { process.stdout.write(JSON.stringify(value) + '\\n'); }",
    "function handle(message) {",
    "  if (message.method === 'initialize') {",
    "    send({ id: message.id, result: {} });",
    "    return;",
    "  }",
    "  if (message.method === 'thread/start') {",
    "    send({ id: message.id, result: { thread: { id: 'codex-thread-1', path: '/tmp/fake-codex.jsonl' } } });",
    "    return;",
    "  }",
    "  if (message.method === 'skills/list') {",
    "    send({ id: message.id, result: { data: [] } });",
    "    return;",
    "  }",
    "  if (message.method === 'turn/start') {",
    "    turn += 1;",
    "    const turnId = `turn-${turn}`;",
    "    send({ id: message.id, result: { turn: { id: turnId } } });",
    "    send({ method: 'turn/started', params: { turn: { id: turnId } } });",
    "    if (turn === 1) {",
    "      send({ method: 'item/agentMessage/delta', params: { itemId: 'reused-item', delta: 'old answer' } });",
    "      setTimeout(() => send({ method: 'turn/completed', params: { turn: { id: turnId, status: 'completed' } } }), 120);",
    "    } else {",
    "      send({ method: 'item/agentMessage/delta', params: { itemId: 'reused-item', delta: 'new answer' } });",
    "    }",
    "  }",
    "}",
    "process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', (chunk) => {",
    "  buffer += chunk;",
    "  let index;",
    "  while ((index = buffer.indexOf('\\n')) >= 0) {",
    "    const line = buffer.slice(0, index).trim();",
    "    buffer = buffer.slice(index + 1);",
    "    if (line.length > 0) handle(JSON.parse(line));",
    "  }",
    "});",
    "setInterval(() => {}, 1000);",
  ].join("\n");
  return {
    command: process.execPath,
    args: ["-e", script],
    env: {},
    cwd: mkdtempSync(join(tmpdir(), "tide-codex-stream-boundary-")),
    transport: "codex_app_server",
  };
}

async function waitFor<T>(probe: () => T | undefined, label: string): Promise<T> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const value = probe();
    if (value !== undefined) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test("codex app-server clears unfinished streaming text at turn boundaries", async () => {
  const events: StructuredProviderEvent[] = [];
  const client = createCodexAppServerClient({
    plan: fakeCodexStreamingBoundaryServer(),
    threadId: "thread-1",
    runtimeId: "runtime-1",
    onEvent: (event) => events.push(event),
  });
  try {
    await waitFor(
      () => events.find((event) => event.kind === "session_ref"),
      "session ref",
    );

    await client.write({ kind: "composer_input", value: "first turn" });
    await waitFor(
      () => events.find((event) => event.kind === "content_delta" && event.body === "old answer"),
      "first streamed answer",
    );
    await waitFor(
      () => events.find((event) => event.kind === "turn_completed"),
      "first turn completion",
    );

    await client.write({ kind: "composer_input", value: "second turn" });
    const secondDelta = await waitFor(
      () => {
        const deltas = events.filter((event): event is Extract<StructuredProviderEvent, { kind: "content_delta" }> =>
          event.kind === "content_delta",
        );
        return deltas.find((event) => event.body.includes("new answer"));
      },
      "second streamed answer",
    );

    assert.equal(secondDelta.body, "new answer");
    assert.ok(
      !secondDelta.body.includes("old answer"),
      "the previous turn's unfinished stream text must not seed the next turn",
    );
  } finally {
    await client.stop();
  }
});
