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
  type PtyTranscriptPort,
  type RawAgentFrame,
  type TerminalInput,
  type ThreadSeed,
} from "../src/backend/application/services/thread-runtime-service.ts";

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
    initialThreads: [threadSeed("thread-mcp")],
  });

  const result = await service.handleTideMcpToolCall({
    threadId: "thread-mcp",
    toolName: "tide.workbench.observe",
    input: { includePanes: true },
  });

  assert.equal(result.ok, true);
  assert.equal(result.handledByService, true);
  assert.equal(result.mcpToolCallCount, 1);
  assert.deepEqual(fakes.runtime.events, []);
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

function createFakes(options: { readiness?: ProviderReadinessResult } = {}) {
  const runtime = new FakeAgentRuntimePort();
  const readiness = new FakeProviderReadinessPort(
    options.readiness ?? {
      ready: true,
      agentId: "codex",
      blockers: [],
    },
  );
  const transcript = new FakePtyTranscriptPort();

  return {
    runtime,
    readiness,
    transcript,
    ports: {
      agentRuntimePort: runtime,
      providerReadinessPort: readiness,
      ptyTranscriptPort: transcript,
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
  private readonly result: ProviderReadinessResult;

  constructor(result: ProviderReadinessResult) {
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
