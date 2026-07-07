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

const COMMAND_APPROVAL = { itemId: "cmd-item-1", command: "npm test", cwd: "/work", reason: "Run the tests" };
const FILE_CHANGE_APPROVAL = { itemId: "item-1", reason: "Edit config", threadId: "th-1", turnId: "tn-1" };
const MCP_ELICITATION = {
  threadId: "codex-thread-1",
  turnId: "codex-turn-1",
  serverName: "codex_apps",
  mode: "form",
  message: 'Allow Notion to run tool "notion.notion-update-page"?',
  _meta: {
    codex_approval_kind: "mcp_tool_call",
    codex_request_type: "approval_request",
    tool_title: "notion-update-page",
    tool_name: "notion.notion-update-page",
    connector_id: "notion",
    connector_name: "Notion",
    tool_params: {
      page_id: "page-1",
      command: "update_properties",
      properties: { Status: "Waiting" },
    },
  },
  requestedSchema: { type: "object", properties: {} },
};
const MCP_ELICITATION_WITH_PERSIST = {
  ...MCP_ELICITATION,
  _meta: {
    ...MCP_ELICITATION._meta,
    persist: ["session", "always"],
  },
};
const MCP_GENERIC_ELICITATION = {
  threadId: "codex-thread-1",
  turnId: "codex-turn-1",
  serverName: "codex_apps",
  mode: "form",
  message: "Continue with this MCP request?",
  requestedSchema: { type: "object", properties: {} },
};

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
  const result = resultFromResponse(receivedFile);
  return result !== undefined ? result.decision : undefined;
}

function resultFromResponse(receivedFile: string): Record<string, unknown> | undefined {
  const response = responseFromFile(receivedFile);
  return response !== undefined && response.result !== undefined
    ? response.result as Record<string, unknown>
    : undefined;
}

function errorFromResponse(receivedFile: string): Record<string, unknown> | undefined {
  const response = responseFromFile(receivedFile);
  return response !== undefined && response.error !== undefined
    ? response.error as Record<string, unknown>
    : undefined;
}

function responseFromFile(receivedFile: string): Record<string, unknown> | undefined {
  if (!existsSync(receivedFile)) {
    return undefined;
  }
  for (const line of readFileSync(receivedFile, "utf8").split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }
    const parsed = JSON.parse(line) as Record<string, unknown>;
    if (parsed.id === 7 && (parsed.result !== undefined || parsed.error !== undefined)) {
      return parsed;
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
    assert.deepEqual(prompt.nativeIds, { itemId: "cmd-item-1", callId: "cmd-item-1" });
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
    assert.deepEqual(prompt.nativeIds, { itemId: "item-1", callId: "item-1" });
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

test("codex MCP tool approval uses native choices and Allow sends action accept", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tide-codex-mcp-elicit-"));
  const receivedFile = join(dir, "received.jsonl");
  const { events, onEvent } = promptCollector();
  const client = makeClient(fakeApprovalPlan(receivedFile, "mcpServer/elicitation/request", MCP_ELICITATION), onEvent);
  try {
    const prompt = await waitFor(() => events[0], "MCP elicitation prompt");
    assert.equal(prompt.kind, "approval");
    assert.equal(prompt.message, 'Allow Notion to run tool "notion.notion-update-page"?');
    assert.equal(prompt.choices?.length, 2);
    assert.deepEqual(
      prompt.choices?.map((choice) => [choice.choiceId, choice.label, choice.providerValue]),
      [
        ["accept", "Allow", "Allow"],
        ["cancel", "Cancel", "Cancel"],
      ],
    );
    assert.equal(prompt.detail?.format, "text");
    assert.match(prompt.detail?.body ?? "", /server: codex_apps/);
    assert.match(prompt.detail?.body ?? "", /connector: Notion/);
    assert.match(prompt.detail?.body ?? "", /tool: notion-update-page/);
    assert.match(prompt.detail?.body ?? "", /"Status": "Waiting"/);
    assert.deepEqual(prompt.nativeIds, {
      connectorId: "notion",
      toolName: "notion.notion-update-page",
    });

    const allow = prompt.choices?.find((choice) => choice.choiceId === "accept");
    await client.write({ kind: "prompt_answer", promptId: prompt.promptId, value: allow?.providerValue ?? "" });
    const result = await waitFor(() => resultFromResponse(receivedFile), "MCP elicitation response");
    assert.deepEqual(result, {
      action: "accept",
      content: {},
      _meta: null,
    });
  } finally {
    await client.stop();
  }
});

test("codex generic MCP elicitation shows readable labels but sends protocol actions", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tide-codex-mcp-elicit-"));
  const receivedFile = join(dir, "received.jsonl");
  const { events, onEvent } = promptCollector();
  const client = makeClient(fakeApprovalPlan(receivedFile, "mcpServer/elicitation/request", MCP_GENERIC_ELICITATION), onEvent);
  try {
    const prompt = await waitFor(() => events[0], "MCP elicitation prompt");
    assert.deepEqual(
      prompt.choices?.map((choice) => [choice.choiceId, choice.label, choice.providerValue]),
      [
        ["accept", "Accept", "accept"],
        ["decline", "Decline", "decline"],
        ["cancel", "Cancel", "cancel"],
      ],
    );

    const decline = prompt.choices?.find((choice) => choice.choiceId === "decline");
    await client.write({ kind: "prompt_answer", promptId: prompt.promptId, value: decline?.providerValue ?? "" });
    const result = await waitFor(() => resultFromResponse(receivedFile), "MCP elicitation response");
    assert.deepEqual(result, {
      action: "decline",
      content: null,
      _meta: null,
    });
  } finally {
    await client.stop();
  }
});

