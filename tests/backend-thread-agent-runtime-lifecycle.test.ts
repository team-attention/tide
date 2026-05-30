import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createThreadRuntimeService,
  type AgentRuntimeHandle,
  type AgentRuntimePort,
  type AgentRuntimeStartInput,
  type AgentRuntimeResumeInput,
  type ProviderReadinessPort,
  type ProviderReadinessCheckInput,
  type ProviderReadinessResult,
  type ProviderSetupSurfaceHandle,
  type ProviderSetupSurfaceOutput,
  type ProviderSetupSurfaceStartInput,
  type ProviderSetupSurfaceTerminalPort,
  type PromptState,
  type PtyTranscriptPort,
  type RawAgentFrame,
  type TerminalInput,
  type ThreadSeed,
  type ThreadRuntimeAsyncEvent,
} from "../src/backend/application/services/thread-runtime-service.ts";
import type { AgentSessionBlock } from "../src/backend/application/domains/agent-session/agent-session-block.ts";
import type {
  WorkspaceCodeDefinitionResult,
  WorkspaceCodeIntelligencePort,
  WorkspaceCodeLocation,
  WorkspaceCodeReferencesResult,
} from "../src/backend/application/ports/outbound/workspace-code-intelligence-port.ts";
import type {
  WorkspaceFileEditResult,
  WorkspaceFilePort,
  WorkspaceFileReadResult,
  WorkspaceFileWriteResult,
  WorkspaceFileTreeEntry,
  WorkspaceFileTreeResult,
} from "../src/backend/application/ports/outbound/workspace-file-port.ts";
import type {
  WorkspaceCommandCwdResult,
  WorkspaceCommandPort,
  WorkspaceCommandRunResult,
} from "../src/backend/application/ports/outbound/workspace-command-port.ts";
import type {
  WorkbenchTerminalHandle,
  WorkbenchTerminalOutput,
  WorkbenchTerminalPort,
  WorkbenchTerminalStartInput,
} from "../src/backend/application/ports/outbound/workbench-terminal-port.ts";

const now = "2026-05-27T00:00:00.000Z";

test("hydrating_an_existing_thread_does_not_start_or_resume_an_agent_runtime", async () => {
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [threadSeed("thread-hydrate")],
  });

  const result = await service.hydrateThread({ threadId: "thread-hydrate" });

  assert.equal(result.ok, true);
  assert.equal(result.thread.threadId, "thread-hydrate");
  assert.equal(result.runtimeState, "not_started");
  assert.deepEqual(fakes.runtime.events, []);
});

test("thread_list_returns_visible_threads_sorted_by_updated_time", async () => {
  // Spec: docs_v2/specs/backend-thread-list-product-shell-bootstrap.md
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [
      threadSeed("thread-older", {
        title: "Older",
        updatedAt: "2026-05-27T00:00:01.000Z",
      }),
      threadSeed("thread-archived", {
        title: "Archived",
        lifecycleState: "archived",
        lastKnownState: "archived",
        updatedAt: "2026-05-27T00:00:03.000Z",
      }),
      threadSeed("thread-newer", {
        title: "Newer",
        updatedAt: "2026-05-27T00:00:02.000Z",
      }),
    ],
  });

  const visible = await service.listThreads({});
  const withArchived = await service.listThreads({ includeArchived: true });

  assert.equal(visible.ok, true);
  assert.deepEqual(
    visible.ok && visible.threads.map((thread) => thread.threadId),
    ["thread-newer", "thread-older"],
  );
  assert.equal(withArchived.ok, true);
  assert.deepEqual(
    withArchived.ok && withArchived.threads.map((thread) => thread.threadId),
    ["thread-archived", "thread-newer", "thread-older"],
  );
  assert.deepEqual(fakes.runtime.events, []);
});

test("restoring_threads_allows_thread_list_without_runtime_start", async () => {
  // Spec: docs_v2/specs/live-backend-persistence-bootstrap.md
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
  });

  const restored = await service.restoreThreads({
    threads: [
      threadSeed("thread-restored", {
        title: "Restored",
        agentBinding: {
          agentId: "codex",
          providerSessionRef: { kind: "codex_rollout", value: "rollout-1" },
        },
        scope: { kind: "project", projectId: "tide", cwd: "/repo/tide" },
      }),
    ],
  });
  const listed = await service.listThreads({});

  assert.equal(restored.ok, true);
  assert.equal(restored.ok && restored.restoredCount, 1);
  assert.equal(listed.ok, true);
  assert.equal(listed.ok && listed.threads[0]?.threadId, "thread-restored");
  assert.equal(
    listed.ok && listed.threads[0]?.agentBinding.providerSessionRef?.value,
    "rollout-1",
  );
  assert.deepEqual(fakes.runtime.events, []);
});

test("starting_a_thread_with_incomplete_provider_readiness_preserves_pending_input_without_writing_to_runtime", async () => {
  const fakes = createFakes({
    readiness: {
      ready: false,
      agentId: "codex",
      blockers: [
        {
          kind: "hook_bootstrap_required",
          message: "Provider hook bootstrap is required.",
        },
      ],
    },
  });
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("thread"),
  });

  const result = await service.startThread({
    initialMessage: "Run the lifecycle check",
    agentBinding: { agentId: "codex" },
    scope: { kind: "scratch", scratchCwd: "/tmp/tide-thread" },
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "provider_not_ready");
  assert.equal(result.thread.pendingInput?.value, "Run the lifecycle check");
  assert.equal(result.runtimeState, "not_started");
  assert.equal(fakes.runtime.writes.length, 0);
  assert.deepEqual(fakes.runtime.events, []);
});

test("starting_a_thread_with_ready_provider_starts_runtime_then_writes_terminal_input", async () => {
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("thread"),
  });

  const result = await service.startThread({
    initialMessage: "Implement the backend lifecycle",
    agentBinding: { agentId: "codex" },
    scope: { kind: "project", projectId: "project-1", cwd: "/repo" },
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "started");
  assert.equal(result.runtimeState, "running");
  assert.deepEqual(fakes.runtime.events, ["start", "writeInput"]);
  assert.equal(fakes.runtime.writes[0].input.kind, "composer_input");
  assert.equal(fakes.runtime.writes[0].input.value, "Implement the backend lifecycle");
});

test("starting_ready_thread_records_local_user_message_block_before_runtime_output", async () => {
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("thread"),
  });

  const result = await service.startThread({
    initialMessage: "Show this message in Agent Chat",
    agentBinding: { agentId: "codex" },
    scope: { kind: "project", projectId: "project-1", cwd: "/repo" },
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "started");
  assert.equal(result.submittedBlock?.kind, "user_message");
  assert.equal(result.submittedBlock?.role, "user");
  assert.equal(result.submittedBlock?.body, "Show this message in Agent Chat");
  assert.equal(result.thread.cachedBlocks.at(-1)?.blockId, result.submittedBlock?.blockId);
});

test("starting_thread_preserves_launch_options_on_thread_snapshot", async () => {
  // Spec: docs_v2/specs/thread-launch-options-contract.md
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("thread"),
  });

  const result = await service.startThread({
    initialMessage: "Run with Antigravity",
    agentBinding: {
      agentId: "antigravity",
      runtimeSource: { kind: "provider_cli", integrationId: "antigravity" },
    },
    scope: { kind: "project", projectId: "tide", cwd: "/repo/tide" },
    launchOptions: { model: "Antigravity default", permission: "default" },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.thread.launchOptions, {
    model: "Antigravity default",
    permission: "default",
  });
  assert.deepEqual(fakes.runtime.starts[0]?.launchOptions, {
    model: "Antigravity default",
    permission: "default",
  });
});

test("sending_follow_up_input_to_an_open_thread_resumes_before_writing", async () => {
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [
      threadSeed("thread-follow-up", {
        agentBinding: {
          agentId: "codex",
          providerSessionRef: {
            kind: "codex_rollout",
            value: "rollout-1",
          },
        },
      }),
    ],
  });

  const result = await service.sendComposerInput({
    threadId: "thread-follow-up",
    input: "Continue from the prior work",
  });

  assert.equal(result.ok, true);
  assert.equal(result.runtimeState, "running");
  assert.deepEqual(fakes.runtime.events, ["resume", "writeInput"]);
  assert.equal(fakes.runtime.writes[0].input.value, "Continue from the prior work");
});

test("resuming_agent_runtime_without_input_resumes_provider_session_without_writing", async () => {
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [
      threadSeed("thread-explicit-resume", {
        agentBinding: {
          agentId: "codex",
          providerSessionRef: {
            kind: "codex_rollout",
            value: "rollout-1",
          },
        },
      }),
    ],
  });

  const result = await service.resumeAgentRuntime({
    threadId: "thread-explicit-resume",
  });

  assert.equal(result.ok, true);
  assert.equal(result.runtimeState, "running");
  assert.equal(fakes.runtime.resumes[0]?.threadId, "thread-explicit-resume");
  assert.deepEqual(fakes.runtime.events, ["resume"]);
  assert.deepEqual(fakes.runtime.writes, []);
});

test("follow_up_send_records_local_user_message_block", async () => {
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [
      threadSeed("thread-follow-up-block", {
        agentBinding: {
          agentId: "codex",
          providerSessionRef: {
            kind: "codex_rollout",
            value: "rollout-1",
          },
        },
      }),
    ],
  });

  const result = await service.sendComposerInput({
    threadId: "thread-follow-up-block",
    input: "Visible follow-up",
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "sent");
  assert.equal(result.submittedBlock?.kind, "user_message");
  assert.equal(result.submittedBlock?.body, "Visible follow-up");
  assert.equal(result.thread.cachedBlocks.at(-1)?.blockId, result.submittedBlock?.blockId);
});

