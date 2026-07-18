// Spec: docs_v2/specs/provider-authoritative-conversation-lifecycle.md

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAcpClient } from "../src/backend/adapters/outbound/agent-runtime/structured/acp-client.ts";
import { createClaudeStreamJsonClient } from "../src/backend/adapters/outbound/agent-runtime/structured/claude-stream-json-client.ts";
import { createCodexAppServerClient } from "../src/backend/adapters/outbound/agent-runtime/structured/codex-app-server-client.ts";
import type { StructuredProviderEvent } from "../src/backend/adapters/outbound/agent-runtime/structured/structured-runtime-events.ts";
import type { ProviderLaunchPlan } from "../src/backend/application/ports/outbound/agent-integration-port.ts";

function fakePlan(script: string, transport: ProviderLaunchPlan["transport"]): ProviderLaunchPlan {
  return {
    command: process.execPath,
    args: ["-e", script],
    env: { ...process.env } as Record<string, string>,
    cwd: mkdtempSync(join(tmpdir(), "tide-delivery-wire-")),
    transport,
  };
}

async function waitFor<T>(probe: () => T | undefined, label: string): Promise<T> {
  const deadline = Date.now() + 3_000;
  for (;;) {
    const value = probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

const jsonlHarness = [
  "let buffer = '';",
  "const send = value => process.stdout.write(JSON.stringify(value) + '\\n');",
  "process.stdin.setEncoding('utf8');",
  "process.stdin.on('data', chunk => { buffer += chunk; let i; while ((i = buffer.indexOf('\\n')) >= 0) { const line = buffer.slice(0, i).trim(); buffer = buffer.slice(i + 1); if (line) handle(JSON.parse(line)); } });",
  "setInterval(() => {}, 1000);",
].join("\n");

test("codex maps deliveryId to clientUserMessageId and preserves interrupted", async () => {
  const script = [
    "function handle(m) {",
    " if (m.method === 'initialize') return send({id:m.id,result:{}});",
    " if (m.method === 'thread/start') return send({id:m.id,result:{thread:{id:'thread-codex'}}});",
    " if (m.method === 'skills/list') return send({id:m.id,result:{data:[]}});",
    " if (m.method === 'turn/start') {",
    "   if (m.params.clientUserMessageId !== 'delivery-codex') return send({id:m.id,error:{message:'missing delivery id'}});",
    "   send({id:m.id,result:{turn:{id:'turn-codex'}}});",
    "   send({method:'turn/started',params:{turn:{id:'turn-codex'}}});",
    "   return send({method:'turn/completed',params:{turn:{id:'turn-codex',status:'interrupted'}}});",
    " }",
    "}",
    jsonlHarness,
  ].join("\n");
  const events: StructuredProviderEvent[] = [];
  const client = createCodexAppServerClient({
    plan: fakePlan(script, "codex_app_server"), threadId: "thread-1", runtimeId: "runtime-1", onEvent: e => events.push(e),
  });
  try {
    await client.ready();
    const dispatch = await client.write({ kind: "composer_input", value: "hello", deliveryId: "delivery-codex" });
    assert.deepEqual(dispatch, { deliveryId: "delivery-codex", state: "acknowledged", providerTurnId: "turn-codex" });
    const terminal = await waitFor(() => events.find((e): e is Extract<StructuredProviderEvent, {kind:"turn_completed"}> => e.kind === "turn_completed"), "codex terminal");
    assert.equal(terminal.status, "interrupted");
    assert.equal(terminal.deliveryId, "delivery-codex");
    assert.equal(terminal.turnId, "turn-codex");
  } finally { await client.stop(); }
});

test("claude writes and acknowledges the same UUID", async () => {
  const script = [
    "function handle(m) {",
    " if (m.type !== 'user') return;",
    " send(m);",
    " send({type:'result',subtype:'success',is_error:false,result:'ok'});",
    "}",
    jsonlHarness,
  ].join("\n");
  const events: StructuredProviderEvent[] = [];
  const client = createClaudeStreamJsonClient({
    plan: fakePlan(script, "claude_stream_json"), threadId: "thread-1", runtimeId: "runtime-1", onEvent: e => events.push(e),
  });
  try {
    await client.ready();
    const dispatch = await client.write({ kind: "composer_input", value: "hello", deliveryId: "delivery-claude" });
    assert.deepEqual(dispatch, { deliveryId: "delivery-claude", state: "acknowledged", providerMessageId: "delivery-claude" });
    assert.ok(events.some(e => e.kind === "delivery_acknowledged" && e.deliveryId === "delivery-claude"));
    const terminal = await waitFor(() => events.find((e): e is Extract<StructuredProviderEvent, {kind:"turn_completed"}> => e.kind === "turn_completed"), "claude terminal");
    assert.equal(terminal.status, "completed");
    assert.equal(terminal.deliveryId, "delivery-claude");
  } finally { await client.stop(); }
});

test("ACP maps deliveryId to messageId and captures userMessageId plus stopReason", async () => {
  const script = [
    "function handle(m) {",
    " if (m.method === 'initialize') return send({jsonrpc:'2.0',id:m.id,result:{}});",
    " if (m.method === 'session/new') return send({jsonrpc:'2.0',id:m.id,result:{sessionId:'session-acp'}});",
    " if (m.method === 'session/prompt') {",
    "   if (m.params.messageId !== 'delivery-acp') return send({jsonrpc:'2.0',id:m.id,error:{message:'missing delivery id'}});",
    "   return send({jsonrpc:'2.0',id:m.id,result:{userMessageId:'provider-user-1',stopReason:'max_tokens'}});",
    " }",
    "}",
    jsonlHarness,
  ].join("\n");
  const events: StructuredProviderEvent[] = [];
  const client = createAcpClient({
    plan: fakePlan(script, "acp"), threadId: "thread-1", runtimeId: "runtime-1", agentId: "opencode", sessionRefKind: "opencode_session", onEvent: e => events.push(e),
  });
  try {
    await client.ready();
    const dispatch = await client.write({ kind: "composer_input", value: "hello", deliveryId: "delivery-acp" });
    assert.deepEqual(dispatch, { deliveryId: "delivery-acp", state: "working_unconfirmed" });
    const ack = await waitFor(() => events.find((e): e is Extract<StructuredProviderEvent, {kind:"delivery_acknowledged"}> => e.kind === "delivery_acknowledged"), "ACP acknowledgement");
    assert.equal(ack.providerMessageId, "provider-user-1");
    const terminal = await waitFor(() => events.find((e): e is Extract<StructuredProviderEvent, {kind:"turn_completed"}> => e.kind === "turn_completed"), "ACP terminal");
    assert.equal(terminal.status, "max_tokens");
    assert.equal(terminal.nativeStatus, "max_tokens");
    assert.equal(terminal.deliveryId, "delivery-acp");
  } finally { await client.stop(); }
});
