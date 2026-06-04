// Spec: docs_v2/specs/agent-session-block-rendering-path.md

import assert from "node:assert/strict";
import test from "node:test";

import {
  compareAgentSessionBlocks,
  createLocalUserMessageBlock,
  type AgentSessionBlock,
} from "../src/backend/application/domains/agent-session/agent-session-block.ts";
import type { RawAgentFrame } from "../src/backend/application/domains/agent-session/raw-agent-frame.ts";
import type { ThreadSnapshot } from "../src/backend/application/domains/thread/thread.ts";
import { createFixtureAgentSessionReader } from "../src/backend/application/services/fixture-agent-session-reader.ts";
import {
  createAgentSessionBlockCompletedEventFromUpdate,
  createAgentSessionBlockUpsertedEventFromBlock,
  toAgentSessionBlockDto,
} from "../src/backend/adapters/outbound/desktop-contract/agent-session-block-event-adapter.ts";
import { validateBackendEventEnvelope } from "../src/shared/contracts/index.ts";

const now = "2026-05-27T00:00:00.000Z";
const later = "2026-05-27T00:00:01.000Z";
const thread = threadSnapshot("thread-render");

// --- UC-1: Render structured provider evidence ---

test("structured_message_events_render_as_conversation_blocks", () => {
  // UC-1 BR-1: A structured fixture message frame emits a user or agent message block.
  const reader = createFixtureAgentSessionReader();
  const result = reader.read({
    thread,
    agentBinding: thread.agentBinding,
    frames: [
      frame("frame-message", {
        payload: {
          type: "message",
          role: "agent",
          body: "Implemented the rendering path.",
        },
      }),
    ],
    existingBlocks: [],
  });

  const block = onlyUpsertedBlock(result.blockUpdates);
  assert.equal(block.kind, "agent_message");
  assert.equal(block.role, "agent");
  assert.equal(block.body, "Implemented the rendering path.");
  assert.deepEqual(block.sourceFrameIds, ["frame-message"]);

  const event = createAgentSessionBlockUpsertedEventFromBlock({
    eventId: "evt-message",
    requestId: "req-message",
    emittedAt: later,
    block,
  });

  assert.equal(event.kind, "agentSessionBlock.upserted");
  assert.equal(validateBackendEventEnvelope(event).ok, true);
  assert.equal(event.payload.block.agentId, "codex");
  assert.deepEqual(event.payload.block.sourceFrameIds, ["frame-message"]);
});

test("unknown_structured_events_render_as_raw_blocks", () => {
  // UC-1 BR-3: Unknown structured events become visible raw blocks.
  const reader = createFixtureAgentSessionReader();
  const result = reader.read({
    thread,
    agentBinding: thread.agentBinding,
    frames: [
      frame("frame-unknown", {
        payload: {
          type: "provider_future_event",
          visible: "keep this provider output",
        },
      }),
    ],
    existingBlocks: [],
  });

  const block = onlyUpsertedBlock(result.blockUpdates);
  assert.equal(block.kind, "raw_block");
  assert.equal(block.role, "runtime");
  assert.match(block.rawFallback ?? "", /keep this provider output/);
});

test("consumed_hook_signal_frames_do_not_render_as_raw_blocks", () => {
  // UC-1 BR-3b: a hook_payload frame with no resolved prompt is carried as a
  // consumed `provider_signal` envelope and must NOT render as a visible block.
  const reader = createFixtureAgentSessionReader();
  const result = reader.read({
    thread,
    agentBinding: thread.agentBinding,
    frames: [
      frame("frame-hook-signal", {
        source: "hook_payload",
        payload: {
          type: "provider_signal",
          eventName: "UserPromptSubmit",
          payload: {
            session_id: "abc",
            transcript_path: "/tmp/x.jsonl",
            hook_event_name: "UserPromptSubmit",
          },
        },
      }),
    ],
    existingBlocks: [],
  });

  assert.equal(result.blockUpdates.length, 0, "consumed signal frame emits no block");
});