test("sending_follow_up_input_with_a_different_agent_binding_is_rejected", async () => {
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [threadSeed("thread-agent-lock")],
  });

  const result = await service.sendComposerInput({
    threadId: "thread-agent-lock",
    input: "Use another provider",
    agentId: "claude",
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "agent_binding_locked");
  assert.deepEqual(fakes.runtime.events, []);
});

test("answering_an_active_prompt_writes_to_the_same_runtime_and_clears_prompt_state", async () => {
  const fakes = createFakes();
  const activeRuntimeHandle: AgentRuntimeHandle = {
    runtimeId: "runtime-active",
    threadId: "thread-prompt",
    agentId: "codex",
  };
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [
      threadSeed("thread-prompt", {
        runtimeState: "waiting_for_approval",
        activeRuntimeHandle,
        promptState: {
          promptId: "prompt-1",
          threadId: "thread-prompt",
          agentId: "codex",
          kind: "approval",
          message: "Allow command?",
          source: "provider_signal",
        },
      }),
    ],
  });

  const result = await service.answerPrompt({
    threadId: "thread-prompt",
    promptId: "prompt-1",
    value: "allow_once",
  });

  assert.equal(result.ok, true);
  assert.equal(result.promptState, null);
  assert.equal(fakes.runtime.writes[0].handle.runtimeId, "runtime-active");
  assert.equal(fakes.runtime.writes[0].input.kind, "prompt_answer");
  assert.equal(fakes.runtime.writes[0].input.value, "allow_once");

  const hydrated = await service.hydrateThread({ threadId: "thread-prompt" });
  assert.equal(hydrated.thread.promptState, undefined);
});

test("answering_prompt_with_choice_id_only_writes_provider_native_value", async () => {
  // Spec: docs_v2/specs/provider-signal-prompt-ingress.md
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [
      threadSeed("thread-prompt-choice", {
        runtimeState: "waiting_for_approval",
        activeRuntimeHandle: {
          runtimeId: "runtime-choice",
          threadId: "thread-prompt-choice",
          agentId: "codex",
        },
        promptState: {
          promptId: "prompt-choice",
          threadId: "thread-prompt-choice",
          agentId: "codex",
          kind: "permission",
          message: "Allow command?",
          source: "provider_hook",
          choices: [
            {
              choiceId: "allow-once",
              label: "Allow once",
              providerValue: "allow_once",
            },
            {
              choiceId: "deny",
              label: "Deny",
              providerValue: "deny",
            },
          ],
        },
      }),
    ],
  });

  const result = await service.answerPrompt({
    threadId: "thread-prompt-choice",
    promptId: "prompt-choice",
    choiceId: "allow-once",
  });

  assert.equal(result.ok, true);
  assert.equal(fakes.runtime.writes[0]?.input.kind, "prompt_answer");
  assert.equal(fakes.runtime.writes[0]?.input.value, "allow_once");
  assert.equal(fakes.runtime.writes[0]?.input.choiceId, "allow-once");
  assert.equal(result.promptState, null);
});

test("recording_provider_prompt_state_marks_thread_waiting_without_runtime_start", async () => {
  // Spec: docs_v2/specs/provider-signal-prompt-ingress.md
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [threadSeed("thread-provider-prompt")],
  });
  const providerPrompt: PromptState = {
    promptId: "prompt-provider",
    threadId: "thread-provider-prompt",
    agentId: "codex",
    kind: "permission",
    message: "Allow command?",
    choices: [
      {
        choiceId: "allow",
        label: "Allow once",
        providerValue: "allow_once",
      },
    ],
    source: "provider_hook",
  };

  const result = await service.recordProviderPromptState({
    threadId: "thread-provider-prompt",
    promptState: providerPrompt,
  });
  const hydrated = await service.hydrateThread({
    threadId: "thread-provider-prompt",
  });

  assert.equal(result.ok, true);
  assert.equal(result.runtimeState, "waiting_for_approval");
  assert.equal(result.thread.promptState?.promptId, "prompt-provider");
  assert.equal(hydrated.thread.lastKnownState, "waiting_for_approval");
  assert.equal(hydrated.thread.lifecycleState, "waiting_for_approval");
  assert.deepEqual(fakes.runtime.events, []);
});

test("provider_prompt_state_for_a_different_agent_binding_is_rejected", async () => {
  // Spec: docs_v2/specs/provider-signal-prompt-ingress.md
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [threadSeed("thread-provider-lock")],
  });

  const result = await service.recordProviderPromptState({
    threadId: "thread-provider-lock",
    promptState: {
      promptId: "prompt-wrong-agent",
      threadId: "thread-provider-lock",
      agentId: "claude",
      kind: "question",
      message: "Which branch?",
      source: "provider_signal",
    },
  });
  const hydrated = await service.hydrateThread({
    threadId: "thread-provider-lock",
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "agent_binding_locked");
  assert.equal(hydrated.thread.promptState, undefined);
  assert.deepEqual(fakes.runtime.events, []);
});

test("recording_provider_session_ref_attaches_it_to_thread_agent_binding", async () => {
  // Spec: docs_v2/specs/live-provider-session-reference-discovery.md
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [
      threadSeed("thread-provider-session", {
        agentBinding: {
          agentId: "antigravity",
          runtimeSource: { kind: "provider_cli", integrationId: "antigravity" },
        },
        launchOptions: { model: "Antigravity default", permission: "default" },
      }),
    ],
  });

  const result = await service.recordProviderSessionRef({
    threadId: "thread-provider-session",
    agentId: "antigravity",
    providerSessionRef: {
      kind: "antigravity_conversation",
      value: "conversation-1",
      transcriptPath: "/provider/brain/conversation-1/.system_generated/logs/transcript.jsonl",
    },
  });
  const hydrated = await service.hydrateThread({
    threadId: "thread-provider-session",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.thread.agentBinding.providerSessionRef, {
    kind: "antigravity_conversation",
    value: "conversation-1",
    transcriptPath: "/provider/brain/conversation-1/.system_generated/logs/transcript.jsonl",
  });
  assert.deepEqual(hydrated.thread.agentBinding.providerSessionRef, {
    kind: "antigravity_conversation",
    value: "conversation-1",
    transcriptPath: "/provider/brain/conversation-1/.system_generated/logs/transcript.jsonl",
  });
  assert.deepEqual(hydrated.thread.launchOptions, {
    model: "Antigravity default",
    permission: "default",
  });
  assert.deepEqual(fakes.runtime.events, []);
});

test("recording_provider_session_ref_rejects_mismatched_agent_binding", async () => {
  // Spec: docs_v2/specs/live-provider-session-reference-discovery.md
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [threadSeed("thread-provider-session-lock")],
  });

  const result = await service.recordProviderSessionRef({
    threadId: "thread-provider-session-lock",
    agentId: "antigravity",
    providerSessionRef: {
      kind: "antigravity_conversation",
      value: "conversation-1",
    },
  });
  const hydrated = await service.hydrateThread({
    threadId: "thread-provider-session-lock",
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "agent_binding_locked");
  assert.equal(hydrated.thread.agentBinding.providerSessionRef, undefined);
  assert.deepEqual(fakes.runtime.events, []);
});

test("recording_agent_session_block_upserts_cached_block_for_hydrate", async () => {
  // Spec: docs_v2/specs/live-provider-session-reference-discovery.md
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [threadSeed("thread-agent-block-cache")],
  });
  const firstBlock: AgentSessionBlock = {
    blockId: "provider:block-1",
    threadId: "thread-agent-block-cache",
    agentId: "codex",
    kind: "agent_message",
    role: "agent",
    sourceFrameIds: ["frame-1"],
    status: "complete",
    body: "First provider answer",
    createdAt: now,
    updatedAt: now,
  };
  const updatedBlock: AgentSessionBlock = {
    ...firstBlock,
    body: "Updated provider answer",
    updatedAt: "2026-05-27T00:00:01.000Z",
  };

  const recorded = await service.recordAgentSessionBlock({
    threadId: "thread-agent-block-cache",
    block: firstBlock,
  });
  const hydrated = await service.hydrateThread({
    threadId: "thread-agent-block-cache",
  });
  const updated = await service.recordAgentSessionBlock({
    threadId: "thread-agent-block-cache",
    block: updatedBlock,
  });
  const hydratedAgain = await service.hydrateThread({
    threadId: "thread-agent-block-cache",
  });

  assert.equal(recorded.ok, true);
  assert.equal(updated.ok, true);
  assert.deepEqual(
    hydrated.ok && hydrated.blocks.map((block) => block.body),
    ["First provider answer"],
  );
  assert.deepEqual(
    hydratedAgain.ok && hydratedAgain.blocks.map((block) => block.body),
    ["Updated provider answer"],
  );
  assert.deepEqual(fakes.runtime.events, []);
});

