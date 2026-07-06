import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createCodexAppServerClient } from "../src/backend/adapters/outbound/agent-runtime/structured/codex-app-server-client.ts";
import type { StructuredProviderEvent } from "../src/backend/adapters/outbound/agent-runtime/structured/structured-runtime-events.ts";
import type { ProviderLaunchPlan } from "../src/backend/application/ports/outbound/agent-integration-port.ts";

function fakeCodexProviderMethodServer(receivedFile: string): ProviderLaunchPlan {
  const script = [
    'const fs = require("node:fs");',
    "const receivedFile = process.env.TIDE_FAKE_OUT;",
    "function send(value) { process.stdout.write(JSON.stringify(value) + \"\\n\"); }",
    "function record(value) { fs.appendFileSync(receivedFile, JSON.stringify(value) + \"\\n\"); }",
    'let buffer = "";',
    'process.stdin.setEncoding("utf8");',
    'process.stdin.on("data", (chunk) => {',
    "  buffer += chunk;",
    "  let index;",
    '  while ((index = buffer.indexOf("\\n")) >= 0) {',
    "    const line = buffer.slice(0, index);",
    "    buffer = buffer.slice(index + 1);",
    "    if (line.trim().length === 0) continue;",
    "    const message = JSON.parse(line);",
    "    record(message);",
    '    if (message.method === "initialize") {',
    "      send({ id: message.id, result: {} });",
    '    } else if (message.method === "thread/start") {',
    '      send({ id: message.id, result: { thread: { id: "codex-thread-1", path: "/tmp/fake-rollout.jsonl" } } });',
    '    } else if (message.method === "skills/list") {',
    "      send({ id: message.id, result: { data: [] } });",
    '    } else if (message.method === "review/start") {',
    '      send({ id: message.id, result: { reviewThreadId: "codex-review-thread-1", turn: { id: "review-turn-1" } } });',
    "    }",
    "  }",
    "});",
    "setInterval(() => {}, 1000);",
  ].join("\n");
  return {
    command: process.execPath,
    args: ["-e", script],
    env: { TIDE_FAKE_OUT: receivedFile },
    cwd: tmpdir(),
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

function recordedRequests(receivedFile: string): Record<string, unknown>[] {
  if (!existsSync(receivedFile)) {
    return [];
  }
  return readFileSync(receivedFile, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

test("codex app-server provider capability sends review/start on the initialized provider thread", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tide-codex-provider-method-"));
  const receivedFile = join(dir, "received.jsonl");
  const events: StructuredProviderEvent[] = [];
  const client = createCodexAppServerClient({
    plan: fakeCodexProviderMethodServer(receivedFile),
    threadId: "thread-1",
    runtimeId: "runtime-1",
    onEvent: (event) => events.push(event),
  });
  try {
    await waitFor(
      () => events.find((event) => event.kind === "session_ref"),
      "codex app-server session ref",
    );
    assert.equal(typeof client.invokeCapability, "function");

    const result = await client.invokeCapability({
      capabilityId: "codex:review",
      invoke: { kind: "provider_method", method: "review/start" },
      params: { target: { kind: "base_branch", baseBranch: "main" }, delivery: "detached" },
    });

    assert.deepEqual(result, {
      status: "handled",
      result: {
        reviewThreadId: "codex-review-thread-1",
        turn: { id: "review-turn-1" },
      },
    });
    const reviewStart = recordedRequests(receivedFile).find((entry) => entry.method === "review/start");
    assert.deepEqual(reviewStart?.params, {
      threadId: "codex-thread-1",
      target: { type: "baseBranch", branch: "main" },
      delivery: "detached",
    });
  } finally {
    await client.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
