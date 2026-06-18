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

// A fake claude process that ANSWERS our applyConfig control requests: it acks each
// cfg-* control_request with a control_response — success, except a switch to
// bypassPermissions, which it REFUSES (claude's real behaviour on a session not
// launched bypass-capable). Drives the applyConfig ack path.
function fakeAckPlan(): ProviderLaunchPlan {
  const script = [
    'let buf = "";',
    'process.stdin.setEncoding("utf8");',
    'process.stdin.on("data", (chunk) => {',
    "  buf += chunk;",
    "  let i;",
    '  while ((i = buf.indexOf("\\n")) >= 0) {',
    "    const line = buf.slice(0, i);",
    "    buf = buf.slice(i + 1);",
    "    if (!line.trim()) continue;",
    "    let msg; try { msg = JSON.parse(line); } catch (e) { continue; }",
    '    if (msg.type === "control_request" && typeof msg.request_id === "string" && msg.request_id.indexOf("cfg-") === 0) {',
    "      const r = msg.request || {};",
    '      const reject = r.subtype === "set_permission_mode" && r.mode === "bypassPermissions";',
    "      const response = reject",
    '        ? { subtype: "error", request_id: msg.request_id, error: "not launched with --dangerously-skip-permissions" }',
    '        : { subtype: "success", request_id: msg.request_id, response: { mode: r.mode } };',
    '      console.log(JSON.stringify({ type: "control_response", response: response }));',
    "    }",
    "  }",
    "});",
  ].join("\n");
  return {
    command: process.execPath,
    args: ["-e", script],
    env: {},
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

function annotationsFrom(response: Record<string, unknown>): Record<string, unknown> | undefined {
  const inner = (response.response as Record<string, unknown>).response as Record<string, unknown>;
  const updatedInput = inner.updatedInput as Record<string, unknown>;
  return updatedInput.annotations as Record<string, unknown> | undefined;
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

// Spec: docs_v2/specs/multi-step-prompt-navigation.md — a multi-question AskUserQuestion
// surfaces as ONE navigable wizard prompt (all questions ride as `steps`), not one card
// at a time. The user moves back/forth freely and submits every answer together.
test("AskUserQuestion: multi-question surfaces as ONE wizard prompt carrying every step", async () => {
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
    const prompt = await waitFor(() => events[0], "wizard prompt");
    // ONE prompt for the whole batch — not the old one-at-a-time surfacing.
    assert.equal(prompt.steps?.length, 2);
    // Raw question text: the wizard chrome shows the i/N position, so no "(i/N)" prefix.
    assert.equal(prompt.steps?.[0]?.message, "Pick one?");
    assert.equal(prompt.steps?.[1]?.message, "Describe it?");
    assert.ok(!/\(\d+\/\d+\)/.test(prompt.steps?.[0]?.message ?? ""));
    // Top-level fields mirror step 0 (single-view fallback for non-wizard consumers).
    assert.equal(prompt.message, "Pick one?");
    assert.equal(prompt.steps?.[0]?.stepId, "q-0");
    assert.equal(prompt.steps?.[1]?.stepId, "q-1");
  } finally {
    await client.stop();
  }
});

test("AskUserQuestion wizard: stepAnswers (option + Other free-text) reach the answers map in one allow", async () => {
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
    const prompt = await waitFor(() => events[0], "wizard prompt");
    const steps = prompt.steps ?? [];
    await client.write({
      kind: "prompt_answer",
      promptId: prompt.promptId,
      value: "",
      stepAnswers: [
        // A picked option arrives as the option's provider value …
        { stepId: steps[0]?.stepId ?? "", value: steps[0]?.choices?.[0]?.providerValue ?? "" },
        // … and an "Other…" reply as verbatim free text.
        { stepId: steps[1]?.stepId ?? "", value: "맞아, 커스텀으로 갈게" },
      ],
    });
    const response = await waitFor(() => receivedControlResponse(receivedFile), "control_response");
    assert.deepEqual(answersFrom(response), {
      "Pick one?": "A",
      "Describe it?": "맞아, 커스텀으로 갈게",
    });
    // Exactly ONE allow for the whole tool call (no per-question round trips).
    const allows = readFileSync(receivedFile, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((line) => line.type === "control_response");
    assert.equal(allows.length, 1);
  } finally {
    await client.stop();
  }
});

test("AskUserQuestion: a multiSelect question carries multiSelect and records the joined labels", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tide-auq-"));
  const receivedFile = join(dir, "received.jsonl");
  const { events, onEvent } = promptCollector();
  const client = createClaudeStreamJsonClient({
    plan: fakeProviderPlan(
      [
        {
          question: "Pick several?",
          header: "Pick",
          multiSelect: true,
          options: [{ label: "A" }, { label: "B" }, { label: "C" }],
        },
      ],
      receivedFile,
    ),
    threadId: "thread-1",
    runtimeId: "rt-1",
    onEvent,
  });
  try {
    const prompt = await waitFor(() => events[0], "multiSelect prompt");
    assert.equal(prompt.multiSelect, true);
    // The card joins the selected option labels and answers via the free-text path
    // (no STRUCTURED_OPTION_PREFIX), which claude records verbatim as the answer.
    await client.write({ kind: "prompt_answer", promptId: prompt.promptId, value: "A, C" });
    const response = await waitFor(() => receivedControlResponse(receivedFile), "control_response");
    assert.deepEqual(answersFrom(response), { "Pick several?": "A, C" });
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

// Spec: docs_v2/specs/prompt-full-fidelity-fields.md — the question `header` and each
// option's `description`/`preview` must reach the surfaced prompt (previously dropped:
// only `label` survived). A single question stays a plain card (no wizard steps).
test("AskUserQuestion: question header and option description/preview flow into the prompt", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tide-auq-"));
  const receivedFile = join(dir, "received.jsonl");
  const { events, onEvent } = promptCollector();
  const client = createClaudeStreamJsonClient({
    plan: fakeProviderPlan(
      [
        {
          question: "Which auth?",
          header: "Auth method",
          options: [
            { label: "OAuth", description: "Browser sign-in via the provider", preview: "GET /authorize" },
            { label: "API key", description: "Paste a key" },
          ],
        },
      ],
      receivedFile,
    ),
    threadId: "thread-1",
    runtimeId: "rt-1",
    onEvent,
  });
  try {
    const prompt = await waitFor(() => events[0], "question prompt");
    assert.equal(prompt.steps, undefined);
    assert.equal(prompt.header, "Auth method");
    const oauth = prompt.choices?.[0];
    assert.equal(oauth?.label, "OAuth");
    assert.equal(oauth?.description, "Browser sign-in via the provider");
    assert.equal(oauth?.preview, "GET /authorize");
    // An option without a preview omits it (optional field stays absent, not "").
    assert.equal(prompt.choices?.[1]?.description, "Paste a key");
    assert.equal(prompt.choices?.[1]?.preview, undefined);
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

// Spec: docs_v2/specs/claude-bypass-live-capability.md — applyConfig AWAITS the
// control_response so a provider refusal (live switch to bypassPermissions on a
// non-capable session) resolves false, which the runtime port turns into a
// transparent restart instead of a phantom "applied".
test("applyConfig resolves true when acked, false when claude refuses the change", async () => {
  const { onEvent } = promptCollector();
  const client = createClaudeStreamJsonClient({
    plan: fakeAckPlan(),
    threadId: "thread-1",
    runtimeId: "rt-1",
    onEvent,
  });
  try {
    // A non-bypass mode is acked success → applied.
    assert.equal(await client.applyConfig?.({ permissionMode: "acceptEdits" }), true);
    // bypassPermissions is REFUSED on a non-capable session → false (→ restart).
    assert.equal(await client.applyConfig?.({ permissionMode: "bypassPermissions" }), false);
    // A combined change is false if ANY part is refused.
    assert.equal(
      await client.applyConfig?.({ model: "claude-sonnet-4-6", permissionMode: "bypassPermissions" }),
      false,
    );
  } finally {
    await client.stop();
  }
});

test("AskUserQuestion wizard: a step with an empty answer is left unanswered (skipped)", async () => {
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
    const prompt = await waitFor(() => events[0], "wizard prompt");
    const steps = prompt.steps ?? [];
    await client.write({
      kind: "prompt_answer",
      promptId: prompt.promptId,
      value: "",
      stepAnswers: [
        { stepId: steps[0]?.stepId ?? "", value: "" }, // skipped
        { stepId: steps[1]?.stepId ?? "", value: steps[1]?.choices?.[0]?.providerValue ?? "" },
      ],
    });
    const response = await waitFor(() => receivedControlResponse(receivedFile), "control_response");
    assert.deepEqual(answersFrom(response), { "Answered one?": "B" });
  } finally {
    await client.stop();
  }
});

test("AskUserQuestion: a cancel right after the question pairs it with a withdrawal (no ghost)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tide-auq-"));
  const receivedFile = join(dir, "received.jsonl");
  const events: StructuredProviderEvent[] = [];
  // The fake emits the question and IMMEDIATELY withdraws it — both lines land in one
  // stdin chunk. The prompt now surfaces SYNCHRONOUSLY (no setImmediate — deferring on a
  // timer raced the first/only question into never appearing, the "stuck waiting, no card"
  // bug). So the client emits the prompt AND a matching prompt_withdrawn; downstream the
  // withdrawal clears the card deterministically (withdrawProviderPrompt). The invariant:
  // any surfaced prompt that was cancelled is PAIRED with a prompt_withdrawn for the same
  // id — never a prompt left dangling with no withdrawal.
  const request = JSON.stringify({
    type: "control_request",
    request_id: "req-1",
    request: {
      subtype: "can_use_tool",
      tool_name: "AskUserQuestion",
      input: { questions: [{ question: "Q?", header: "Q", options: [{ label: "A" }] }] },
    },
  });
  const cancel = JSON.stringify({ type: "control_cancel_request", request_id: "req-1" });
  const script = [
    'const fs = require("node:fs");',
    `console.log(${JSON.stringify(`${request}\n${cancel}`)});`,
    "setInterval(() => {}, 1000);",
  ].join("\n");
  const client = createClaudeStreamJsonClient({
    plan: {
      command: process.execPath,
      args: ["-e", script],
      env: { TIDE_FAKE_OUT: receivedFile },
      cwd: tmpdir(),
      transport: "claude_stream_json",
      expectedSignalSources: [],
    },
    threadId: "thread-1",
    runtimeId: "rt-1",
    onEvent: (event) => events.push(event),
  });
  try {
    // Wait for both the prompt and its withdrawal to flow through.
    await waitFor(() => events.find((event) => event.kind === "prompt_withdrawn"), "prompt_withdrawn");
    const promptIds = events.filter((e) => e.kind === "prompt").map((e) => (e as { promptState: PromptState }).promptState.promptId);
    const withdrawnIds = new Set(events.filter((e) => e.kind === "prompt_withdrawn").map((e) => (e as { promptId: string }).promptId));
    // Every surfaced prompt is paired with a withdrawal for the same id (net no ghost).
    for (const id of promptIds) {
      assert.equal(withdrawnIds.has(id), true, `prompt ${id} was surfaced without a matching withdrawal`);
    }
  } finally {
    await client.stop();
  }
});

// Spec: docs_v2/specs/prompt-full-fidelity-fields.md Slice 2 — a free-text note (and an echo
// of the chosen option's authored preview) ride back to claude as updatedInput.annotations,
// keyed by question text, additive to `answers`.
test("AskUserQuestion: a note + chosen-option preview reach updatedInput.annotations", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tide-auq-"));
  const receivedFile = join(dir, "received.jsonl");
  const { events, onEvent } = promptCollector();
  const client = createClaudeStreamJsonClient({
    plan: fakeProviderPlan(
      [{ question: "Ship it?", header: "Ship", options: [{ label: "Yes", preview: "deploy.sh" }, { label: "No" }] }],
      receivedFile,
    ),
    threadId: "thread-1",
    runtimeId: "rt-1",
    onEvent,
  });
  try {
    const prompt = await waitFor(() => events[0], "question prompt");
    await client.write({
      kind: "prompt_answer",
      promptId: prompt.promptId,
      value: prompt.choices?.[0]?.providerValue ?? "",
      notes: "only to staging, not prod",
    });
    const response = await waitFor(() => receivedControlResponse(receivedFile), "control_response");
    assert.deepEqual(answersFrom(response), { "Ship it?": "Yes" });
    assert.deepEqual(annotationsFrom(response), {
      "Ship it?": { notes: "only to staging, not prod", preview: "deploy.sh" },
    });
  } finally {
    await client.stop();
  }
});

test("AskUserQuestion: an answer with no note and no option preview carries no annotations", async () => {
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
    const prompt = await waitFor(() => events[0], "question prompt");
    await client.write({
      kind: "prompt_answer",
      promptId: prompt.promptId,
      value: prompt.choices?.[0]?.providerValue ?? "",
    });
    const response = await waitFor(() => receivedControlResponse(receivedFile), "control_response");
    assert.deepEqual(answersFrom(response), { "Ship it?": "Yes" });
    assert.equal(annotationsFrom(response), undefined);
  } finally {
    await client.stop();
  }
});