test("stopping_agent_runtime_preserves_thread_metadata", async () => {
  const fakes = createFakes();
  const activeRuntimeHandle: AgentRuntimeHandle = {
    runtimeId: "runtime-stop",
    threadId: "thread-stop",
    agentId: "codex",
  };
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [
      threadSeed("thread-stop", {
        runtimeState: "running",
        activeRuntimeHandle,
      }),
    ],
  });

  const result = await service.stopAgentRuntime({ threadId: "thread-stop" });
  const hydrated = await service.hydrateThread({ threadId: "thread-stop" });

  assert.equal(result.ok, true);
  assert.equal(result.runtimeState, "stopped");
  assert.equal(hydrated.thread.threadId, "thread-stop");
  assert.equal(hydrated.runtimeState, "stopped");
  assert.deepEqual(fakes.runtime.events, ["stop"]);
});

test("raw_agent_frames_receive_monotonic_thread_local_sequences", async () => {
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("frame"),
    initialThreads: [threadSeed("thread-frames")],
  });

  const first = await service.appendRawAgentFrame({
    threadId: "thread-frames",
    agentId: "codex",
    source: "pty_transcript",
    body: "first",
  });
  const second = await service.appendRawAgentFrame({
    threadId: "thread-frames",
    agentId: "codex",
    source: "provider_signal",
    sourceRef: "signal-1",
    body: "second",
  });

  assert.deepEqual([first.sequence, second.sequence], [1, 2]);
  assert.deepEqual(
    fakes.transcript.frames.map((frame) => frame.sequence),
    [1, 2],
  );
});

test("mcp_tool_calls_are_counted_by_the_service_without_creating_a_second_runtime", async () => {
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [
      threadSeed("thread-mcp", {
        activeRuntimeHandle: {
          runtimeId: "runtime-mcp",
          threadId: "thread-mcp",
          agentId: "codex",
        },
        runtimeState: "running",
      }),
    ],
  });

  const result = await service.handleTideMcpToolCall({
    session: { runtimeId: "runtime-mcp", agentId: "codex" },
    toolName: "tide_observe_workbench",
    input: { includePanes: true },
  });

  assert.equal(result.ok, true);
  assert.equal(result.handledByService, true);
  assert.equal(result.mcpToolCallCount, 1);
  assert.equal(result.output.kind, "observe_workbench");
  assert.deepEqual(fakes.runtime.events, []);
});

test("mcp_tool_calls_accept_tide_api_agent_runtime_session", async () => {
  // Spec: docs_v2/specs/tide-api-agent-tool-calls.md
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [
      threadSeed("thread-openai-mcp", {
        agentBinding: {
          agentId: "openai_api",
          runtimeSource: { kind: "tide_api", provider: "openai" },
        },
        activeRuntimeHandle: {
          runtimeId: "runtime-openai",
          threadId: "thread-openai-mcp",
          agentId: "openai_api",
        },
        runtimeState: "running",
      }),
    ],
  });

  const result = await service.handleTideMcpToolCall({
    session: { runtimeId: "runtime-openai", agentId: "openai_api" },
    toolName: "tide_observe_thread",
    input: { detail: "compact" },
  });

  assert.equal(result.ok, true);
  assert.equal(result.output.kind, "observe_thread");
  assert.equal(result.output.agentId, "openai_api");
  assert.equal(result.mcpToolCallCount, 1);
  assert.deepEqual(fakes.runtime.events, []);
});

test("workbench_command_open_provider_setup_surface_creates_terminal_pane", async () => {
  // Spec: docs_v2/specs/provider-setup-surface-workbench-command.md
  const fakes = createFakes({
    readiness: {
      ready: false,
      agentId: "codex",
      blockers: [
        {
          kind: "directory_trust_required",
          message: "Directory Trust is required.",
          setup: {
            command: "/usr/local/bin/codex",
            args: [],
            cwd: "/repo",
            expectedCompletion: "retry_preflight",
          },
        },
      ],
    },
  });
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
  });
  const started = await service.startThread({
    initialMessage: "Preserve this draft",
    agentBinding: { agentId: "codex" },
    scope: { kind: "project", projectId: "tide", cwd: "/repo" },
  });
  assert.equal(started.ok, true);

  const opened = await service.handleWorkbenchCommand({
    threadId: started.thread.threadId,
    command: "open_provider_setup_surface",
    data: {
      blockerKind: "directory_trust_required",
      setup: {
        command: "/usr/local/bin/codex",
        args: [],
        cwd: "/repo",
        expectedCompletion: "retry_preflight",
      },
    },
  });

  assert.equal(opened.ok, true);
  assert.equal(opened.thread.pendingInput?.value, "Preserve this draft");
  assert.equal(opened.thread.workbench.panes.length, 1);
  assert.equal(opened.thread.workbench.panes[0]?.kind, "terminal");
  assert.equal(opened.thread.workbench.panes[0]?.title, "Provider setup: codex");
  assert.equal(opened.thread.workbench.panes[0]?.command, "/usr/local/bin/codex");
  assert.equal(opened.thread.workbench.panes[0]?.cwd, "/repo");
  assert.equal(opened.thread.workbench.focusOwner, "workbench");
  assert.deepEqual(fakes.runtime.events, []);
});

test("workbench_command_open_provider_setup_surface_starts_setup_terminal_process", async () => {
  // Spec: docs_v2/specs/provider-setup-surface-terminal-lifecycle.md
  const fakes = createFakes({
    readiness: {
      ready: false,
      agentId: "codex",
      blockers: [
        {
          kind: "directory_trust_required",
          message: "Directory Trust is required.",
          setup: {
            command: "/usr/local/bin/codex",
            args: ["--no-alt-screen"],
            env: { CODEX_HOME: "/tmp/tide-codex-home" },
            cwd: "/repo",
            expectedCompletion: "retry_preflight",
          },
        },
      ],
    },
  });
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
  });
  const started = await service.startThread({
    initialMessage: "Preserve while setup runs",
    agentBinding: { agentId: "codex" },
    scope: { kind: "project", projectId: "tide", cwd: "/repo" },
  });
  assert.equal(started.ok, true);

  const opened = await service.handleWorkbenchCommand({
    threadId: started.thread.threadId,
    command: "open_provider_setup_surface",
    data: {
      setup: {
        command: "/usr/local/bin/codex",
        args: ["--no-alt-screen"],
        env: { CODEX_HOME: "/tmp/tide-codex-home" },
        cwd: "/repo",
        expectedCompletion: "retry_preflight",
      },
    },
  });

  assert.equal(opened.ok, true);
  assert.equal(opened.thread.pendingInput?.value, "Preserve while setup runs");
  assert.equal(opened.thread.workbench.panes[0]?.status, "running");
  assert.equal(fakes.setupSurface.starts[0]?.command, "/usr/local/bin/codex");
  assert.deepEqual(fakes.setupSurface.starts[0]?.args, ["--no-alt-screen"]);
  assert.deepEqual(fakes.setupSurface.starts[0]?.env, {
    CODEX_HOME: "/tmp/tide-codex-home",
  });
  assert.equal(fakes.setupSurface.starts[0]?.cwd, "/repo");
  assert.deepEqual(fakes.runtime.events, []);
});

test("provider_setup_surface_input_writes_terminal_bytes_to_running_setup_process", async () => {
  // Spec: docs_v2/specs/provider-setup-surface-input-and-retry.md
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [threadSeed("thread-setup-input")],
  });
  const opened = await service.handleWorkbenchCommand({
    threadId: "thread-setup-input",
    command: "open_provider_setup_surface",
    data: {
      setup: {
        command: "/usr/local/bin/codex",
        args: [],
        cwd: "/repo",
        expectedCompletion: "retry_preflight",
      },
    },
  });
  assert.equal(opened.ok, true);
  const paneId = opened.thread.workbench.panes[0]?.paneId;

  const written = await service.handleWorkbenchCommand({
    threadId: "thread-setup-input",
    command: "write_terminal_input",
    targetPaneId: paneId,
    data: { input: "\u001b[B\r" },
  });

  assert.equal(written.ok, true);
  assert.deepEqual(fakes.setupSurface.writes, ["\u001b[B\r"]);
  assert.deepEqual(fakes.runtime.events, []);
});

test("provider_setup_surface_output_updates_terminal_pane_preview", async () => {
  // Spec: docs_v2/specs/provider-setup-surface-terminal-lifecycle.md
  const fakes = createFakes();
  fakes.setupSurface.outputsOnStart = [
    { source: "stdout", body: "Provider setup running\n" },
    { source: "stderr", body: `${"x".repeat(8200)}done\n` },
  ];
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [threadSeed("thread-setup-preview")],
  });

  const opened = await service.handleWorkbenchCommand({
    threadId: "thread-setup-preview",
    command: "open_provider_setup_surface",
    data: {
      setup: {
        command: "/usr/local/bin/codex",
        args: [],
        cwd: "/repo",
        expectedCompletion: "retry_preflight",
      },
    },
  });

  assert.equal(opened.ok, true);
  const pane = opened.thread.workbench.panes[0];
  assert.equal(pane?.kind, "terminal");
  if (pane?.kind !== "terminal") {
    throw new Error("Expected Provider Setup Surface terminal pane.");
  }
  assert.equal(pane.status, "running");
  assert.ok((pane.transcriptPreview?.length ?? 0) <= 8000);
  assert.match(pane.transcriptPreview ?? "", /done/);
});

