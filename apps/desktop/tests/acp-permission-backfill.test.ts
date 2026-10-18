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
import type { PromptState } from "../src/backend/application/domains/thread/thread.ts";

// vibe-acp (and any ACP agent that omits `toolCall.title`/`content` on a
// permission request) leaves the host showing a useless "Allow this tool?"
// card with no tool name or preview. The ACP client must backfill the
// permission's title/content from the matching `session/update.tool_call`
// block (keyed by `toolCallId`) and link the card to that block via
// `nativeIds`, so the user can see what they are approving. See
// docs_v2/specs/native-agent-runtime-rebuild-plan.md:754.
function fakeAcpScript(permissionToolCall: Record<string, unknown>): string {
  return `
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
let prompted = false;
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
  if (message.method === "session/prompt" && !prompted) {
    prompted = true;
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call-7",
          title: "Edit src/auth.ts",
          content: [{ type: "diff", path: "src/auth.ts", oldText: "return null", newText: "return user" }],
          locations: [{ path: "src/auth.ts" }],
        },
      },
    });
    send({
      jsonrpc: "2.0",
      id: 500,
      method: "session/request_permission",
      params: {
        options: [
          { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
          { optionId: "deny", name: "Deny", kind: "reject_once" },
        ],
        toolCall: ${JSON.stringify(permissionToolCall)},
      },
    });
    return;
  }
  if (message.method === "session/set_config_option") {
    send({ jsonrpc: "2.0", id: message.id, result: {} });
    return;
  }
});
setInterval(() => undefined, 1000);
`;
}

async function waitForPrompt(events: StructuredProviderEvent[]): Promise<PromptState> {
  const deadline = Date.now() + 5000;
  for (;;) {
    const prompt = events.find((event): event is Extract<StructuredProviderEvent, { kind: "prompt" }> => event.kind === "prompt");
    if (prompt !== undefined) return prompt.promptState;
    if (Date.now() > deadline) throw new Error("timed out waiting for prompt event");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test("ACP permission backfills title and detail from the matching tool_call update", async () => {
  const root = fs.mkdtempSync(path.join(tmpdir(), "tide-acp-perm-backfill-"));
  const scriptPath = path.join(root, "fake-acp.cjs");
  // Permission request carries only toolCallId — no title, no content.
  fs.writeFileSync(scriptPath, fakeAcpScript({ toolCallId: "call-7" }));
  const plan: ProviderLaunchPlan = {
    command: process.execPath,
    args: [scriptPath],
    env: {},
    cwd: root,
    transport: "acp",
  };
  const events: StructuredProviderEvent[] = [];
  let client: StructuredRuntimeClient | undefined;
  const captured = new Promise<PromptState>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out")), 5000);
    client = createAcpClient({
      plan,
      agentId: "vibe",
      sessionRefKind: "provider_native",
      threadId: "thread-perm-backfill",
      runtimeId: "runtime-perm-backfill",
      initialPrompt: "edit auth",
      onEvent: (event) => {
        events.push(event);
        if (event.kind === "prompt") {
          clearTimeout(timer);
          resolve(event.promptState);
        }
      },
    });
  });

  try {
    const promptState = await captured;
    // Title must come from the matching tool_call update, not the "Allow this tool?" fallback.
    assert.equal(promptState.message, "Edit src/auth.ts");
    // Detail must be backfilled so the card shows the diff + affected path.
    assert.equal(promptState.detail?.format, "diff");
    assert.match(promptState.detail?.body ?? "", /src\/auth\.ts/);
    assert.deepEqual(promptState.detail?.locations, ["src/auth.ts"]);
  } finally {
    await client?.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("ACP permission links the card to the transcript tool block via nativeIds", async () => {
  const root = fs.mkdtempSync(path.join(tmpdir(), "tide-acp-perm-nativeids-"));
  const scriptPath = path.join(root, "fake-acp.cjs");
  fs.writeFileSync(scriptPath, fakeAcpScript({ toolCallId: "call-7" }));
  const plan: ProviderLaunchPlan = {
    command: process.execPath,
    args: [scriptPath],
    env: {},
    cwd: root,
    transport: "acp",
  };
  const events: StructuredProviderEvent[] = [];
  let client: StructuredRuntimeClient | undefined;
  const captured = new Promise<PromptState>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out")), 5000);
    client = createAcpClient({
      plan,
      agentId: "vibe",
      sessionRefKind: "provider_native",
      threadId: "thread-perm-nativeids",
      runtimeId: "runtime-perm-nativeids",
      initialPrompt: "edit auth",
      onEvent: (event) => {
        events.push(event);
        if (event.kind === "prompt") {
          clearTimeout(timer);
          resolve(event.promptState);
        }
      },
    });
  });

  try {
    const promptState = await captured;
    // nativeIds must carry the callId and structured blockId (the keys the
    // content_record for the tool_call also reports) so the card can be linked
    // to the tool_call block in the transcript.
    assert.equal(promptState.nativeIds?.callId, "call-7");
    assert.equal(
      promptState.nativeIds?.blockId,
      "structured:runtime-perm-nativeids:tool:call-7",
    );
  } finally {
    await client?.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("ACP permission keeps an explicit title even when a matching tool_call exists", async () => {
  const root = fs.mkdtempSync(path.join(tmpdir(), "tide-acp-perm-explicit-"));
  const scriptPath = path.join(root, "fake-acp.cjs");
  // Agent supplies a real title; the backfill must not overwrite it.
  fs.writeFileSync(scriptPath, fakeAcpScript({ toolCallId: "call-7", title: "Run rm -rf /tmp/build" }));
  const plan: ProviderLaunchPlan = {
    command: process.execPath,
    args: [scriptPath],
    env: {},
    cwd: root,
    transport: "acp",
  };
  const events: StructuredProviderEvent[] = [];
  let client: StructuredRuntimeClient | undefined;
  const captured = new Promise<PromptState>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out")), 5000);
    client = createAcpClient({
      plan,
      agentId: "vibe",
      sessionRefKind: "provider_native",
      threadId: "thread-perm-explicit",
      runtimeId: "runtime-perm-explicit",
      initialPrompt: "edit auth",
      onEvent: (event) => {
        events.push(event);
        if (event.kind === "prompt") {
          clearTimeout(timer);
          resolve(event.promptState);
        }
      },
    });
  });

  try {
    const promptState = await captured;
    assert.equal(promptState.message, "Run rm -rf /tmp/build");
  } finally {
    await client?.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
