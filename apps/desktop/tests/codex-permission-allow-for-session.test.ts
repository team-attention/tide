import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createCodexAppServerClient } from "../src/backend/adapters/outbound/agent-runtime/structured/codex-app-server-client.ts";
import type { StructuredProviderEvent } from "../src/backend/adapters/outbound/agent-runtime/structured/structured-runtime-events.ts";
import type { ProviderLaunchPlan } from "../src/backend/application/ports/outbound/agent-integration-port.ts";
import type { PromptState } from "../src/backend/application/domains/thread/thread.ts";

// Spec: docs_v2/specs/codex-permission-allow-for-session.md — codex's v2 approval decision enum
// natively carries `acceptForSession`; surface it as an "Allow for this session" choice and map
// the answer to `{ decision: "acceptForSession" }`.

// A FAKE codex app-server: emits ONE approval server-request (a given method) and records every
// stdin line so the response { id, result: { decision } } can be inspected.
function fakeApprovalPlan(receivedFile: string, method: string, params: unknown): ProviderLaunchPlan {
  const request = JSON.stringify({ id: 7, method, params });
  const script = [
    'const fs = require("node:fs");',
    `console.log(${JSON.stringify(request)});`,
    'let buf = "";',
    'process.stdin.setEncoding("utf8");',
    'process.stdin.on("data", (chunk) => {',
    "  buf += chunk;",
    "  let i;",
    '  while ((i = buf.indexOf("\\n")) >= 0) {',
    "    const line = buf.slice(0, i);",
    "    buf = buf.slice(i + 1);",
    '    if (line.trim().length > 0) fs.appendFileSync(process.env.TIDE_FAKE_OUT, line + "\\n");',
    "  }",
    "});",
  ].join("\n");
  return {
    command: process.execPath,
    args: ["-e", script],
    env: { TIDE_FAKE_OUT: receivedFile },
    cwd: tmpdir(),
    transport: "codex_app_server",
  };
}

const COMMAND_APPROVAL = { command: "npm test", cwd: "/work", reason: "Run the tests" };
const FILE_CHANGE_APPROVAL = { itemId: "item-1", reason: "Edit config", threadId: "th-1", turnId: "tn-1" };

async function waitFor<T>(probe: () => T | undefined, label: string): Promise<T> {
  const deadline = Date.now() + 15_000;
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

function promptCollector(): { events: PromptState[]; onEvent: (event: StructuredProviderEvent) => void } {
  const events: PromptState[] = [];
  return {
    events,
    onEvent: (event) => {
      if (event.kind === "prompt") {
        events.push(event.promptState);
      }
    },
  };
}

function decisionFromResponse(receivedFile: string): unknown {
  if (!existsSync(receivedFile)) {
    return undefined;
  }
  for (const line of readFileSync(receivedFile, "utf8").split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }
    const parsed = JSON.parse(line) as Record<string, unknown>;
    if (parsed.id === 7 && parsed.result !== undefined) {
      return (parsed.result as Record<string, unknown>).decision;
    }
  }
  return undefined;
}

function makeClient(plan: ProviderLaunchPlan, onEvent: (event: StructuredProviderEvent) => void) {
  return createCodexAppServerClient({ plan, threadId: "thread-1", runtimeId: "runtime-1", onEvent });
}

// T1 — command approval surfaces the session choice.
test("codex command approval surfaces an Allow for this session choice", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tide-codex-afs-"));
  const receivedFile = join(dir, "received.jsonl");
  const { events, onEvent } = promptCollector();
  const client = makeClient(fakeApprovalPlan(receivedFile, "item/commandExecution/requestApproval", COMMAND_APPROVAL), onEvent);
  try {
    const prompt = await waitFor(() => events[0], "approval prompt");
    assert.equal(prompt.kind, "approval");
    assert.equal(prompt.choices?.length, 3);
    assert.equal(prompt.choices?.[0]?.choiceId, "allow");
    assert.equal(prompt.choices?.[2]?.choiceId, "deny");
    const session = prompt.choices?.[1];
    assert.equal(session?.choiceId, "allow_session");
    assert.equal(session?.kind, "allow_always");
    assert.equal(session?.providerValue, "structured:accept_for_session");
    assert.equal(session?.label, "Allow for this session");
    assert.equal(prompt.defaultChoiceId, "allow");
  } finally {
    await client.stop();
  }
});