test("provider_setup_surface_exit_retries_readiness_and_replays_pending_input_when_ready", async () => {
  // Spec: docs_v2/specs/provider-setup-surface-input-and-retry.md
  const fakes = createFakes({
    readiness: {
      ready: false,
      agentId: "codex",
      blockers: [
        {
          kind: "directory_trust_required",
          message: "Directory Trust is required.",
          setup: {
            command: "/usr/local/bin/codex",
            args: [],
            cwd: "/repo",
            expectedCompletion: "retry_preflight",
          },
        },
      ],
    },
  });
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
  });
  const started = await service.startThread({
    initialMessage: "Run after setup",
    agentBinding: { agentId: "codex" },
    scope: { kind: "project", projectId: "tide", cwd: "/repo" },
    launchOptions: { model: "GPT-5.5 High", permission: "workspace-write" },
  });
  assert.equal(started.ok, true);
  assert.equal(started.status, "provider_not_ready");
  fakes.readiness.setResult({ ready: true, agentId: "codex", blockers: [] });
  const opened = await service.handleWorkbenchCommand({
    threadId: started.thread.threadId,
    command: "open_provider_setup_surface",
    data: {
      setup: {
        command: "/usr/local/bin/codex",
        args: [],
        cwd: "/repo",
        expectedCompletion: "retry_preflight",
      },
    },
  });
  assert.equal(opened.ok, true);

  await fakes.setupSurface.emitExit(0, { exitCode: 0, signal: null });
  const hydrated = await service.hydrateThread({ threadId: started.thread.threadId });

  assert.equal(hydrated.ok, true);
  assert.equal(hydrated.thread.pendingInput, undefined);
  assert.equal(hydrated.runtimeState, "running");
  assert.equal(hydrated.thread.cachedBlocks.at(-1)?.body, "Run after setup");
  assert.deepEqual(fakes.runtime.events, ["start", "writeInput"]);
  assert.deepEqual(fakes.runtime.starts[0]?.launchOptions, {
    model: "GPT-5.5 High",
    permission: "workspace-write",
  });
  assert.equal(fakes.runtime.writes[0]?.input.value, "Run after setup");
  assert.deepEqual(fakes.readiness.checks.map((check) => check.launchOptions), [
    { model: "GPT-5.5 High", permission: "workspace-write" },
    { model: "GPT-5.5 High", permission: "workspace-write" },
  ]);
});

test("provider_setup_surface_exit_pushes_async_events_for_replay", async () => {
  // Spec: docs_v2/specs/provider-setup-surface-input-and-retry.md
  const fakes = createFakes({
    readiness: {
      ready: false,
      agentId: "codex",
      blockers: [
        {
          kind: "directory_trust_required",
          message: "Directory Trust is required.",
          setup: {
            command: "/usr/local/bin/codex",
            args: [],
            cwd: "/repo",
            expectedCompletion: "retry_preflight",
          },
        },
      ],
    },
  });
  const asyncEvents: ThreadRuntimeAsyncEvent[] = [];
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    onAsyncEvent: (event) => {
      asyncEvents.push(event);
    },
  });
  const started = await service.startThread({
    initialMessage: "Run after setup",
    agentBinding: { agentId: "codex" },
    scope: { kind: "project", projectId: "tide", cwd: "/repo" },
    launchOptions: { model: "GPT-5.5 High", permission: "workspace-write" },
  });
  assert.equal(started.ok, true);
  assert.equal(started.status, "provider_not_ready");
  fakes.readiness.setResult({ ready: true, agentId: "codex", blockers: [] });
  const opened = await service.handleWorkbenchCommand({
    threadId: started.thread.threadId,
    command: "open_provider_setup_surface",
    data: {
      setup: {
        command: "/usr/local/bin/codex",
        args: [],
        cwd: "/repo",
        expectedCompletion: "retry_preflight",
      },
    },
  });
  assert.equal(opened.ok, true);
  asyncEvents.length = 0;

  await fakes.setupSurface.emitExit(0, { exitCode: 0, signal: null });

  assert.deepEqual(
    asyncEvents.map((event) => event.kind),
    [
      "workbench_changed",
      "agent_session_block_upserted",
      "agent_runtime_state_changed",
      "thread_hydrated",
    ],
  );
  const blockEvent = asyncEvents.find(
    (event): event is Extract<ThreadRuntimeAsyncEvent, { kind: "agent_session_block_upserted" }> =>
      event.kind === "agent_session_block_upserted",
  );
  const hydratedEvent = asyncEvents.find(
    (event): event is Extract<ThreadRuntimeAsyncEvent, { kind: "thread_hydrated" }> =>
      event.kind === "thread_hydrated",
  );
  assert.equal(blockEvent?.block.body, "Run after setup");
  assert.equal(hydratedEvent?.thread.pendingInput, undefined);
  assert.equal(hydratedEvent?.runtimeState, "running");
  assert.equal(hydratedEvent?.thread.agentBinding.agentId, "codex");
  assert.deepEqual(hydratedEvent?.thread.launchOptions, {
    model: "GPT-5.5 High",
    permission: "workspace-write",
  });
});

test("provider_setup_surface_exit_keeps_pending_input_when_readiness_is_still_blocked", async () => {
  // Spec: docs_v2/specs/provider-setup-surface-input-and-retry.md
  const fakes = createFakes({
    readiness: {
      ready: false,
      agentId: "codex",
      blockers: [
        {
          kind: "directory_trust_required",
          message: "Directory Trust is still required.",
          setup: {
            command: "/usr/local/bin/codex",
            args: [],
            cwd: "/repo",
            expectedCompletion: "retry_preflight",
          },
        },
      ],
    },
  });
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
  });
  const started = await service.startThread({
    initialMessage: "Keep this pending",
    agentBinding: { agentId: "codex" },
    scope: { kind: "project", projectId: "tide", cwd: "/repo" },
    launchOptions: { model: "GPT-5.5 High" },
  });
  assert.equal(started.ok, true);
  const opened = await service.handleWorkbenchCommand({
    threadId: started.thread.threadId,
    command: "open_provider_setup_surface",
    data: {
      setup: {
        command: "/usr/local/bin/codex",
        args: [],
        cwd: "/repo",
        expectedCompletion: "retry_preflight",
      },
    },
  });
  assert.equal(opened.ok, true);

  await fakes.setupSurface.emitExit(0, { exitCode: 0, signal: null });
  const hydrated = await service.hydrateThread({ threadId: started.thread.threadId });

  assert.equal(hydrated.ok, true);
  assert.equal(hydrated.thread.pendingInput?.value, "Keep this pending");
  assert.deepEqual(hydrated.thread.pendingInput?.launchOptions, {
    model: "GPT-5.5 High",
  });
  assert.equal(hydrated.runtimeState, "not_started");
  assert.deepEqual(fakes.runtime.events, []);
});

test("provider_setup_surface_exit_pushes_async_readiness_when_still_blocked", async () => {
  // Spec: docs_v2/specs/provider-setup-surface-input-and-retry.md
  const fakes = createFakes({
    readiness: {
      ready: false,
      agentId: "codex",
      blockers: [
        {
          kind: "directory_trust_required",
          message: "Directory Trust is still required.",
          setup: {
            command: "/usr/local/bin/codex",
            args: [],
            cwd: "/repo",
            expectedCompletion: "retry_preflight",
          },
        },
      ],
    },
  });
  const asyncEvents: ThreadRuntimeAsyncEvent[] = [];
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    onAsyncEvent: (event) => {
      asyncEvents.push(event);
    },
  });
  const started = await service.startThread({
    initialMessage: "Keep this pending",
    agentBinding: { agentId: "codex" },
    scope: { kind: "project", projectId: "tide", cwd: "/repo" },
    launchOptions: { model: "GPT-5.5 High" },
  });
  assert.equal(started.ok, true);
  const opened = await service.handleWorkbenchCommand({
    threadId: started.thread.threadId,
    command: "open_provider_setup_surface",
    data: {
      setup: {
        command: "/usr/local/bin/codex",
        args: [],
        cwd: "/repo",
        expectedCompletion: "retry_preflight",
      },
    },
  });
  assert.equal(opened.ok, true);
  asyncEvents.length = 0;

  await fakes.setupSurface.emitExit(0, { exitCode: 0, signal: null });

  assert.deepEqual(
    asyncEvents.map((event) => event.kind),
    ["workbench_changed", "provider_readiness_changed", "thread_hydrated"],
  );
  const readinessEvent = asyncEvents.find(
    (event): event is Extract<ThreadRuntimeAsyncEvent, { kind: "provider_readiness_changed" }> =>
      event.kind === "provider_readiness_changed",
  );
  const hydratedEvent = asyncEvents.find(
    (event): event is Extract<ThreadRuntimeAsyncEvent, { kind: "thread_hydrated" }> =>
      event.kind === "thread_hydrated",
  );
  assert.equal(readinessEvent?.readiness.ready, false);
  assert.equal(readinessEvent?.readiness.blockers[0]?.kind, "directory_trust_required");
  assert.equal(hydratedEvent?.thread.pendingInput?.value, "Keep this pending");
  assert.deepEqual(
    asyncEvents.some((event) => event.kind === "agent_session_block_upserted"),
    false,
  );
  assert.deepEqual(fakes.runtime.events, []);
});

