import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createClaudeStreamJsonClient } from "../src/backend/adapters/outbound/agent-runtime/structured/claude-stream-json-client.ts";
import {
  addRulesOnlySuggestions,
  buildAllowAlwaysLabel,
} from "../src/backend/adapters/outbound/agent-runtime/structured/claude-stream-json-shared.ts";
import type { StructuredProviderEvent } from "../src/backend/adapters/outbound/agent-runtime/structured/structured-runtime-events.ts";
import type { ProviderLaunchPlan } from "../src/backend/application/ports/outbound/agent-integration-port.ts";
import type { PromptState } from "../src/backend/application/domains/thread/thread.ts";

// Spec: docs_v2/specs/claude-permission-allow-always.md — claude's can_use_tool request carries
// `permission_suggestions`; the pure-addRules variant surfaces as an "Allow always" choice and,
// when picked, is echoed back as `updatedPermissions` so the CLI persists the rule.

// A FAKE provider that raises ONE can_use_tool permission with a caller-supplied `request`
// payload (so we can vary permission_suggestions), and records every stdin line so the answer's
// control_response can be inspected.
function fakePermissionPlan(receivedFile: string, requestObj: unknown): ProviderLaunchPlan {
  const controlRequest = JSON.stringify({
    type: "control_request",
    request_id: "req-perm-1",
    request: requestObj,
  });
  const script = [
    'const fs = require("node:fs");',
    `console.log(${JSON.stringify(controlRequest)});`,
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
  };
}

// Real captured shapes (claude 2.1.186).
const BASH_NPM_TEST = {
  subtype: "can_use_tool",
  tool_name: "Bash",
  input: { command: "npm test", description: "Run npm test" },
  permission_suggestions: [
    {
      type: "addRules",
      rules: [{ toolName: "Bash", ruleContent: "npm test *" }],
      behavior: "allow",
      destination: "localSettings",
    },
  ],
};
const WRITE_SETMODE = {
  subtype: "can_use_tool",
  tool_name: "Write",
  input: { file_path: "/tmp/x.txt", content: "hello" },
  permission_suggestions: [
    { type: "setMode", mode: "acceptEdits", destination: "session" },
    { type: "addDirectories", directories: ["/tmp", "/private/tmp"], destination: "session" },
  ],
};
const BASH_NO_SUGGESTIONS = {
  subtype: "can_use_tool",
  tool_name: "Bash",
  input: { command: "rm -rf /tmp/victim" },
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

// control_response.response.response — the allow/deny decision object claude reads.
function innerResponse(response: Record<string, unknown>): Record<string, unknown> {
  return (response.response as Record<string, unknown>).response as Record<string, unknown>;
}

// T1 — pure addRules suggestion surfaces a third Allow-always choice (kind + token + label).
test("addRules suggestion surfaces an Allow always choice with the CLI rule + scope", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tide-perm-aa-"));
  const receivedFile = join(dir, "received.jsonl");
  const { events, onEvent } = promptCollector();
  const client = createClaudeStreamJsonClient({
    plan: fakePermissionPlan(receivedFile, BASH_NPM_TEST),
    threadId: "t",
    runtimeId: "r",
    onEvent,
  });
  try {
    const prompt = await waitFor(() => events[0], "permission prompt");
    assert.equal(prompt.kind, "approval");
    assert.equal(prompt.choices?.length, 3);
    assert.equal(prompt.choices?.[0]?.choiceId, "allow");
    assert.equal(prompt.choices?.[2]?.choiceId, "deny");
    const always = prompt.choices?.[1];
    assert.equal(always?.choiceId, "allow_always");
    assert.equal(always?.kind, "allow_always");
    assert.equal(always?.providerValue, "structured:allow_always");
    assert.equal(always?.label, "Always allow Bash(npm test *) · this project");
    assert.equal(prompt.defaultChoiceId, "allow");
  } finally {
    await client.stop();
  }
});

// T2 — no suggestions ⇒ unchanged Allow/Deny.
test("a request without permission_suggestions keeps exactly Allow/Deny", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tide-perm-aa-"));
  const receivedFile = join(dir, "received.jsonl");
  const { events, onEvent } = promptCollector();
  const client = createClaudeStreamJsonClient({
    plan: fakePermissionPlan(receivedFile, BASH_NO_SUGGESTIONS),
    threadId: "t",
    runtimeId: "r",
    onEvent,
  });
  try {
    const prompt = await waitFor(() => events[0], "permission prompt");
    assert.equal(prompt.choices?.length, 2);
    assert.equal(
      prompt.choices?.some((choice) => choice.choiceId === "allow_always"),
      false,
    );
  } finally {
    await client.stop();
  }
});

