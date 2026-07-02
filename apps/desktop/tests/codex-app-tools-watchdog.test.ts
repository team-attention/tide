import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createCodexAppServerClient,
  isCodexAppsMcpToolItem,
} from "../src/backend/adapters/outbound/agent-runtime/structured/codex-app-server-client.ts";
import type { StructuredProviderEvent } from "../src/backend/adapters/outbound/agent-runtime/structured/structured-runtime-events.ts";
import type { ProviderLaunchPlan } from "../src/backend/application/ports/outbound/agent-integration-port.ts";

function fakeStuckCodexAppsToolServer(receivedFile: string): ProviderLaunchPlan {
  const stuckItem = {
    type: "mcpToolCall",
    id: "call-stuck",
    server: "codex_apps",
    tool: "notion.notion-update-page",
    arguments: { page_id: "page-1", command: "update_properties" },
  };
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
    '    } else if (message.method === "turn/start") {',
    '      send({ id: message.id, result: { turn: { id: "turn-stuck-1" } } });',
    `      send({ method: "item/started", params: { item: ${JSON.stringify(stuckItem)} } });`,
    '    } else if (message.method === "turn/interrupt") {',
    "      send({ id: message.id, result: {} });",
    '      send({ method: "turn/completed", params: { turn: { id: "turn-stuck-1", status: "interrupted" } } });',
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

test("codex app-server stalled notice does not interrupt a stuck codex_apps tool", async () => {
  const previousTimeout = process.env.TIDE_CODEX_APPS_STALLED_NOTICE_MS;
  process.env.TIDE_CODEX_APPS_STALLED_NOTICE_MS = "25";
  const dir = mkdtempSync(join(tmpdir(), "tide-codex-app-watchdog-"));
  const receivedFile = join(dir, "received.jsonl");
  const events: StructuredProviderEvent[] = [];
  const client = createCodexAppServerClient({
    plan: fakeStuckCodexAppsToolServer(receivedFile),
    threadId: "thread-1",
    runtimeId: "runtime-1",
    initialPrompt: "update notion",
    onEvent: (event) => events.push(event),
  });
  try {
    const pending = await waitFor(
      () =>
        events.find(
          (event) =>
            event.kind === "content_record" &&
            event.payload.type === "tool_call" &&
            event.payload.status === "pending",
        ),
      "pending stuck tool row",
    );
    assert.equal(pending.payload.toolName, "codex_apps.notion.notion-update-page");
    assert.equal(pending.payload.blockId, "structured:runtime-1:0:call-stuck");

    const notice = await waitFor(
      () =>
        events.find(
          (event) =>
            event.kind === "runtime_notice" &&
            event.message.includes("codex_apps.notion.notion-update-page has not returned after 25ms"),
        ),
      "stalled connector notice",
    );
    assert.equal(notice.kind, "runtime_notice");
    assert.equal(
      events.some((event) => event.kind === "content_record" && event.payload.status === "failed"),
      false,
    );
    assert.equal(
      recordedRequests(receivedFile).some((entry) => entry.method === "turn/interrupt"),
      false,
    );

    await client.interrupt();
    const failed = await waitFor(
      () =>
        events.find(
          (event) =>
            event.kind === "content_record" &&
            event.payload.type === "tool_call" &&
            event.payload.status === "failed",
        ),
      "failed stuck tool row",
    );
    assert.equal(failed.payload.toolName, "codex_apps.notion.notion-update-page");
    assert.equal(failed.payload.blockId, "structured:runtime-1:0:call-stuck");
    assert.match(String(failed.payload.body), /did not return before the Codex turn was interrupted/);

    await waitFor(() => events.find((event) => event.kind === "turn_completed"), "turn completion");
    const interrupt = await waitFor(
      () => recordedRequests(receivedFile).find((entry) => entry.method === "turn/interrupt"),
      "turn interrupt request",
    );
    assert.deepEqual(interrupt.params, {
      threadId: "codex-thread-1",
      turnId: "turn-stuck-1",
    });
  } finally {
    await client.stop();
    if (previousTimeout === undefined) {
      delete process.env.TIDE_CODEX_APPS_STALLED_NOTICE_MS;
    } else {
      process.env.TIDE_CODEX_APPS_STALLED_NOTICE_MS = previousTimeout;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test("codex_apps MCP detection covers the app-server connector namespace only", () => {
  assert.equal(
    isCodexAppsMcpToolItem({
      type: "mcpToolCall",
      server: "codex_apps",
      tool: "github._create_pull_request",
    }),
    true,
  );
  assert.equal(
    isCodexAppsMcpToolItem({
      type: "mcpToolCall",
      server: "github",
      tool: "_create_pull_request",
    }),
    false,
  );
});