test("closing_running_provider_setup_surface_stops_setup_process", async () => {
  // Spec: docs_v2/specs/provider-setup-surface-terminal-lifecycle.md
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [threadSeed("thread-close-setup")],
  });

  const opened = await service.handleWorkbenchCommand({
    threadId: "thread-close-setup",
    command: "open_provider_setup_surface",
    data: {
      setup: {
        command: "/usr/local/bin/codex",
        args: [],
        cwd: "/repo",
        expectedCompletion: "retry_preflight",
      },
    },
  });
  assert.equal(opened.ok, true);
  const paneId = opened.thread.workbench.panes[0]?.paneId;
  assert.equal(typeof paneId, "string");

  const closed = await service.handleWorkbenchCommand({
    threadId: "thread-close-setup",
    command: "close_pane",
    targetPaneId: paneId,
  });

  assert.equal(closed.ok, true);
  assert.equal(fakes.setupSurface.stops.length, 1);
  assert.equal(
    closed.thread.workbench.panes.find((pane) => pane.paneId === paneId)?.visible,
    false,
  );
  const closedPane = closed.thread.workbench.panes.find((pane) => pane.paneId === paneId);
  assert.equal(closedPane?.kind, "terminal");
  if (closedPane?.kind !== "terminal") {
    throw new Error("Expected closed Provider Setup Surface terminal pane.");
  }
  assert.equal(closedPane.status, "completed");
});

test("workbench_command_focus_and_close_pane_updates_backend_workbench_state", async () => {
  // Spec: docs_v2/specs/provider-setup-surface-workbench-command.md
  const service = createThreadRuntimeService({
    ...createFakes().ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [
      threadSeed("thread-workbench-command", {
        workbench: {
          activePaneId: "pane-one",
          focusOwner: "composer",
          panes: [
            browserPane("pane-one", "One"),
            browserPane("pane-two", "Two"),
          ],
        },
      }),
    ],
  });

  const focused = await service.handleWorkbenchCommand({
    threadId: "thread-workbench-command",
    command: "focus_pane",
    targetPaneId: "pane-two",
  });
  assert.equal(focused.ok, true);
  assert.equal(focused.thread.workbench.activePaneId, "pane-two");
  assert.equal(focused.thread.workbench.focusOwner, "workbench");

  const closed = await service.handleWorkbenchCommand({
    threadId: "thread-workbench-command",
    command: "close_pane",
    targetPaneId: "pane-two",
  });
  assert.equal(closed.ok, true);
  assert.equal(
    closed.thread.workbench.panes.find((pane) => pane.paneId === "pane-two")?.visible,
    false,
  );
  assert.equal(closed.thread.workbench.activePaneId, "pane-one");
});

test("refresh_file_tree_workbench_command_lists_thread_root_entries", async () => {
  // Spec: docs_v2/specs/workbench-filetree-view.md
  const fakes = createFakes({
    fileTreeEntries: [
      { id: "src", name: "src", relativePath: "src", depth: 0, kind: "folder" },
      {
        id: "package.json",
        name: "package.json",
        relativePath: "package.json",
        depth: 0,
        kind: "file",
      },
    ],
  });
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [
      threadSeed("thread-file-tree", {
        scope: { kind: "project", projectId: "tide", cwd: "/repo/tide" },
      }),
    ],
  });

  const refreshed = await service.handleWorkbenchCommand({
    threadId: "thread-file-tree",
    command: "refresh_file_tree",
    data: { maxDepth: 2, maxEntries: 160 },
  });

  assert.equal(refreshed.ok, true);
  assert.equal(fakes.workspaceFiles.listCalls[0]?.root, "/repo/tide");
  assert.equal(refreshed.ok && refreshed.thread.workbench.fileTree?.root, "/repo/tide");
  assert.equal(refreshed.ok && refreshed.thread.workbench.fileTree?.cwdLabel, "tide");
  assert.deepEqual(
    refreshed.ok && refreshed.thread.workbench.fileTree?.entries.map((entry) => entry.name),
    ["src", "package.json"],
  );
  assert.equal(refreshed.ok && refreshed.thread.workbench.panes.length, 0);
});

test("opening_editor_from_workbench_command_reads_file_and_creates_editor_pane", async () => {
  // Spec: docs_v2/specs/workbench-filetree-view.md
  const service = createThreadRuntimeService({
    ...createFakes({ files: { "src/app.ts": "export const app = true;\n" } }).ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [
      threadSeed("thread-filetree-open", {
        scope: { kind: "project", projectId: "tide", cwd: "/repo/tide" },
      }),
    ],
  });

  const opened = await service.handleWorkbenchCommand({
    threadId: "thread-filetree-open",
    command: "open_editor",
    data: { path: "src/app.ts" },
  });

  assert.equal(opened.ok, true);
  assert.equal(opened.ok && opened.thread.workbench.panes[0]?.kind, "editor");
  assert.equal(opened.ok && opened.thread.workbench.panes[0]?.relativePath, "src/app.ts");
  assert.equal(opened.ok && opened.thread.workbench.panes[0]?.bodyText, "export const app = true;\n");
  assert.equal(opened.ok && opened.thread.workbench.activePaneId, "id-1");
  assert.equal(opened.ok && opened.thread.workbench.focusOwner, "workbench");
});

test("go_to_definition_opens_target_editor_pane_with_navigation_target", async () => {
  // Spec: docs_v2/specs/workbench-editor-code-navigation.md
  const fakes = createFakes({
    files: {
      "src/app.ts": "import { answer } from './answer';\nconsole.log(answer);\n",
      "src/answer.ts": "export const answer = 42;\n",
    },
    definition: {
      root: "/repo/tide",
      path: "/repo/tide/src/answer.ts",
      relativePath: "src/answer.ts",
      line: 0,
      character: 13,
      length: 6,
      label: "answer",
    },
  });
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [
      threadSeed("thread-goto-definition", {
        scope: { kind: "project", projectId: "tide", cwd: "/repo/tide" },
        workbench: {
          activePaneId: "pane-source",
          focusOwner: "workbench",
          panes: [
            {
              paneId: "pane-source",
              kind: "editor",
              title: "app.ts",
              filePath: "/repo/tide/src/app.ts",
              relativePath: "src/app.ts",
              visible: true,
              revision: "rev-source",
              updatedAt: now,
              bodyText: "import { answer } from './answer';\nconsole.log(answer);\n",
              bodyTextPreview: "import { answer } from './answer';\nconsole.log(answer);\n",
              byteLength: 57,
              truncated: false,
            },
          ],
        },
      }),
    ],
  });

  const result = await service.handleWorkbenchCommand({
    threadId: "thread-goto-definition",
    command: "go_to_definition",
    targetPaneId: "pane-source",
    data: { line: 1, character: 12 },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(fakes.codeIntelligence.definitionCalls[0], {
    root: "/repo/tide",
    path: "/repo/tide/src/app.ts",
    line: 1,
    character: 12,
  });
  const targetPane = result.ok
    ? result.thread.workbench.panes.find((pane) => pane.relativePath === "src/answer.ts")
    : undefined;
  assert.equal(targetPane?.kind, "editor");
  assert.equal(targetPane?.bodyText, "export const answer = 42;\n");
  assert.deepEqual(targetPane?.navigationTarget, {
    line: 0,
    character: 13,
    length: 6,
    label: "answer",
    sourcePaneId: "pane-source",
  });
  assert.equal(result.ok && result.thread.workbench.activePaneId, targetPane?.paneId);
  assert.equal(result.ok && result.thread.workbench.focusOwner, "workbench");
});

test("go_to_definition_without_result_returns_not_found_without_workbench_mutation", async () => {
  // Spec: docs_v2/specs/workbench-editor-code-navigation.md
  const fakes = createFakes({
    files: {
      "src/app.ts": "console.log('no symbol');\n",
    },
    definitionError: {
      code: "workspace_code_definition_not_found",
      message: "Definition target was not found.",
    },
  });
  const initialWorkbench = {
    activePaneId: "pane-source",
    focusOwner: "workbench" as const,
    panes: [
      {
        paneId: "pane-source",
        kind: "editor" as const,
        title: "app.ts",
        filePath: "/repo/tide/src/app.ts",
        relativePath: "src/app.ts",
        visible: true,
        revision: "rev-source",
        updatedAt: now,
        bodyText: "console.log('no symbol');\n",
        bodyTextPreview: "console.log('no symbol');\n",
        byteLength: 25,
        truncated: false,
        navigationTarget: undefined,
        references: undefined,
      },
    ],
  };
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [
      threadSeed("thread-goto-missing", {
        scope: { kind: "project", projectId: "tide", cwd: "/repo/tide" },
        workbench: initialWorkbench,
      }),
    ],
  });

  const result = await service.handleWorkbenchCommand({
    threadId: "thread-goto-missing",
    command: "go_to_definition",
    targetPaneId: "pane-source",
    data: { line: 0, character: 4 },
  });

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error.code, "workspace_code_definition_not_found");
  const hydrated = await service.hydrateThread({ threadId: "thread-goto-missing" });
  assert.deepEqual(hydrated.ok && hydrated.thread.workbench.panes, initialWorkbench.panes);
  assert.equal(hydrated.ok && hydrated.thread.workbench.activePaneId, "pane-source");
});