test("codex MCP tool approval only offers session/persistent choices when Codex advertises persist", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tide-codex-mcp-elicit-"));
  const receivedFile = join(dir, "received.jsonl");
  const { events, onEvent } = promptCollector();
  const client = makeClient(fakeApprovalPlan(receivedFile, "mcpServer/elicitation/request", MCP_ELICITATION_WITH_PERSIST), onEvent);
  try {
    const prompt = await waitFor(() => events[0], "MCP elicitation prompt");
    assert.deepEqual(
      prompt.choices?.map((choice) => [choice.choiceId, choice.label, choice.providerValue]),
      [
        ["accept", "Allow", "Allow"],
        ["accept_session", "Allow for this session", "Allow for this session"],
        ["accept_always", "Allow and don't ask me again", "Allow and don't ask me again"],
        ["cancel", "Cancel", "Cancel"],
      ],
    );

    const always = prompt.choices?.find((choice) => choice.choiceId === "accept_always");
    await client.write({ kind: "prompt_answer", promptId: prompt.promptId, value: always?.providerValue ?? "" });
    const result = await waitFor(() => resultFromResponse(receivedFile), "MCP elicitation response");
    assert.deepEqual(result, {
      action: "accept",
      content: {},
      _meta: { persist: "always" },
    });
  } finally {
    await client.stop();
  }
});

test("codex MCP tool approval session choice returns Codex persist session metadata", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tide-codex-mcp-elicit-"));
  const receivedFile = join(dir, "received.jsonl");
  const { events, onEvent } = promptCollector();
  const client = makeClient(fakeApprovalPlan(receivedFile, "mcpServer/elicitation/request", MCP_ELICITATION_WITH_PERSIST), onEvent);
  try {
    const prompt = await waitFor(() => events[0], "MCP elicitation prompt");
    const session = prompt.choices?.find((choice) => choice.choiceId === "accept_session");
    await client.write({ kind: "prompt_answer", promptId: prompt.promptId, value: session?.providerValue ?? "" });
    const result = await waitFor(() => resultFromResponse(receivedFile), "MCP elicitation response");
    assert.deepEqual(result, {
      action: "accept",
      content: {},
      _meta: { persist: "session" },
    });
  } finally {
    await client.stop();
  }
});

test("Skip (empty answer) on a codex MCP elicitation DECLINES instead of hanging", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tide-codex-mcp-elicit-"));
  const receivedFile = join(dir, "received.jsonl");
  const { events, onEvent } = promptCollector();
  const client = makeClient(fakeApprovalPlan(receivedFile, "mcpServer/elicitation/request", MCP_ELICITATION), onEvent);
  try {
    const prompt = await waitFor(() => events[0], "MCP elicitation prompt");
    await client.write({ kind: "prompt_answer", promptId: prompt.promptId, value: "" });
    const result = await waitFor(() => resultFromResponse(receivedFile), "MCP elicitation response");
    assert.deepEqual(result, {
      action: "decline",
      content: null,
      _meta: null,
    });
  } finally {
    await client.stop();
  }
});