test("AskUserQuestion wizard: only steps that carry a note are annotated", async () => {
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
    const prompt = await waitFor(() => events[0], "wizard prompt");
    const steps = prompt.steps ?? [];
    await client.write({
      kind: "prompt_answer",
      promptId: prompt.promptId,
      value: "",
      stepAnswers: [
        { stepId: steps[0]?.stepId ?? "", value: steps[0]?.choices?.[0]?.providerValue ?? "", notes: "prefer the LTS one" },
        { stepId: steps[1]?.stepId ?? "", value: steps[1]?.choices?.[0]?.providerValue ?? "" },
      ],
    });
    const response = await waitFor(() => receivedControlResponse(receivedFile), "control_response");
    assert.deepEqual(answersFrom(response), { "Pick one?": "A", "Describe it?": "C" });
    assert.deepEqual(annotationsFrom(response), { "Pick one?": { notes: "prefer the LTS one" } });
  } finally {
    await client.stop();
  }
});

test("interrupt cleanly denies a pending AskUserQuestion (no stream-closed error)", async () => {
  // Spec: waiting-state-recovery. Interrupting/stopping with a tool-permission request in
  // flight used to close the control stream with no response -> claude recorded
  // "Tool permission ... stream closed before response received" and worked around the
  // "broken" tool. interrupt() must DENY the pending request first so claude records a
  // clean cancellation. (A Stop while an AskUserQuestion card is up takes this path.)
  const dir = mkdtempSync(join(tmpdir(), "tide-auq-"));
  const receivedFile = join(dir, "received.jsonl");
  const { events, onEvent } = promptCollector();
  const client = createClaudeStreamJsonClient({
    plan: fakeProviderPlan([{ question: "Pick?", header: "P", options: [{ label: "A" }] }], receivedFile),
    threadId: "thread-1",
    runtimeId: "rt-1",
    onEvent,
  });
  try {
    await waitFor(() => events[0], "AskUserQuestion prompt");
    await client.interrupt();
    const deny = await waitFor(() => {
      if (!existsSync(receivedFile)) return undefined;
      for (const line of readFileSync(receivedFile, "utf8").split("\n")) {
        if (line.trim().length === 0) continue;
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          const inner = (parsed.response as Record<string, unknown> | undefined)?.response as
            | Record<string, unknown>
            | undefined;
          if (parsed.type === "control_response" && inner?.behavior === "deny") return parsed;
        } catch {
          // The fake appends concurrently — ignore a partially written line and retry.
        }
      }
      return undefined;
    }, "deny control_response");
    const response = deny.response as Record<string, unknown>;
    assert.equal(response.request_id, "req-1", "denies the pending request before aborting");
  } finally {
    await client.stop();
  }
});

