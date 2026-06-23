import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  codexRateLimitsFromUsage,
  codexToolCallRecordFromItem,
  codexTurnInput,
} from "../src/backend/adapters/outbound/agent-runtime/structured/codex-app-server-client.ts";
import {
  acpPromptBlocks,
  acpUsageFromRecord,
} from "../src/backend/adapters/outbound/agent-runtime/structured/acp-client.ts";
import {
  claudeUsage,
  claudeUserContent,
} from "../src/backend/adapters/outbound/agent-runtime/structured/claude-stream-json-client.ts";
import { rateLimitsFromProviderRecord } from "../src/backend/application/domains/agent-runtime/rate-limit-usage.ts";

// A 1x1 PNG.
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

test("codex turn input carries a NATIVE localImage item per attachment (not just path text)", () => {
  // Codex has no file-read tool, so the "[Attached image: <path>]" text alone is
  // invisible to it — the localImage item is what lets it see the image.
  const input = codexTurnInput("look at this", [
    { path: "/work/.tide/attachments/shot.png", mediaType: "image/png" },
  ]);
  assert.deepEqual(input, [
    { type: "text", text: "look at this" },
    { type: "localImage", path: "/work/.tide/attachments/shot.png" },
  ]);
});

test("codex turn input with no attachments is exactly the text item (no regression)", () => {
  assert.deepEqual(codexTurnInput("hi"), [{ type: "text", text: "hi" }]);
  assert.deepEqual(codexTurnInput("hi", []), [{ type: "text", text: "hi" }]);
});

test("codex app-server token usage parses 5h and weekly rate limits", () => {
  assert.deepEqual(
    codexRateLimitsFromUsage({
      rateLimits: {
        primary: { usedPercent: 58, windowMinutes: 300, resetsAt: 1781973894 },
        secondary: { usedPercent: 68, windowMinutes: 10080, resetsAt: 1782378364 },
      },
    }),
    [
      { usedPercent: 58, windowMinutes: 300, resetsAt: 1781973894 },
      { usedPercent: 68, windowMinutes: 10080, resetsAt: 1782378364 },
    ],
  );
});

test("provider rate-limit parser accepts common provider quota shapes", () => {
  assert.deepEqual(
    rateLimitsFromProviderRecord({
      quota: {
        limits: [
          { name: "5h", percent_used: "12.5", window: "5h", reset_at: "1781973894000" },
          { name: "weekly", used: 34, limit: 100, window: "1w" },
        ],
      },
    }),
    [
      { label: "5h", usedPercent: 12.5, windowMinutes: 300, resetsAt: 1781973894 },
      { label: "weekly", usedPercent: 34, windowMinutes: 10080 },
    ],
  );
});

test("claude rate_limit_event usage parses provider limits", () => {
  assert.deepEqual(
    claudeUsage({
      type: "rate_limit_event",
      rate_limits: {
        primary: { used_percent: 44, window_minutes: 300 },
        secondary: { used_percent: 72, window_minutes: 10080 },
      },
    }),
    {
      rateLimits: [
        { usedPercent: 44, windowMinutes: 300 },
        { usedPercent: 72, windowMinutes: 10080 },
      ],
    },
  );
});

test("ACP usage parses quota token_count plus provider limits", () => {
  assert.deepEqual(
    acpUsageFromRecord({
      stopReason: "end_turn",
      _meta: {
        quota: {
          token_count: { input_tokens: 1200, output_tokens: 300 },
          rateLimits: {
            primary: { usedPercent: 40, windowMinutes: 300 },
            secondary: { usedPercent: 55, windowMinutes: 10080 },
          },
        },
      },
    }),
    {
      inputTokens: 1200,
      outputTokens: 300,
      rateLimits: [
        { usedPercent: 40, windowMinutes: 300 },
        { usedPercent: 55, windowMinutes: 10080 },
      ],
    },
  );
});

test("codex app-server item started surfaces a pending MCP tool row", () => {
  const record = codexToolCallRecordFromItem({
    runtimeId: "runtime-1",
    sequence: 7,
    status: "pending",
    item: {
      type: "mcpToolCall",
      id: "call-github-pr",
      server: "github",
      tool: "_create_pull_request",
      arguments: { repository_full_name: "team-attention/tide", head: "new" },
    },
  });

  assert.equal(record?.sourceRef, "structured:runtime-1:7:call-github-pr");
  assert.deepEqual(record?.payload, {
    type: "tool_call",
    toolName: "github._create_pull_request",
    callId: "call-github-pr",
    arguments: "{\"repository_full_name\":\"team-attention/tide\",\"head\":\"new\"}",
    body: "{\"repository_full_name\":\"team-attention/tide\",\"head\":\"new\"}",
    status: "pending",
    blockId: "structured:runtime-1:7:call-github-pr",
    sourceRuntimeId: "runtime-1",
  });
});