// T2 — answering it sends decision acceptForSession.
test("Allow for this session sends decision acceptForSession", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tide-codex-afs-"));
  const receivedFile = join(dir, "received.jsonl");
  const { events, onEvent } = promptCollector();
  const client = makeClient(fakeApprovalPlan(receivedFile, "item/commandExecution/requestApproval", COMMAND_APPROVAL), onEvent);
  try {
    const prompt = await waitFor(() => events[0], "approval prompt");
    const session = prompt.choices?.find((choice) => choice.choiceId === "allow_session");
    await client.write({ kind: "prompt_answer", promptId: prompt.promptId, value: session?.providerValue ?? "" });
    const decision = await waitFor(() => decisionFromResponse(receivedFile), "decision response");
    assert.equal(decision, "acceptForSession");
  } finally {
    await client.stop();
  }
});

// T3 — plain Allow is unchanged (regression).
test("plain Allow still sends decision accept", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tide-codex-afs-"));
  const receivedFile = join(dir, "received.jsonl");
  const { events, onEvent } = promptCollector();
  const client = makeClient(fakeApprovalPlan(receivedFile, "item/commandExecution/requestApproval", COMMAND_APPROVAL), onEvent);
  try {
    const prompt = await waitFor(() => events[0], "approval prompt");
    const allow = prompt.choices?.find((choice) => choice.choiceId === "allow");
    await client.write({ kind: "prompt_answer", promptId: prompt.promptId, value: allow?.providerValue ?? "" });
    const decision = await waitFor(() => decisionFromResponse(receivedFile), "decision response");
    assert.equal(decision, "accept");
  } finally {
    await client.stop();
  }
});

// T4 — Deny is unchanged (regression).
test("Deny still sends decision decline", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tide-codex-afs-"));
  const receivedFile = join(dir, "received.jsonl");
  const { events, onEvent } = promptCollector();
  const client = makeClient(fakeApprovalPlan(receivedFile, "item/commandExecution/requestApproval", COMMAND_APPROVAL), onEvent);
  try {
    const prompt = await waitFor(() => events[0], "approval prompt");
    const deny = prompt.choices?.find((choice) => choice.choiceId === "deny");
    await client.write({ kind: "prompt_answer", promptId: prompt.promptId, value: deny?.providerValue ?? "" });
    const decision = await waitFor(() => decisionFromResponse(receivedFile), "decision response");
    assert.equal(decision, "decline");
  } finally {
    await client.stop();
  }
});

// T5 — a fileChange approval also carries the session choice (shared surfaceApproval).
test("codex fileChange approval also offers Allow for this session", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tide-codex-afs-"));
  const receivedFile = join(dir, "received.jsonl");
  const { events, onEvent } = promptCollector();
  const client = makeClient(fakeApprovalPlan(receivedFile, "item/fileChange/requestApproval", FILE_CHANGE_APPROVAL), onEvent);
  try {
    const prompt = await waitFor(() => events[0], "approval prompt");
    assert.equal(
      prompt.choices?.some((choice) => choice.choiceId === "allow_session" && choice.providerValue === "structured:accept_for_session"),
      true,
    );
  } finally {
    await client.stop();
  }
});

// T6 — secure-by-default: Skip (empty answer) / unrecognized value DECLINES, never accepts.
test("Skip (empty answer) on a codex approval DECLINES — never silently accepts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tide-codex-afs-"));
  const receivedFile = join(dir, "received.jsonl");
  const { events, onEvent } = promptCollector();
  const client = makeClient(fakeApprovalPlan(receivedFile, "item/commandExecution/requestApproval", COMMAND_APPROVAL), onEvent);
  try {
    const prompt = await waitFor(() => events[0], "approval prompt");
    await client.write({ kind: "prompt_answer", promptId: prompt.promptId, value: "" });
    const decision = await waitFor(() => decisionFromResponse(receivedFile), "decision response");
    assert.equal(decision, "decline");
  } finally {
    await client.stop();
  }
});