// A FAKE provider that raises ONE generic (non-AskUserQuestion) tool permission and records
// every stdin line — so a prompt answer's control_response (allow vs deny) can be inspected.
function fakeBashPermissionPlan(receivedFile: string): ProviderLaunchPlan {
  const script = [
    'const fs = require("node:fs");',
    `console.log(${JSON.stringify(
      JSON.stringify({
        type: "control_request",
        request_id: "req-bash-1",
        request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "rm -rf /tmp/victim" } },
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

function behaviorOf(response: Record<string, unknown>): unknown {
  const inner = (response.response as Record<string, unknown>).response as Record<string, unknown>;
  return inner.behavior;
}

test("Skip (empty answer) on a claude permission card DENIES the tool — never silently allows", async () => {
  // Spec: claude-parallel-permission-wedge.md. The Skip button answers with value "" — that
  // used to fall through to the generic-allow branch and RUN the command. An empty /
  // unrecognized answer must deny.
  const dir = mkdtempSync(join(tmpdir(), "tide-perm-"));
  const receivedFile = join(dir, "received.jsonl");
  const { events, onEvent } = promptCollector();
  const client = createClaudeStreamJsonClient({
    plan: fakeBashPermissionPlan(receivedFile),
    threadId: "thread-1",
    runtimeId: "rt-1",
    onEvent,
  });
  try {
    const prompt = await waitFor(() => events[0], "permission prompt");
    assert.equal(prompt.kind, "approval");
    await client.write({ kind: "prompt_answer", promptId: prompt.promptId, value: "" });
    const response = await waitFor(() => receivedControlResponse(receivedFile), "control_response");
    assert.equal(behaviorOf(response), "deny", "an empty (Skip) answer must DENY, not allow");
  } finally {
    await client.stop();
  }
});

test("the explicit allow token allows, and the deny token denies, a claude permission", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tide-perm-"));
  // Allow path.
  {
    const receivedFile = join(dir, "allow.jsonl");
    const { events, onEvent } = promptCollector();
    const client = createClaudeStreamJsonClient({ plan: fakeBashPermissionPlan(receivedFile), threadId: "t", runtimeId: "r", onEvent });
    try {
      const prompt = await waitFor(() => events[0], "permission prompt");
      const allow = prompt.choices?.find((choice) => choice.choiceId === "allow")?.providerValue ?? "";
      await client.write({ kind: "prompt_answer", promptId: prompt.promptId, value: allow });
      const response = await waitFor(() => receivedControlResponse(receivedFile), "control_response");
      assert.equal(behaviorOf(response), "allow");
    } finally {
      await client.stop();
    }
  }
  // Deny path.
  {
    const receivedFile = join(dir, "deny.jsonl");
    const { events, onEvent } = promptCollector();
    const client = createClaudeStreamJsonClient({ plan: fakeBashPermissionPlan(receivedFile), threadId: "t", runtimeId: "r", onEvent });
    try {
      const prompt = await waitFor(() => events[0], "permission prompt");
      const deny = prompt.choices?.find((choice) => choice.choiceId === "deny")?.providerValue ?? "";
      await client.write({ kind: "prompt_answer", promptId: prompt.promptId, value: deny });
      const response = await waitFor(() => receivedControlResponse(receivedFile), "control_response");
      assert.equal(behaviorOf(response), "deny");
    } finally {
      await client.stop();
    }
  }
});