test("codex request_user_input surfaces a wizard prompt and returns answers", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tide-codex-user-input-"));
  const receivedFile = join(dir, "received.jsonl");
  const { events, onEvent } = promptCollector();
  const client = makeClient(fakeApprovalPlan(receivedFile, "item/tool/requestUserInput", {
    threadId: "codex-thread-1",
    turnId: "codex-turn-1",
    itemId: "item-1",
    autoResolutionMs: null,
    questions: [
      { id: "status", header: "Status", question: "Pick status", isOther: false, isSecret: false, options: [{ label: "Waiting", description: "Follow-up later" }] },
      { id: "note", header: "Note", question: "Add note", isOther: true, isSecret: false, options: null },
    ],
  }), onEvent);
  try {
    const prompt = await waitFor(() => events[0], "request_user_input prompt");
    assert.equal(prompt.kind, "choice");
    assert.deepEqual(prompt.nativeIds, { itemId: "item-1", callId: "item-1" });
    assert.equal(prompt.steps?.length, 2);
    assert.equal(prompt.steps?.[0]?.stepId, "status");
    assert.equal(prompt.steps?.[1]?.stepId, "note");
    const value = prompt.steps?.[0]?.choices?.[0]?.providerValue ?? "";
    await client.write({
      kind: "prompt_answer",
      promptId: prompt.promptId,
      value: "",
      stepAnswers: [
        { stepId: "status", value },
        { stepId: "note", value: "Applied 2026-07-02" },
      ],
    });
    const result = await waitFor(() => resultFromResponse(receivedFile), "request_user_input response");
    assert.deepEqual(result, {
      answers: {
        status: { answers: ["Waiting"] },
        note: { answers: ["Applied 2026-07-02"] },
      },
    });
  } finally {
    await client.stop();
  }
});

test("codex dynamic tool and permission server requests fail closed instead of hanging", async () => {
  const cases: Array<{ method: string; params: unknown; assertResult: (result: Record<string, unknown>) => void }> = [
    {
      method: "item/tool/call",
      params: { threadId: "t", turnId: "turn", callId: "call-1", namespace: "tide", tool: "future_tool", arguments: {} },
      assertResult: (result) => {
        assert.equal(result.success, false);
        assert.match(JSON.stringify(result.contentItems), /future_tool/);
      },
    },
    {
      method: "item/permissions/requestApproval",
      params: { threadId: "t", turnId: "turn", itemId: "i", environmentId: null, startedAtMs: 1, cwd: "/repo", reason: "need more", permissions: {} },
      assertResult: (result) => {
        assert.deepEqual(result.permissions, {});
        assert.equal(result.scope, "turn");
        assert.equal(result.strictAutoReview, true);
      },
    },
  ];
  for (const entry of cases) {
    const dir = mkdtempSync(join(tmpdir(), "tide-codex-fail-closed-"));
    const receivedFile = join(dir, "received.jsonl");
    const client = makeClient(fakeApprovalPlan(receivedFile, entry.method, entry.params), () => undefined);
    try {
      const result = await waitFor(() => resultFromResponse(receivedFile), `${entry.method} response`);
      entry.assertResult(result);
    } finally {
      await client.stop();
    }
  }
});

test("unsupported codex server requests return JSON-RPC errors instead of hanging", async () => {
  for (const method of ["account/chatgptAuthTokens/refresh", "attestation/generate", "future/serverRequest"]) {
    const dir = mkdtempSync(join(tmpdir(), "tide-codex-unsupported-"));
    const receivedFile = join(dir, "received.jsonl");
    const client = makeClient(fakeApprovalPlan(receivedFile, method, {}), () => undefined);
    try {
      const error = await waitFor(() => errorFromResponse(receivedFile), `${method} error response`);
      assert.equal(error.code, -32601);
      assert.match(String(error.message), new RegExp(method.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    } finally {
      await client.stop();
    }
  }
});

test("legacy codex approval requests still surface prompts and answer ReviewDecision", async () => {
  const cases = [
    {
      method: "execCommandApproval",
      params: { conversationId: "c", callId: "call-1", approvalId: "a", command: ["npm", "test"], cwd: "/repo", reason: "verify", parsedCmd: [] },
      expectedMessage: /Run command/,
      expectedDecision: "approved_for_session",
    },
    {
      method: "applyPatchApproval",
      params: { conversationId: "c", callId: "call-2", fileChanges: { "src/app.ts": { type: "add" } }, reason: "edit", grantRoot: null },
      expectedMessage: /Apply patch/,
      expectedDecision: "approved_for_session",
    },
  ];
  for (const entry of cases) {
    const dir = mkdtempSync(join(tmpdir(), "tide-codex-legacy-"));
    const receivedFile = join(dir, "received.jsonl");
    const { events, onEvent } = promptCollector();
    const client = makeClient(fakeApprovalPlan(receivedFile, entry.method, entry.params), onEvent);
    try {
      const prompt = await waitFor(() => events[0], `${entry.method} prompt`);
      assert.match(prompt.message, entry.expectedMessage);
      const session = prompt.choices?.find((choice) => choice.choiceId === "allow_session");
      await client.write({ kind: "prompt_answer", promptId: prompt.promptId, value: session?.providerValue ?? "" });
      const result = await waitFor(() => resultFromResponse(receivedFile), `${entry.method} response`);
      assert.equal(result.decision, entry.expectedDecision);
    } finally {
      await client.stop();
    }
  }
});