test("go_to_references_lists_use_sites_on_the_source_editor_pane", async () => {
  // Spec: docs_v2/specs/workbench-editor-code-navigation.md (D5)
  const fakes = createFakes({
    files: { "src/app.ts": "export const value = 1;\nconst a = value;\n" },
    references: [
      {
        root: "/repo/tide",
        path: "/repo/tide/src/app.ts",
        relativePath: "src/app.ts",
        line: 0,
        character: 13,
        length: 5,
        label: "export const value = 1;",
      },
      {
        root: "/repo/tide",
        path: "/repo/tide/src/app.ts",
        relativePath: "src/app.ts",
        line: 1,
        character: 10,
        length: 5,
        label: "const a = value;",
      },
    ],
  });
  const initialWorkbench = {
    activePaneId: "pane-source",
    focusOwner: "workbench" as const,
    panes: [
      {
        paneId: "pane-source",
        kind: "editor" as const,
        title: "app.ts",
        filePath: "/repo/tide/src/app.ts",
        relativePath: "src/app.ts",
        visible: true,
        revision: "rev-source",
        updatedAt: now,
        bodyText: "export const value = 1;\nconst a = value;\n",
        bodyTextPreview: "export const value = 1;\nconst a = value;\n",
        byteLength: 40,
        truncated: false,
      },
    ],
  };
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [
      threadSeed("thread-refs", {
        scope: { kind: "project", projectId: "tide", cwd: "/repo/tide" },
        workbench: initialWorkbench,
      }),
    ],
  });

  const result = await service.handleWorkbenchCommand({
    threadId: "thread-refs",
    command: "go_to_references",
    targetPaneId: "pane-source",
    data: { line: 0, character: 13 },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(fakes.codeIntelligence.referenceCalls[0], {
    root: "/repo/tide",
    path: "/repo/tide/src/app.ts",
    line: 0,
    character: 13,
  });
  const hydrated = await service.hydrateThread({ threadId: "thread-refs" });
  const sourcePane =
    hydrated.ok && hydrated.thread.workbench.panes.find((pane) => pane.paneId === "pane-source");
  assert.ok(sourcePane && sourcePane.kind === "editor");
  assert.equal(sourcePane.references?.items.length, 2);
  assert.equal(sourcePane.references?.truncated, false);
  assert.deepEqual(
    sourcePane.references?.items.map((item) => item.line),
    [0, 1],
  );
  assert.equal(hydrated.ok && hydrated.thread.workbench.activePaneId, "pane-source");
});

test("opening_workbench_launcher_creates_or_reveals_single_launcher_pane", async () => {
  // Spec: docs_v2/specs/workbench-launcher-pane.md
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [threadSeed("thread-launcher")],
  });

  const opened = await service.handleWorkbenchCommand({
    threadId: "thread-launcher",
    command: "open_launcher",
  });
  const openedAgain = await service.handleWorkbenchCommand({
    threadId: "thread-launcher",
    command: "open_launcher",
  });
  const closed = await service.handleWorkbenchCommand({
    threadId: "thread-launcher",
    command: "close_pane",
    targetPaneId: opened.ok ? opened.thread.workbench.panes[0]?.paneId : undefined,
  });
  const revealed = await service.handleWorkbenchCommand({
    threadId: "thread-launcher",
    command: "open_launcher",
  });

  assert.equal(opened.ok, true);
  assert.equal(opened.ok && opened.thread.workbench.panes[0]?.kind, "launcher");
  assert.equal(opened.ok && opened.thread.workbench.focusOwner, "workbench");
  assert.deepEqual(
    opened.ok &&
      opened.thread.workbench.panes[0]?.actions.map((action) => action.actionId),
    ["open_browser", "open_editor", "open_terminal", "open_diff", "open_file_tree"],
  );
  assert.equal(openedAgain.ok, true);
  assert.equal(openedAgain.ok && openedAgain.thread.workbench.panes.length, 1);
  assert.equal(closed.ok, true);
  assert.equal(revealed.ok, true);
  assert.equal(revealed.ok && revealed.thread.workbench.panes.length, 1);
  assert.equal(revealed.ok && revealed.thread.workbench.panes[0]?.visible, true);
});

test("opening_browser_from_workbench_command_creates_visible_browser_pane", async () => {
  // Spec: docs_v2/specs/workbench-launcher-pane.md
  const service = createThreadRuntimeService({
    ...createFakes().ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [threadSeed("thread-browser-command")],
  });

  const opened = await service.handleWorkbenchCommand({
    threadId: "thread-browser-command",
    command: "open_browser",
    data: {
      url: "http://localhost:5173/",
      title: "Local preview",
    },
  });

  assert.equal(opened.ok, true);
  assert.equal(opened.ok && opened.thread.workbench.panes[0]?.kind, "browser");
  assert.equal(opened.ok && opened.thread.workbench.panes[0]?.title, "Local preview");
  assert.equal(opened.ok && opened.thread.workbench.panes[0]?.url, "http://localhost:5173/");
  assert.equal(opened.ok && opened.thread.workbench.activePaneId, "id-1");
  assert.equal(opened.ok && opened.thread.workbench.focusOwner, "workbench");
});

test("browser_snapshot_command_updates_observable_browser_preview", async () => {
  // Spec: docs_v2/specs/workbench-browser-pane-evidence-loop.md
  const service = createThreadRuntimeService({
    ...createFakes().ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [threadSeed("thread-browser-snapshot")],
  });

  const opened = await service.handleWorkbenchCommand({
    threadId: "thread-browser-snapshot",
    command: "open_browser",
    data: { url: "https://example.test" },
  });
  const result = await service.handleWorkbenchCommand({
    threadId: "thread-browser-snapshot",
    command: "update_browser_snapshot",
    targetPaneId: "id-1",
    data: {
      revision: "id-2",
      url: "https://example.test/ready",
      pageTitle: "Example ready",
      bodyTextPreview: "Loaded page body",
      loading: false,
    },
  });

  assert.equal(opened.ok, true);
  assert.equal(result.ok, true);
  const browserPane = result.ok ? result.thread.workbench.panes[0] : undefined;
  assert.equal(browserPane?.kind, "browser");
  assert.equal(browserPane?.kind === "browser" && browserPane.pageTitle, "Example ready");
  assert.equal(browserPane?.kind === "browser" && browserPane.url, "https://example.test/ready");
  assert.equal(
    browserPane?.kind === "browser" && browserPane.bodyTextPreview,
    "Loaded page body",
  );
  assert.equal(browserPane?.kind === "browser" && browserPane.loading, false);
  assert.equal(browserPane?.kind === "browser" && browserPane.revision, "id-3");
  assert.equal(result.ok && result.thread.workbench.focusOwner, "workbench");
});

test("browser_snapshot_with_stale_revision_does_not_mutate_browser_pane", async () => {
  // Spec: docs_v2/specs/workbench-browser-pane-evidence-loop.md
  const service = createThreadRuntimeService({
    ...createFakes().ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [threadSeed("thread-browser-stale-snapshot")],
  });

  const opened = await service.handleWorkbenchCommand({
    threadId: "thread-browser-stale-snapshot",
    command: "open_browser",
    data: { url: "https://example.test/old" },
  });
  const navigated = await service.handleWorkbenchCommand({
    threadId: "thread-browser-stale-snapshot",
    command: "open_browser",
    data: { url: "https://example.test/new" },
  });
  const result = await service.handleWorkbenchCommand({
    threadId: "thread-browser-stale-snapshot",
    command: "update_browser_snapshot",
    targetPaneId: "id-1",
    data: {
      revision: "id-2",
      url: "https://example.test/old",
      pageTitle: "Old page",
      bodyTextPreview: "stale body",
      loading: false,
    },
  });

  assert.equal(opened.ok, true);
  assert.equal(navigated.ok, true);
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error.code, "workbench_stale_reference");
  const hydrated = await service.hydrateThread({ threadId: "thread-browser-stale-snapshot" });
  const browserPane = hydrated.ok ? hydrated.thread.workbench.panes[0] : undefined;
  assert.equal(browserPane?.kind, "browser");
  assert.equal(browserPane?.kind === "browser" && browserPane.url, "https://example.test/new");
  assert.equal(browserPane?.kind === "browser" && browserPane.bodyTextPreview, undefined);
  assert.equal(browserPane?.kind === "browser" && browserPane.revision, "id-3");
});

test("opening_workbench_terminal_starts_thread_scoped_terminal_pane", async () => {
  // Spec: docs_v2/specs/workbench-terminal-pane-session.md
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    defaultWorkbenchTerminalCommand: "zsh",
    initialThreads: [
      threadSeed("thread-terminal", {
        scope: { kind: "project", projectId: "tide", cwd: "/repo/tide" },
      }),
    ],
  });

  const opened = await service.handleWorkbenchCommand({
    threadId: "thread-terminal",
    command: "open_terminal",
  });

  assert.equal(opened.ok, true);
  assert.equal(fakes.workbenchTerminal.starts[0]?.command, "zsh");
  assert.equal(fakes.workbenchTerminal.starts[0]?.cwd, "/repo/tide");
  assert.equal(opened.ok && opened.thread.workbench.panes[0]?.kind, "terminal");
  assert.equal(opened.ok && opened.thread.workbench.panes[0]?.title, "Terminal");
  assert.equal(opened.ok && opened.thread.workbench.panes[0]?.status, "running");
  assert.equal(opened.ok && opened.thread.workbench.focusOwner, "workbench");
});

test("workbench_terminal_input_writes_to_visible_terminal_handle", async () => {
  // Spec: docs_v2/specs/workbench-terminal-pane-session.md
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    defaultWorkbenchTerminalCommand: "zsh",
    initialThreads: [
      threadSeed("thread-terminal-input", {
        scope: { kind: "project", projectId: "tide", cwd: "/repo/tide" },
      }),
    ],
  });

  const opened = await service.handleWorkbenchCommand({
    threadId: "thread-terminal-input",
    command: "open_terminal",
  });
  const paneId = opened.ok ? opened.thread.workbench.panes[0]?.paneId : "";
  const written = await service.handleWorkbenchCommand({
    threadId: "thread-terminal-input",
    command: "write_terminal_input",
    targetPaneId: paneId,
    data: { bytes: "pwd\r" },
  });

  assert.equal(written.ok, true);
  assert.deepEqual(fakes.runtime.events, []);
  assert.deepEqual(fakes.setupSurface.writes, []);
  assert.deepEqual(fakes.workbenchTerminal.handles[0]?.writes, ["pwd\r"]);
});