test("codex app-server item completed reuses the pending tool row block id", () => {
  const item = {
    type: "webSearch",
    id: "search-1",
    query: "site:github.com/team-attention/tide/pull new",
  };
  const pending = codexToolCallRecordFromItem({
    runtimeId: "runtime-1",
    sequence: 8,
    status: "pending",
    item,
  });
  const completed = codexToolCallRecordFromItem({
    runtimeId: "runtime-1",
    sequence: 8,
    status: "complete",
    item,
  });

  assert.equal(pending?.payload.blockId, completed?.payload.blockId);
  assert.equal(completed?.payload.status, "complete");
});

test("codex app-server item without an id still gets a stable tool row id", () => {
  const item = {
    type: "commandExecution",
    command: "npm run typecheck",
  };
  const pending = codexToolCallRecordFromItem({
    runtimeId: "runtime-1",
    sequence: 9,
    status: "pending",
    item,
  });
  const completed = codexToolCallRecordFromItem({
    runtimeId: "runtime-1",
    sequence: 9,
    status: "complete",
    item,
  });

  assert.equal(pending?.itemId, "command:npm run typecheck");
  assert.equal(pending?.payload.blockId, completed?.payload.blockId);
  assert.equal(completed?.payload.callId, pending?.payload.callId);
});

test("ACP prompt blocks carry a NATIVE image ContentBlock (base64) per attachment", () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-img-"));
  try {
    const path = join(dir, "shot.png");
    writeFileSync(path, Buffer.from(PNG_B64, "base64"));
    const blocks = acpPromptBlocks("see this", [{ path, mediaType: "image/png" }]);
    assert.equal(blocks.length, 2);
    assert.deepEqual(blocks[0], { type: "text", text: "see this" });
    assert.equal(blocks[1].type, "image");
    assert.equal(blocks[1].mimeType, "image/png");
    assert.equal(blocks[1].data, PNG_B64); // file read → base64
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ACP prompt blocks with no attachments are exactly the text block (no regression)", () => {
  assert.deepEqual(acpPromptBlocks("hi"), [{ type: "text", text: "hi" }]);
});

test("ACP skips an unreadable attachment rather than failing the turn", () => {
  const blocks = acpPromptBlocks("hi", [{ path: "/no/such/file.png", mediaType: "image/png" }]);
  assert.deepEqual(blocks, [{ type: "text", text: "hi" }]);
});

test("claude content carries a NATIVE inline base64 image block + strips the path marker", () => {
  // Claude gets the image INLINE on the wire (verified accepted by stream-json) —
  // no file read, so the "[Attached image: <path>]" marker is stripped.
  const dir = mkdtempSync(join(tmpdir(), "claude-img-"));
  try {
    const path = join(dir, "shot.png");
    writeFileSync(path, Buffer.from(PNG_B64, "base64"));
    const content = claudeUserContent("look at this\n\n[Attached image: " + path + "]", [
      { path, mediaType: "image/png" },
    ]);
    assert.equal(content.length, 2);
    assert.deepEqual(content[0], { type: "text", text: "look at this" }); // marker stripped
    assert.equal(content[1].type, "image");
    assert.deepEqual(content[1].source, { type: "base64", media_type: "image/png", data: PNG_B64 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("claude content with no attachments is exactly the text block (no regression, no strip)", () => {
  assert.deepEqual(claudeUserContent("hello"), [{ type: "text", text: "hello" }]);
  // No attachments → the marker regex never runs, body untouched.
  assert.deepEqual(claudeUserContent("a [Attached image: x] b"), [
    { type: "text", text: "a [Attached image: x] b" },
  ]);
});

test("claude image-only message (no text) sends just the image block", () => {
  const dir = mkdtempSync(join(tmpdir(), "claude-img2-"));
  try {
    const path = join(dir, "only.png");
    writeFileSync(path, Buffer.from(PNG_B64, "base64"));
    const content = claudeUserContent("[Attached image: " + path + "]", [
      { path, mediaType: "image/png" },
    ]);
    assert.equal(content.length, 1);
    assert.equal(content[0].type, "image");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