test("structured_tool_events_render_as_tool_blocks", () => {
  // UC-1 BR-2: Known tool events become tool/action blocks.
  const reader = createFixtureAgentSessionReader();
  const result = reader.read({
    thread,
    agentBinding: thread.agentBinding,
    frames: [
      frame("frame-tool-call", {
        payload: {
          type: "tool_call",
          toolName: "tide_observe_thread",
          callId: "call-1",
          arguments: { detail: "compact" },
          body: "tide_observe_thread {\"detail\":\"compact\"}",
        },
      }),
      frame("frame-tool-result", {
        sequence: 2,
        payload: {
          type: "tool_result",
          toolName: "tide_observe_thread",
          callId: "call-1",
          ok: true,
          output: { kind: "observe_thread", threadId: thread.threadId },
          body: "{\"ok\":true}",
        },
      }),
    ],
    existingBlocks: [],
  });

  const blocks = upsertedBlocks(result.blockUpdates);
  assert.equal(blocks[0].kind, "tool_call");
  assert.equal(blocks[0].role, "tool");
  assert.equal(blocks[0].title, "tide_observe_thread");
  assert.deepEqual(blocks[0].data, {
    toolName: "tide_observe_thread",
    callId: "call-1",
    arguments: { detail: "compact" },
  });

  assert.equal(blocks[1].kind, "tool_result");
  assert.equal(blocks[1].role, "tool");
  assert.equal(blocks[1].status, "complete");
  assert.equal(blocks[1].title, "tide_observe_thread");
  assert.deepEqual(blocks[1].data, {
    toolName: "tide_observe_thread",
    callId: "call-1",
    ok: true,
    output: { kind: "observe_thread", threadId: thread.threadId },
  });
});

test("mcp_capability_discovery_calls_are_kept_out_of_the_session", () => {
  // An agent's list_mcp_resources / list_mcp_tools are protocol housekeeping, not
  // user-meaningful tool activity, so they render no blocks (they showed as empty
  // "{}" / "resources: []" noise before).
  const reader = createFixtureAgentSessionReader();
  const result = reader.read({
    thread,
    agentBinding: thread.agentBinding,
    frames: [
      frame("frame-mcp-call", {
        payload: { type: "tool_call", toolName: "list_mcp_resources", callId: "m1", body: "{}" },
      }),
      frame("frame-mcp-result", {
        sequence: 2,
        payload: { type: "tool_result", toolName: "list_mcp_resources", callId: "m1", ok: true, body: "resources: []" },
      }),
    ],
    existingBlocks: [],
  });

  assert.equal(result.blockUpdates.length, 0, "MCP discovery calls emit no blocks");
});

test("structured_file_edit_tool_result_renders_file_edit_and_diff_blocks", () => {
  // Spec: docs_v2/specs/tide-mcp-file-edit-diff-tools.md
  const reader = createFixtureAgentSessionReader();
  const result = reader.read({
    thread,
    agentBinding: thread.agentBinding,
    frames: [
      frame("frame-edit-result", {
        payload: {
          type: "tool_result",
          toolName: "tide_edit_file",
          callId: "call-edit-1",
          ok: true,
          output: {
            kind: "edit_file",
            relativePath: "src/app.ts",
            replacementCount: 1,
            beforeByteLength: 25,
            afterByteLength: 25,
            diff: "--- src/app.ts\n+++ src/app.ts\n-export const version = 1;\n+export const version = 2;",
          },
          body: "{\"ok\":true}",
        },
      }),
    ],
    existingBlocks: [],
  });

  const blocks = upsertedBlocks(result.blockUpdates);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].kind, "file_edit");
  assert.equal(blocks[0].role, "tool");
  assert.equal(blocks[0].title, "src/app.ts");
  assert.deepEqual(blocks[0].data, {
    toolName: "tide_edit_file",
    callId: "call-edit-1",
    relativePath: "src/app.ts",
    replacementCount: 1,
    beforeByteLength: 25,
    afterByteLength: 25,
  });
  assert.equal(blocks[1].kind, "diff_summary");
  assert.equal(blocks[1].role, "tool");
  assert.equal(blocks[1].title, "Diff: src/app.ts");
  assert.match(blocks[1].body ?? "", /\+export const version = 2;/);
});