test("saving_editor_pane_writes_open_file_and_refreshes_revision", async () => {
  // Spec: docs_v2/specs/workbench-editor-pane-editing.md
  const fakes = createFakes({
    files: {
      "README.md": "# Tide\n",
    },
  });
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [
      threadSeed("thread-editor-save", {
        scope: { kind: "project", projectId: "tide", cwd: "/repo/tide" },
        workbench: {
          activePaneId: "pane-editor",
          focusOwner: "workbench",
          panes: [
            {
              paneId: "pane-editor",
              kind: "editor",
              title: "README.md",
              filePath: "/repo/tide/README.md",
              relativePath: "README.md",
              visible: true,
              revision: "rev-1",
              updatedAt: now,
              bodyText: "# Tide\n",
              bodyTextPreview: "# Tide\n",
              byteLength: 7,
              truncated: false,
            },
          ],
        },
      }),
    ],
  });

  const saved = await service.handleWorkbenchCommand({
    threadId: "thread-editor-save",
    command: "save_editor_file",
    targetPaneId: "pane-editor",
    data: {
      baseRevision: "rev-1",
      content: "# Tide\n\nEdited in Workbench\n",
    },
  });

  assert.equal(saved.ok, true);
  assert.equal(fakes.workspaceFiles.content("README.md"), "# Tide\n\nEdited in Workbench\n");
  assert.deepEqual(fakes.workspaceFiles.writeCalls.map((call) => call.path), [
    "/repo/tide/README.md",
  ]);
  const pane = saved.ok
    ? saved.thread.workbench.panes.find((candidate) => candidate.kind === "editor")
    : undefined;
  assert.equal(pane?.paneId, "pane-editor");
  assert.equal(pane?.bodyText, "# Tide\n\nEdited in Workbench\n");
  assert.equal(pane?.bodyTextPreview, "# Tide\n\nEdited in Workbench\n");
  assert.notEqual(pane?.revision, "rev-1");
  assert.equal(saved.ok && saved.thread.workbench.activePaneId, "pane-editor");
  assert.equal(saved.ok && saved.thread.workbench.focusOwner, "workbench");
});

test("saving_editor_pane_with_stale_revision_returns_conflict_without_write", async () => {
  // Spec: docs_v2/specs/workbench-editor-pane-editing.md
  const fakes = createFakes({
    files: {
      "README.md": "# Tide\n",
    },
  });
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [
      threadSeed("thread-editor-stale", {
        scope: { kind: "project", projectId: "tide", cwd: "/repo/tide" },
        workbench: {
          activePaneId: "pane-editor",
          focusOwner: "workbench",
          panes: [
            {
              paneId: "pane-editor",
              kind: "editor",
              title: "README.md",
              filePath: "/repo/tide/README.md",
              relativePath: "README.md",
              visible: true,
              revision: "rev-current",
              updatedAt: now,
              bodyText: "# Tide\n",
              bodyTextPreview: "# Tide\n",
              byteLength: 7,
              truncated: false,
            },
          ],
        },
      }),
    ],
  });

  const saved = await service.handleWorkbenchCommand({
    threadId: "thread-editor-stale",
    command: "save_editor_file",
    targetPaneId: "pane-editor",
    data: {
      baseRevision: "rev-old",
      content: "stale overwrite",
    },
  });

  assert.equal(saved.ok, false);
  assert.equal(!saved.ok && saved.error.code, "workbench_stale_reference");
  assert.equal(fakes.workspaceFiles.content("README.md"), "# Tide\n");
  assert.deepEqual(fakes.workspaceFiles.writeCalls, []);
});

test("saving_truncated_editor_pane_returns_conflict_without_write", async () => {
  // Spec: docs_v2/specs/workbench-editor-pane-editing.md
  const fakes = createFakes({
    files: {
      "large.md": "full content",
    },
  });
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [
      threadSeed("thread-editor-truncated", {
        scope: { kind: "project", projectId: "tide", cwd: "/repo/tide" },
        workbench: {
          activePaneId: "pane-editor",
          focusOwner: "workbench",
          panes: [
            {
              paneId: "pane-editor",
              kind: "editor",
              title: "large.md",
              filePath: "/repo/tide/large.md",
              relativePath: "large.md",
              visible: true,
              revision: "rev-large",
              updatedAt: now,
              bodyText: "partial",
              bodyTextPreview: "partial",
              byteLength: 200000,
              truncated: true,
            },
          ],
        },
      }),
    ],
  });

  const saved = await service.handleWorkbenchCommand({
    threadId: "thread-editor-truncated",
    command: "save_editor_file",
    targetPaneId: "pane-editor",
    data: {
      baseRevision: "rev-large",
      content: "partial overwrite",
    },
  });

  assert.equal(saved.ok, false);
  assert.equal(!saved.ok && saved.error.code, "workspace_file_edit_conflict");
  assert.equal(fakes.workspaceFiles.content("large.md"), "full content");
  assert.deepEqual(fakes.workspaceFiles.writeCalls, []);
});

