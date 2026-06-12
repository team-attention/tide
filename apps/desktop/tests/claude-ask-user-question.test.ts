import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createClaudeStreamJsonClient } from "../src/backend/adapters/outbound/agent-runtime/structured/claude-stream-json-client.ts";
import type { StructuredProviderEvent } from "../src/backend/adapters/outbound/agent-runtime/structured/structured-runtime-events.ts";
import type { ProviderLaunchPlan } from "../src/backend/application/ports/outbound/agent-integration-port.ts";
import type { PromptState } from "../src/backend/application/domains/thread/thread.ts";

// AskUserQuestion answer round-trip against a FAKE stdio provider: a node
// child that speaks just enough of the stream-json control protocol — it emits
// one can_use_tool(AskUserQuestion) control_request and appends every stdin
// line it receives to a file the test can read. This pins the regression where
// typed "Other…" free-text answers were silently dropped from the answers map
// (only structured:option:<label> values were recorded), so claude saw
// "The user did not answer the questions".

function fakeProviderPlan(questions: unknown[], receivedFile: string): ProviderLaunchPlan {
  const script = [
    'const fs = require("node:fs");',
    questions.length === 0
      ? ""
      : `console.log(${JSON.stringify(
          JSON.stringify({
            type: "control_request",
            request_id: "req-1",
            request: {
              subtype: "can_use_tool",
              tool_name: "AskUserQuestion",
              input: { questions },
            },
          }),
        )});`,
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
    transport: "claude_stream_json",
    expectedSignalSources: [],
  };
}

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

function receivedControlResponse(receivedFile: string): Record<string, unknown> | undefined {
  if (!existsSync(receivedFile)) {
    return undefined;
  }
  for (const line of readFileSync(receivedFile, "utf8").split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }
    const parsed = JSON.parse(line) as Record<string, unknown>;
    if (parsed.type === "control_response") {
      return parsed;
    }
  }
  return undefined;
}

function answersFrom(response: Record<string, unknown>): Record<string, unknown> {
  const inner = (response.response as Record<string, unknown>).response as Record<string, unknown>;
  assert.equal(inner.behavior, "allow");
  const updatedInput = inner.updatedInput as Record<string, unknown>;
  return updatedInput.answers as Record<string, unknown>;
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

test("AskUserQuestion: typed Other free-text answer reaches the answers map (multi-question)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tide-auq-"));
  const receivedFile = join(dir, "received.jsonl");
  const { events, onEvent } = promptCollector();
  const client = createClaudeStreamJsonClient({
    plan: fakeProviderPlan(
      [
        { question: "Pick one?", header: "Pick", options: [{ label: "A" }, { label: "B" }] },
        { question: "Describe it?", header: "Desc", options: [{ label: "C" }] },
      ],
      receivedFile,
    ),
    threadId: "thread-1",
    runtimeId: "rt-1",
    onEvent,
  });
  try {
    const first = await waitFor(() => events[0], "first question prompt");
    assert.match(first.message, /\(1\/2\) Pick one\?/);
    await client.write({
      kind: "prompt_answer",
      promptId: first.promptId,
      value: first.choices?.[0]?.providerValue ?? "",
    });

    const second = await waitFor(() => events[1], "second question prompt");
    assert.match(second.message, /\(2\/2\) Describe it\?/);
    await client.write({
      kind: "prompt_answer",
      promptId: second.promptId,
      value: "맞아, 커스텀으로 갈게",
    });

    const response = await waitFor(() => receivedControlResponse(receivedFile), "control_response");
    assert.deepEqual(answersFrom(response), {
      "Pick one?": "A",
      "Describe it?": "맞아, 커스텀으로 갈게",
    });
  } finally {
    await client.stop();
  }
});

test("AskUserQuestion: single-question Other free-text answer is delivered", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tide-auq-"));
  const receivedFile = join(dir, "received.jsonl");
  const { events, onEvent } = promptCollector();
  const client = createClaudeStreamJsonClient({
    plan: fakeProviderPlan(
      [{ question: "Ship it?", header: "Ship", options: [{ label: "Yes" }, { label: "No" }] }],
      receivedFile,
    ),
    threadId: "thread-1",
    runtimeId: "rt-1",
    onEvent,
  });
  try {
    const first = await waitFor(() => events[0], "question prompt");
    await client.write({
      kind: "prompt_answer",
      promptId: first.promptId,
      value: "hold until tomorrow",
    });
    const response = await waitFor(() => receivedControlResponse(receivedFile), "control_response");
    assert.deepEqual(answersFrom(response), { "Ship it?": "hold until tomorrow" });
  } finally {
    await client.stop();
  }
});

// Spec: docs_v2/specs/mid-thread-launch-option-changes.md — applyConfig must
// put the SDK-shaped set_model / set_permission_mode control requests on the
// wire (the live mid-thread Launch Options path for a running claude session).
test("applyConfig writes set_permission_mode and set_model control requests", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tide-auq-"));
  const receivedFile = join(dir, "received.jsonl");
  const { onEvent } = promptCollector();
  const client = createClaudeStreamJsonClient({
    plan: fakeProviderPlan([], receivedFile),
    threadId: "thread-1",
    runtimeId: "rt-1",
    onEvent,
  });
  try {
    client.applyConfig?.({ model: "claude-sonnet-4-6", permissionMode: "acceptEdits" });
    const lines = await waitFor(() => {
      if (!existsSync(receivedFile)) {
        return undefined;
      }
      const parsed = readFileSync(receivedFile, "utf8")
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      return parsed.length >= 2 ? parsed : undefined;
    }, "two control_request lines");
    const requests = lines
      .filter((line) => line.type === "control_request")
      .map((line) => line.request as Record<string, unknown>);
    assert.deepEqual(
      requests.map((request) => ({ subtype: request.subtype, model: request.model, mode: request.mode })),
      [
        { subtype: "set_model", model: "claude-sonnet-4-6", mode: undefined },
        { subtype: "set_permission_mode", model: undefined, mode: "acceptEdits" },
      ],
    );
  } finally {
    await client.stop();
  }
});

test("AskUserQuestion: Skip (empty answer) leaves the question unanswered, options still recorded", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tide-auq-"));
  const receivedFile = join(dir, "received.jsonl");
  const { events, onEvent } = promptCollector();
  const client = createClaudeStreamJsonClient({
    plan: fakeProviderPlan(
      [
        { question: "Skipped one?", header: "Skip", options: [{ label: "A" }] },
        { question: "Answered one?", header: "Ans", options: [{ label: "B" }] },
      ],
      receivedFile,
    ),
    threadId: "thread-1",
    runtimeId: "rt-1",
    onEvent,
  });
  try {
    const first = await waitFor(() => events[0], "first question prompt");
    await client.write({ kind: "prompt_answer", promptId: first.promptId, value: "" });
    const second = await waitFor(() => events[1], "second question prompt");
    await client.write({
      kind: "prompt_answer",
      promptId: second.promptId,
      value: second.choices?.[0]?.providerValue ?? "",
    });
    const response = await waitFor(() => receivedControlResponse(receivedFile), "control_response");
    assert.deepEqual(answersFrom(response), { "Answered one?": "B" });
  } finally {
    await client.stop();
  }
});