test("structured_command_tool_result_renders_command_run_block", () => {
  // Spec: docs_v2/specs/tide-mcp-terminal-command-tool.md
  const reader = createFixtureAgentSessionReader();
  const result = reader.read({
    thread,
    agentBinding: thread.agentBinding,
    frames: [
      frame("frame-command-result", {
        payload: {
          type: "tool_result",
          toolName: "tide_run_terminal_command",
          callId: "call-command-1",
          ok: true,
          output: {
            kind: "run_terminal_command",
            command: "npm",
            args: ["run", "test:v2"],
            cwd: "/tmp/thread",
            status: "completed",
            exitCode: 0,
            signal: null,
            stdout: "ok\n",
            stderr: "",
            transcript: "$ npm run test:v2\nok\n[exit 0]\n",
            truncated: false,
            timedOut: false,
          },
          body: "{\"ok\":true}",
        },
      }),
    ],
    existingBlocks: [],
  });

  const block = onlyUpsertedBlock(result.blockUpdates);
  assert.equal(block.kind, "command_run");
  assert.equal(block.role, "tool");
  assert.equal(block.status, "complete");
  assert.equal(block.title, "npm run test:v2");
  assert.match(block.body ?? "", /ok/);
  assert.deepEqual(block.data, {
    toolName: "tide_run_terminal_command",
    callId: "call-command-1",
    command: "npm",
    args: ["run", "test:v2"],
    cwd: "/tmp/thread",
    exitCode: 0,
    signal: null,
    timedOut: false,
    truncated: false,
  });
});

test("reader_output_is_stable_for_same_frame_sequence", () => {
  // UC-1 BR-4: The same ordered frame list produces the same block ids, statuses, and DTOs.
  const reader = createFixtureAgentSessionReader();
  const frames = [
    frame("frame-1", {
      sequence: 1,
      payload: { type: "message", role: "agent", body: "hello" },
    }),
    frame("frame-2", {
      sequence: 2,
      payload: { type: "provider_future_event", text: "raw" },
    }),
  ];

  const first = reader.read({
    thread,
    agentBinding: thread.agentBinding,
    frames,
    existingBlocks: [],
  });
  const second = reader.read({
    thread,
    agentBinding: thread.agentBinding,
    frames,
    existingBlocks: [],
  });

  assert.deepEqual(
    first.blockUpdates.map((update) =>
      update.kind === "upsert" ? toAgentSessionBlockDto(update.block) : update,
    ),
    second.blockUpdates.map((update) =>
      update.kind === "upsert" ? toAgentSessionBlockDto(update.block) : update,
    ),
  );
});

// --- UC-2: Render interactive PTY output ---

test("interactive_pty_output_is_transport_not_a_visible_block", () => {
  // UC-2 BR-1: the hidden PTY is runtime transport, not a visible terminal
  // renderer. A provider TUI (cursor redraws/spinners) is unreadable as text and
  // must NOT become a visible Agent Session block; the raw frame is retained as
  // evidence and visible content comes from provider history / structured blocks.
  const reader = createFixtureAgentSessionReader();
  const result = reader.read({
    thread,
    agentBinding: thread.agentBinding,
    frames: [
      frame("frame-pty", {
        source: "pty_transcript",
        payloadKind: "ansi_text",
        payload: "SStStaStarStarting MCP servers tidetide",
      }),
    ],
    existingBlocks: [],
  });

  assert.deepEqual(result.blockUpdates, []);
});

test("pty_stream_chunks_produce_no_visible_blocks", () => {
  // UC-2 BR-2: a stream of PTY chunks (TUI redraws) produces no visible blocks.
  const reader = createFixtureAgentSessionReader();
  const first = reader.read({
    thread,
    agentBinding: thread.agentBinding,
    frames: [frame("frame-pty-1", { source: "pty_transcript", sourceRef: "pty-stream-1", payloadKind: "text", payload: "hel" })],
    existingBlocks: [],
  });
  assert.deepEqual(first.blockUpdates, []);
  const second = reader.read({
    thread,
    agentBinding: thread.agentBinding,
    frames: [frame("frame-pty-2", { source: "pty_transcript", sourceRef: "pty-stream-1", sequence: 2, payloadKind: "text", payload: "lo", observedAt: later })],
    existingBlocks: [],
  });
  assert.deepEqual(second.blockUpdates, []);
});

test("completed_block_update_maps_to_completed_contract_event", () => {
  // UC-2 BR-2: A completed block update maps to the Shared Contracts completion payload.
  const event = createAgentSessionBlockCompletedEventFromUpdate({
    eventId: "evt-completed",
    requestId: "req-completed",
    emittedAt: later,
    update: {
      kind: "complete",
      blockId: "block-completed",
      threadId: thread.threadId,
      status: "complete",
      updatedAt: later,
    },
  });

  assert.equal(event.kind, "agentSessionBlock.completed");
  assert.deepEqual(event.payload, {
    blockId: "block-completed",
    threadId: thread.threadId,
    status: "complete",
    completedAt: later,
  });
});