test("backend_application_does_not_import_shared_contracts_or_adapters", () => {
  assert.deepEqual(
    findSourceMentions(["src/backend/application"], [
      /from\s+["'][^"']*shared\/contracts/,
      /import\(["'][^"']*shared\/contracts/,
      /from\s+["'][^"']*backend\/adapters/,
      /import\(["'][^"']*backend\/adapters/,
      /from\s+["'][^"']*backend\/infrastructure/,
      /import\(["'][^"']*backend\/infrastructure/,
      /from\s+["'](?:node:)?(?:fs|path|child_process|node-pty|electron|react)["']/,
    ]),
    [],
  );
});

function threadSeed(
  threadId: string,
  overrides: Partial<ThreadSeed> = {},
): ThreadSeed {
  return {
    threadId,
    title: "Lifecycle thread",
    agentBinding: {
      agentId: "codex",
      providerSessionRef: overrides.providerSessionRef,
    },
    scope: { kind: "scratch", scratchCwd: `/tmp/${threadId}` },
    lifecycleState: "open",
    runtimeState: "not_started",
    lastKnownState: "idle",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function browserPane(paneId: string, title: string) {
  return {
    paneId,
    kind: "browser" as const,
    title,
    visible: true,
    revision: `${paneId}:rev`,
    updatedAt: now,
    loading: false,
  };
}

function createFakes(options: {
  readiness?: ProviderReadinessResult;
  fileTreeEntries?: WorkspaceFileTreeEntry[];
  files?: Record<string, string>;
  definition?: WorkspaceCodeLocation;
  definitionError?: {
    code: "workspace_code_intelligence_unavailable" | "workspace_code_definition_not_found";
    message: string;
  };
  references?: WorkspaceCodeLocation[];
} = {}) {
  const runtime = new FakeAgentRuntimePort();
  const readiness = new FakeProviderReadinessPort(
    options.readiness ?? {
      ready: true,
      agentId: "codex",
      blockers: [],
    },
  );
  const transcript = new FakePtyTranscriptPort();
  const setupSurface = new FakeProviderSetupSurfaceTerminalPort();
  const workspaceCommand = new FakeWorkspaceCommandPort();
  const workbenchTerminal = new FakeWorkbenchTerminalPort();
  const workspaceFiles = new FakeWorkspaceFilePort(
    options.fileTreeEntries ?? [],
    options.files ?? {},
  );
  const codeIntelligence = new FakeWorkspaceCodeIntelligencePort(
    options.definition,
    options.definitionError,
    options.references,
  );

  return {
    runtime,
    readiness,
    transcript,
    setupSurface,
    workspaceCommand,
    workbenchTerminal,
    workspaceFiles,
    codeIntelligence,
    ports: {
      agentRuntimePort: runtime,
      providerReadinessPort: readiness,
      ptyTranscriptPort: transcript,
      providerSetupSurfaceTerminalPort: setupSurface,
      workbenchTerminalPort: workbenchTerminal,
      workspaceCommandPort: workspaceCommand,
      workspaceFilePort: workspaceFiles,
      workspaceCodeIntelligencePort: codeIntelligence,
    },
  };
}

class FakeAgentRuntimePort implements AgentRuntimePort {
  events: string[] = [];
  starts: AgentRuntimeStartInput[] = [];
  resumes: AgentRuntimeResumeInput[] = [];
  writes: { handle: AgentRuntimeHandle; input: TerminalInput }[] = [];
  stops: AgentRuntimeHandle[] = [];

  async start(input: AgentRuntimeStartInput): Promise<AgentRuntimeHandle> {
    this.events.push("start");
    this.starts.push(input);
    return {
      runtimeId: `runtime-start-${this.starts.length}`,
      threadId: input.threadId,
      agentId: input.agentBinding.agentId,
    };
  }

  async resume(input: AgentRuntimeResumeInput): Promise<AgentRuntimeHandle> {
    this.events.push("resume");
    this.resumes.push(input);
    return {
      runtimeId: `runtime-resume-${this.resumes.length}`,
      threadId: input.threadId,
      agentId: input.agentBinding.agentId,
    };
  }

  async writeInput(
    handle: AgentRuntimeHandle,
    input: TerminalInput,
  ): Promise<void> {
    this.events.push("writeInput");
    this.writes.push({ handle, input });
  }

  async stop(handle: AgentRuntimeHandle): Promise<void> {
    this.events.push("stop");
    this.stops.push(handle);
  }
}

class FakeProviderReadinessPort implements ProviderReadinessPort {
  checks: ProviderReadinessCheckInput[] = [];
  private result: ProviderReadinessResult;

  constructor(result: ProviderReadinessResult) {
    this.result = result;
  }

  setResult(result: ProviderReadinessResult): void {
    this.result = result;
  }

  async check(
    input: ProviderReadinessCheckInput,
  ): Promise<ProviderReadinessResult> {
    this.checks.push(input);
    return {
      ...this.result,
      agentId: input.agentId,
    };
  }
}

class FakePtyTranscriptPort implements PtyTranscriptPort {
  frames: RawAgentFrame[] = [];

  async append(frame: RawAgentFrame): Promise<void> {
    this.frames.push(frame);
  }
}

class FakeProviderSetupSurfaceTerminalPort implements ProviderSetupSurfaceTerminalPort {
  starts: ProviderSetupSurfaceStartInput[] = [];
  stops: string[] = [];
  writes: string[] = [];
  outputsOnStart: ProviderSetupSurfaceOutput[] = [];

  async start(input: ProviderSetupSurfaceStartInput): Promise<ProviderSetupSurfaceHandle> {
    this.starts.push(input);
    for (const output of this.outputsOnStart) {
      input.onOutput?.(output);
    }
    const runtimeId = `setup-runtime-${this.starts.length}`;
    return {
      surfaceRuntimeId: runtimeId,
      write: (data) => {
        this.writes.push(data);
      },
      stop: () => {
        this.stops.push(runtimeId);
      },
    };
  }

  async emitExit(index: number, exit: { exitCode: number | null; signal: string | null }): Promise<void> {
    await this.starts[index].onExit?.(exit);
  }
}

class FakeWorkspaceCommandPort implements WorkspaceCommandPort {
  async resolveCwd(input: { root: string; cwd?: string }): Promise<WorkspaceCommandCwdResult> {
    const cwd = input.cwd ?? input.root;
    if (!cwd.startsWith(input.root)) {
      return {
        ok: false,
        error: {
          code: "workspace_command_outside_scope",
          message: "CWD is outside the Thread root.",
        },
      };
    }
    return {
      ok: true,
      cwd: {
        root: input.root,
        cwd,
        relativeCwd: cwd === input.root ? "." : cwd.slice(input.root.length + 1),
      },
    };
  }

  async run(): Promise<WorkspaceCommandRunResult> {
    return {
      ok: false,
      error: {
        code: "workspace_command_unavailable",
        message: "Workspace command run is not configured in this fake.",
      },
    };
  }
}

class FakeWorkbenchTerminalPort implements WorkbenchTerminalPort {
  starts: WorkbenchTerminalStartInput[] = [];
  handles: Array<{ runtimeId: string; writes: string[]; stops: string[] }> = [];

  async start(input: WorkbenchTerminalStartInput): Promise<WorkbenchTerminalHandle> {
    this.starts.push(input);
    const handleState = {
      runtimeId: `workbench-terminal-${this.starts.length}`,
      writes: [] as string[],
      stops: [] as string[],
    };
    this.handles.push(handleState);
    return {
      terminalRuntimeId: handleState.runtimeId,
      write: (data) => {
        handleState.writes.push(data);
      },
      stop: () => {
        handleState.stops.push(handleState.runtimeId);
      },
    };
  }

  emitOutput(index: number, output: WorkbenchTerminalOutput): void {
    this.starts[index]?.onOutput?.(output);
  }
}

class FakeWorkspaceCodeIntelligencePort implements WorkspaceCodeIntelligencePort {
  readonly definitionCalls: Array<{
    root: string;
    path: string;
    line: number;
    character: number;
  }> = [];
  private readonly definition: WorkspaceCodeLocation | undefined;
  private readonly definitionError:
    | {
        code: "workspace_code_intelligence_unavailable" | "workspace_code_definition_not_found";
        message: string;
      }
    | undefined;

  readonly referenceCalls: Array<{
    root: string;
    path: string;
    line: number;
    character: number;
  }> = [];
  private readonly references: WorkspaceCodeLocation[] | undefined;

  constructor(
    definition: WorkspaceCodeLocation | undefined,
    definitionError:
      | {
          code: "workspace_code_intelligence_unavailable" | "workspace_code_definition_not_found";
          message: string;
        }
      | undefined,
    references?: WorkspaceCodeLocation[],
  ) {
    this.definition = definition;
    this.definitionError = definitionError;
    this.references = references;
  }

  async findDefinition(input: {
    root: string;
    path: string;
    line: number;
    character: number;
  }): Promise<WorkspaceCodeDefinitionResult> {
    this.definitionCalls.push(input);
    if (this.definitionError !== undefined) {
      return {
        ok: false,
        error: this.definitionError,
      };
    }
    if (this.definition === undefined) {
      return {
        ok: false,
        error: {
          code: "workspace_code_definition_not_found",
          message: "Definition target was not found.",
        },
      };
    }
    return {
      ok: true,
      location: this.definition,
    };
  }

  async findReferences(input: {
    root: string;
    path: string;
    line: number;
    character: number;
  }): Promise<WorkspaceCodeReferencesResult> {
    this.referenceCalls.push(input);
    if (this.references === undefined || this.references.length === 0) {
      return {
        ok: false,
        error: {
          code: "workspace_code_references_not_found",
          message: "No references were found for the selected symbol.",
        },
      };
    }
    return { ok: true, locations: this.references, truncated: false };
  }
}

class FakeWorkspaceFilePort implements WorkspaceFilePort {
  readonly listCalls: { root: string; maxDepth: number; maxEntries: number }[] = [];
  readonly writeCalls: { root: string; path: string; content: string }[] = [];
  private readonly entries: WorkspaceFileTreeEntry[];
  private readonly files: Record<string, string>;

  constructor(entries: WorkspaceFileTreeEntry[], files: Record<string, string>) {
    this.entries = entries;
    this.files = { ...files };
  }

  async readTextFile(input: {
    root: string;
    path: string;
    byteLimit: number;
  }): Promise<WorkspaceFileReadResult> {
    const relativePath = relativePathFromRoot(input.root, input.path);
    const content = this.files[relativePath];
    if (content !== undefined) {
      const preview = content.slice(0, input.byteLimit);
      return {
        ok: true,
        file: {
          root: input.root,
          path: `${input.root}/${relativePath}`,
          relativePath,
          content: preview,
          byteLength: content.length,
          truncated: preview.length < content.length,
        },
      };
    }
    return {
      ok: false,
      error: {
        code: "workspace_file_not_found",
        message: "Workspace file read target was not found in this fake.",
      },
    };
  }

  async replaceText(): Promise<WorkspaceFileEditResult> {
    return {
      ok: false,
      error: {
        code: "workspace_file_unavailable",
        message: "Workspace file edit is not configured in this fake.",
      },
    };
  }

  async writeTextFile(input: {
    root: string;
    path: string;
    content: string;
    byteLimit: number;
  }): Promise<WorkspaceFileWriteResult> {
    const relativePath = relativePathFromRoot(input.root, input.path);
    this.writeCalls.push({
      root: input.root,
      path: input.path,
      content: input.content,
    });
    this.files[relativePath] = input.content;
    const preview = input.content.slice(0, input.byteLimit);
    return {
      ok: true,
      file: {
        root: input.root,
        path: `${input.root}/${relativePath}`,
        relativePath,
        content: preview,
        byteLength: input.content.length,
        truncated: preview.length < input.content.length,
      },
    };
  }

  async listTree(input: {
    root: string;
    maxDepth: number;
    maxEntries: number;
  }): Promise<WorkspaceFileTreeResult> {
    this.listCalls.push(input);
    return {
      ok: true,
      fileTree: {
        root: input.root,
        cwdLabel: path.basename(input.root),
        revision: "fake-tree-rev",
        updatedAt: now,
        entries: this.entries.slice(0, input.maxEntries),
        truncated: this.entries.length > input.maxEntries,
      },
    };
  }

  content(path: string): string | undefined {
    return this.files[path];
  }
}

function relativePathFromRoot(root: string, filePath: string): string {
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath;
}

function fixedClock(): string {
  return now;
}

function sequentialIdGenerator(prefix: string): () => string {
  let nextId = 1;
  return () => `${prefix}-${nextId++}`;
}

function findSourceMentions(relativeRoots: string[], patterns: RegExp[]): string[] {
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const violations: string[] = [];

  for (const relativeRoot of relativeRoots) {
    const absoluteRoot = path.join(repoRoot, relativeRoot);
    if (!fs.existsSync(absoluteRoot)) {
      continue;
    }
    for (const filePath of sourceFiles(absoluteRoot)) {
      const source = fs.readFileSync(filePath, "utf8");
      if (patterns.some((pattern) => pattern.test(source))) {
        violations.push(path.relative(repoRoot, filePath));
      }
    }
  }

  return violations.sort();
}

function sourceFiles(root: string): string[] {
  const files: string[] = [];
  const entries = fs.readdirSync(root, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(fullPath));
      continue;
    }
    if (/\.(cjs|cts|js|jsx|mjs|mts|ts|tsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}