// T3 — defer guard: setMode/addDirectories suggestions do NOT get an Allow-always choice.
test("setMode/addDirectories suggestions do NOT surface an Allow always choice (deferred)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tide-perm-aa-"));
  const receivedFile = join(dir, "received.jsonl");
  const { events, onEvent } = promptCollector();
  const client = createClaudeStreamJsonClient({
    plan: fakePermissionPlan(receivedFile, WRITE_SETMODE),
    threadId: "t",
    runtimeId: "r",
    onEvent,
  });
  try {
    const prompt = await waitFor(() => events[0], "permission prompt");
    assert.equal(prompt.choices?.length, 2);
    assert.equal(
      prompt.choices?.some((choice) => choice.choiceId === "allow_always"),
      false,
    );
  } finally {
    await client.stop();
  }
});

// T4 — answering Allow always echoes the suggestions VERBATIM as updatedPermissions.
test("Allow always echoes the CLI suggestions back as updatedPermissions", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tide-perm-aa-"));
  const receivedFile = join(dir, "received.jsonl");
  const { events, onEvent } = promptCollector();
  const client = createClaudeStreamJsonClient({
    plan: fakePermissionPlan(receivedFile, BASH_NPM_TEST),
    threadId: "t",
    runtimeId: "r",
    onEvent,
  });
  try {
    const prompt = await waitFor(() => events[0], "permission prompt");
    const always = prompt.choices?.find((choice) => choice.choiceId === "allow_always");
    await client.write({ kind: "prompt_answer", promptId: prompt.promptId, value: always?.providerValue ?? "" });
    const response = await waitFor(() => receivedControlResponse(receivedFile), "control_response");
    const inner = innerResponse(response);
    assert.equal(inner.behavior, "allow");
    assert.deepEqual(inner.updatedInput, { command: "npm test", description: "Run npm test" });
    assert.deepEqual(inner.updatedPermissions, BASH_NPM_TEST.permission_suggestions);
  } finally {
    await client.stop();
  }
});

// T5 — plain Allow (once) is unchanged: no updatedPermissions key (regression guard for I2).
test("plain Allow once carries NO updatedPermissions", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tide-perm-aa-"));
  const receivedFile = join(dir, "received.jsonl");
  const { events, onEvent } = promptCollector();
  const client = createClaudeStreamJsonClient({
    plan: fakePermissionPlan(receivedFile, BASH_NPM_TEST),
    threadId: "t",
    runtimeId: "r",
    onEvent,
  });
  try {
    const prompt = await waitFor(() => events[0], "permission prompt");
    const allow = prompt.choices?.find((choice) => choice.choiceId === "allow");
    await client.write({ kind: "prompt_answer", promptId: prompt.promptId, value: allow?.providerValue ?? "" });
    const response = await waitFor(() => receivedControlResponse(receivedFile), "control_response");
    const inner = innerResponse(response);
    assert.equal(inner.behavior, "allow");
    assert.equal("updatedPermissions" in inner, false);
  } finally {
    await client.stop();
  }
});

// T7 — pure helpers: the addRules gate and the label/scope formatting.
test("addRulesOnlySuggestions gates, buildAllowAlwaysLabel formats rule + scope", () => {
  // pure addRules ⇒ returned verbatim
  const s = [
    { type: "addRules", rules: [{ toolName: "Bash", ruleContent: "npm test *" }], destination: "localSettings" },
  ];
  assert.deepEqual(addRulesOnlySuggestions(s), s);
  assert.equal(buildAllowAlwaysLabel(s), "Always allow Bash(npm test *) · this project");

  // WebFetch domain rule + userSettings scope
  assert.equal(
    buildAllowAlwaysLabel([
      { type: "addRules", rules: [{ toolName: "WebFetch", ruleContent: "domain:example.com" }], destination: "userSettings" },
    ]),
    "Always allow WebFetch(domain:example.com) · all projects",
  );

  // multiple rules ⇒ "(+N more)"; session scope
  assert.equal(
    buildAllowAlwaysLabel([
      { type: "addRules", rules: [{ toolName: "Bash", ruleContent: "a *" }, { toolName: "Bash", ruleContent: "b *" }], destination: "session" },
    ]),
    "Always allow Bash(a *) (+1 more) · this session",
  );

  // rule without ruleContent ⇒ bare toolName
  assert.equal(
    buildAllowAlwaysLabel([{ type: "addRules", rules: [{ toolName: "Read" }], destination: "projectSettings" }]),
    "Always allow Read · this project",
  );

  // gate: non-addRules, mixed, empty, missing ⇒ undefined (no Allow-always)
  assert.equal(addRulesOnlySuggestions([{ type: "setMode", mode: "acceptEdits" }]), undefined);
  assert.equal(addRulesOnlySuggestions([{ type: "addRules", rules: [] }, { type: "setMode" }]), undefined);
  assert.equal(addRulesOnlySuggestions([]), undefined);
  assert.equal(addRulesOnlySuggestions(undefined), undefined);
});