// --- UC-3: Render approval prompt ---

test("approval_prompt_uses_provider_native_labels", () => {
  // UC-3 BR-1: Approval labels and provider values remain provider-native.
  const reader = createFixtureAgentSessionReader();
  const result = reader.read({
    thread,
    agentBinding: thread.agentBinding,
    frames: [
      frame("frame-approval", {
        payload: {
          type: "approval_prompt",
          promptId: "prompt-approval",
          message: "Allow command?",
          choices: [
            {
              choiceId: "allow-once",
              label: "Allow once",
              providerValue: "allow_once",
            },
          ],
        },
      }),
    ],
    existingBlocks: [],
  });

  const block = onlyUpsertedBlock(result.blockUpdates);
  const choices = promptChoices(block);
  assert.equal(block.kind, "approval_prompt");
  assert.equal(block.status, "needs_input");
  assert.equal(result.promptState?.choices?.[0]?.providerValue, "allow_once");
  assert.equal(choices?.[0]?.providerValue, "allow_once");
});

test("approval_prompt_does_not_auto_approve_from_renderer", () => {
  // UC-3 BR-2: The Desktop rendering contract carries prompt data but no approval mutation.
  const reader = createFixtureAgentSessionReader();
  const block = onlyUpsertedBlock(
    reader.read({
      thread,
      agentBinding: thread.agentBinding,
      frames: [
        frame("frame-approval-contract", {
          payload: {
            type: "approval_prompt",
            promptId: "prompt-contract",
            message: "Allow edit?",
            choices: [
              {
                choiceId: "deny",
                label: "Deny",
                providerValue: "deny",
              },
            ],
          },
        }),
      ],
      existingBlocks: [],
    }).blockUpdates,
  );

  const dto = toAgentSessionBlockDto(block);
  assert.equal(dto.kind, "approval_prompt");
  assert.equal(dto.status, "needs_input");
  assert.equal("autoApprove" in (dto.data ?? {}), false);
  assert.equal("providerResponse" in (dto.data ?? {}), false);
});

// --- UC-4: Render question or choice prompt ---

test("question_prompt_state_survives_thread_reopen", () => {
  // UC-4 BR-3: Prompt State can be reconstructed from fixture frames.
  const reader = createFixtureAgentSessionReader();
  const frames = [
    frame("frame-question", {
      payload: {
        type: "question_prompt",
        promptId: "prompt-question",
        message: "Which file should Tide inspect?",
      },
    }),
  ];

  const first = reader.read({
    thread,
    agentBinding: thread.agentBinding,
    frames,
    existingBlocks: [],
  });
  const rebuilt = reader.read({
    thread,
    agentBinding: thread.agentBinding,
    frames,
    existingBlocks: [],
  });

  assert.deepEqual(rebuilt.promptState, first.promptState);
  assert.deepEqual(
    rebuilt.blockUpdates.map((update) =>
      update.kind === "upsert" ? toAgentSessionBlockDto(update.block) : update,
    ),
    first.blockUpdates.map((update) =>
      update.kind === "upsert" ? toAgentSessionBlockDto(update.block) : update,
    ),
  );
});

// --- UC-5: Reopen Thread ---

test("agent_session_cache_is_derived_from_raw_session", () => {
  // UC-5 BR-1: Re-reading raw fixture frames rebuilds blocks without cached DTOs.
  const reader = createFixtureAgentSessionReader();
  const frames = [
    frame("frame-cache-1", {
      payload: { type: "message", role: "user", body: "build from frames" },
    }),
    frame("frame-cache-2", {
      sequence: 2,
      payload: { type: "message", role: "agent", body: "rebuilt" },
    }),
  ];

  const cachedDtos = reader
    .read({
      thread,
      agentBinding: thread.agentBinding,
      frames,
      existingBlocks: [],
    })
    .blockUpdates.map((update) =>
      update.kind === "upsert" ? toAgentSessionBlockDto(update.block) : update,
    );
  const rebuiltDtos = reader
    .read({
      thread,
      agentBinding: thread.agentBinding,
      frames,
      existingBlocks: [],
    })
    .blockUpdates.map((update) =>
      update.kind === "upsert" ? toAgentSessionBlockDto(update.block) : update,
    );

  assert.deepEqual(rebuiltDtos, cachedDtos);
});

// --- UC-6: Send Follow-Up ---

test("follow_up_user_message_precedes_resulting_output", () => {
  // UC-6 BR-3: A local user input block sorts before frames caused by that input.
  const local = createLocalUserMessageBlock({
    threadId: thread.threadId,
    agentId: thread.agentBinding.agentId,
    input: "Continue",
    submittedAt: now,
    localId: "local-1",
  });
  const reader = createFixtureAgentSessionReader();
  const providerBlock = onlyUpsertedBlock(
    reader.read({
      thread,
      agentBinding: thread.agentBinding,
      frames: [
        frame("frame-after-local", {
          observedAt: later,
          payload: {
            type: "message",
            role: "agent",
            body: "Continuing.",
          },
        }),
      ],
      existingBlocks: [local],
    }).blockUpdates,
  );

  const sorted = [providerBlock, local].sort(compareAgentSessionBlocks);
  assert.deepEqual(
    sorted.map((block) => block.blockId),
    [local.blockId, providerBlock.blockId],
  );
});

// --- UC-7: Link Workbench artifact ---

test("workbench_reference_targets_thread_owned_state", () => {
  // UC-7 BR-1: Workbench references target Thread-owned state.
  const reader = createFixtureAgentSessionReader();
  const block = onlyUpsertedBlock(
    reader.read({
      thread,
      agentBinding: thread.agentBinding,
      frames: [
        frame("frame-workbench", {
          payload: {
            type: "workbench_reference",
            targetThreadId: thread.threadId,
            paneId: "pane-1",
            label: "Diff",
          },
        }),
      ],
      existingBlocks: [],
    }).blockUpdates,
  );

  assert.equal(block.kind, "workbench_reference");
  assert.equal(block.data?.targetThreadId as string, thread.threadId);
  assert.equal(block.data?.unavailable as boolean, false);
});

test("missing_workbench_reference_renders_unavailable", () => {
  // UC-7 BR-2: Missing targets render as unavailable references.
  const reader = createFixtureAgentSessionReader();
  const block = onlyUpsertedBlock(
    reader.read({
      thread,
      agentBinding: thread.agentBinding,
      frames: [
        frame("frame-workbench-missing", {
          payload: {
            type: "workbench_reference",
            targetThreadId: "another-thread",
            paneId: "pane-2",
            label: "Browser",
          },
        }),
      ],
      existingBlocks: [],
    }).blockUpdates,
  );

  assert.equal(block.kind, "workbench_reference");
  assert.equal(block.data?.targetThreadId as string, "another-thread");
  assert.equal(block.data?.unavailable as boolean, true);
});

function onlyUpsertedBlock(updates: AgentSessionBlockUpdateLike[]): AgentSessionBlock {
  const upserts = updates.filter((update) => update.kind === "upsert");
  assert.equal(upserts.length, 1);
  return upserts[0].block;
}

function upsertedBlocks(updates: AgentSessionBlockUpdateLike[]): AgentSessionBlock[] {
  return updates
    .filter((update) => update.kind === "upsert")
    .map((update) => update.block);
}

type AgentSessionBlockUpdateLike = { kind: "upsert"; block: AgentSessionBlock };

function promptChoices(
  block: AgentSessionBlock,
): { providerValue: string }[] | undefined {
  return block.data?.choices as { providerValue: string }[] | undefined;
}

function frame(
  frameId: string,
  overrides: Partial<RawAgentFrame> = {},
): RawAgentFrame {
  return {
    frameId,
    threadId: thread.threadId,
    agentId: "codex",
    source: "provider_signal",
    sourceRef: frameId,
    sequence: 1,
    observedAt: now,
    payloadKind: "json",
    payload: {
      type: "message",
      role: "agent",
      body: "hello",
    },
    truncated: false,
    ...overrides,
  };
}

function threadSnapshot(threadId: string): ThreadSnapshot {
  return {
    threadId,
    title: "Rendering path",
    agentBinding: { agentId: "codex" },
    scope: { kind: "scratch", scratchCwd: "/tmp/thread-render" },
    lifecycleState: "open",
    runtimeState: "not_started",
    lastKnownState: "idle",
    createdAt: now,
    updatedAt: now,
    cachedBlocks: [],
  };
}
