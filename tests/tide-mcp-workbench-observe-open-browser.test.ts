// Spec: docs_v2/specs/tide-mcp-workbench-observe-open-browser.md

import assert from "node:assert/strict";
import test from "node:test";

import { createTideMcpToolSurfaceAdapter } from "../src/backend/adapters/inbound/tide-mcp-tool-surface/tide-mcp-tool-surface-adapter.ts";
import {
  createThreadRuntimeService,
  type AgentRuntimeHandle,
  type AgentRuntimePort,
  type AgentRuntimeResumeInput,
  type AgentRuntimeStartInput,
  type ProviderReadinessCheckInput,
  type ProviderReadinessPort,
  type ProviderReadinessResult,
  type PtyTranscriptPort,
  type RawAgentFrame,
  type TerminalInput,
  type ThreadSeed,
} from "../src/backend/application/services/thread-runtime-service.ts";

const now = "2026-05-27T00:00:00.000Z";

// --- UC-1: Agent observes Thread ---

test("mcp_session_without_explicit_thread_id_resolves_thread_from_agent_runtime_session", async () => {
  // UC-1 BR-1: MCP Session resolves Thread.
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [
      threadSeed("thread-mcp", {
        activeRuntimeHandle: runtimeHandle("thread-mcp", "runtime-mcp"),
        runtimeState: "running",
      }),
    ],
  });

  const result = await service.handleTideMcpToolCall({
    session: { runtimeId: "runtime-mcp", agentId: "codex" },
    toolName: "tide_observe_thread",
    input: { detail: "compact" },
  });

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.output.kind, "observe_thread");
  assert.equal(result.ok && result.output.threadId, "thread-mcp");
  assert.equal(result.ok && result.output.agentId, "codex");
  assert.deepEqual(fakes.runtime.events, []);
});

test("tide_mcp_tool_surface_lists_only_first_slice_tools", () => {
  // UC-1 BR-2: Tool list is bounded.
  const service = createThreadRuntimeService({
    ...createFakes().ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
  });
  const adapter = createTideMcpToolSurfaceAdapter({ service });

  assert.deepEqual(
    adapter.listTools().map((tool) => tool.name),
    [
      "tide_observe_thread",
      "tide_observe_workbench",
      "tide_open_browser",
      "tide_observe_browser",
    ],
  );
});

// --- UC-2: Agent observes Workbench ---

test("observing_workbench_returns_snapshot_without_mutating_panes", async () => {
  // UC-2 BR-1: Observe is read-only.
  const service = serviceWithActiveThread("thread-observe", "runtime-observe");
  await openBrowser(service, "runtime-observe", "https://example.test");

  const before = await service.handleTideMcpToolCall({
    session: { runtimeId: "runtime-observe", agentId: "codex" },
    toolName: "tide_observe_workbench",
  });
  const after = await service.handleTideMcpToolCall({
    session: { runtimeId: "runtime-observe", agentId: "codex" },
    toolName: "tide_observe_workbench",
  });

  assert.equal(before.ok, true);
  assert.equal(after.ok, true);
  assert.deepEqual(before.ok && before.output, after.ok && after.output);
});

// --- UC-3: Agent opens Browser Pane ---

test("opening_browser_creates_visible_browser_pane_in_thread_workbench", async () => {
  // UC-3 BR-1: Open Browser creates visible pane.
  const service = serviceWithActiveThread("thread-browser", "runtime-browser");

  const opened = await openBrowser(
    service,
    "runtime-browser",
    "https://example.test/docs",
  );
  const observed = await service.handleTideMcpToolCall({
    session: { runtimeId: "runtime-browser", agentId: "codex" },
    toolName: "tide_observe_workbench",
  });

  assert.equal(opened.output.kind, "open_browser");
  assert.equal(opened.output.visibleSideEffect, "created");
  assert.equal(opened.output.pane.kind, "browser");
  assert.equal(opened.output.pane.visible, true);
  assert.equal(opened.output.pane.url, "https://example.test/docs");
  assert.equal(observed.ok, true);
  assert.equal(observed.ok && observed.output.panes.length, 1);
  assert.equal(
    observed.ok && observed.output.panes[0]?.paneId,
    opened.output.pane.paneId,
  );
});

test("opening_browser_uses_tide_workbench_and_not_external_browser", async () => {
  // UC-3 BR-2: Open Browser does not open OS browser.
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [
      threadSeed("thread-no-external", {
        activeRuntimeHandle: runtimeHandle("thread-no-external", "runtime-no-external"),
        runtimeState: "running",
      }),
    ],
  });

  const opened = await openBrowser(
    service,
    "runtime-no-external",
    "https://example.test/no-external",
  );

  assert.equal(opened.output.pane.visible, true);
  assert.equal(opened.output.pane.kind, "browser");
  assert.deepEqual(fakes.runtime.events, []);
});

test("opening_browser_preserves_composer_focus_by_default", async () => {
  // UC-3 BR-3: Focus is preserved.
  const service = serviceWithActiveThread("thread-focus", "runtime-focus");

  await openBrowser(service, "runtime-focus", "https://example.test/focus");
  const observed = await service.handleTideMcpToolCall({
    session: { runtimeId: "runtime-focus", agentId: "codex" },
    toolName: "tide_observe_workbench",
  });

  assert.equal(observed.ok, true);
  assert.equal(observed.ok && observed.output.focusOwner, "composer");
});

// --- UC-4: Agent observes Browser Pane ---

test("observing_browser_pane_from_another_thread_returns_structured_error", async () => {
  // UC-4 BR-1: Browser observe checks ownership.
  const service = serviceWithActiveThreads([
    ["thread-a", "runtime-a"],
    ["thread-b", "runtime-b"],
  ]);
  const opened = await openBrowser(service, "runtime-a", "https://example.test/a");

  const result = await service.handleTideMcpToolCall({
    session: { runtimeId: "runtime-b", agentId: "codex" },
    toolName: "tide_observe_browser",
    input: { paneId: opened.output.pane.paneId },
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok ? undefined : result.error.code, "workbench_target_not_found");
});

test("observing_browser_with_stale_revision_returns_structured_error", async () => {
  // UC-4 BR-2: Stale revision is detected.
  const service = serviceWithActiveThread("thread-stale", "runtime-stale");
  const first = await openBrowser(service, "runtime-stale", "https://example.test/old");
  const second = await openBrowser(service, "runtime-stale", "https://example.test/new");

  assert.equal(first.output.pane.paneId, second.output.pane.paneId);
  assert.notEqual(first.output.pane.revision, second.output.pane.revision);

  const result = await service.handleTideMcpToolCall({
    session: { runtimeId: "runtime-stale", agentId: "codex" },
    toolName: "tide_observe_browser",
    input: {
      paneId: first.output.pane.paneId,
      revision: first.output.pane.revision,
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok ? undefined : result.error.code, "workbench_stale_reference");
});

function serviceWithActiveThread(threadId: string, runtimeId: string) {
  return serviceWithActiveThreads([[threadId, runtimeId]]);
}

function serviceWithActiveThreads(entries: [string, string][]) {
  return createThreadRuntimeService({
    ...createFakes().ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: entries.map(([threadId, runtimeId]) =>
      threadSeed(threadId, {
        activeRuntimeHandle: runtimeHandle(threadId, runtimeId),
        runtimeState: "running",
      }),
    ),
  });
}

async function openBrowser(
  service: ReturnType<typeof createThreadRuntimeService>,
  runtimeId: string,
  url: string,
) {
  const result = await service.handleTideMcpToolCall({
    session: { runtimeId, agentId: "codex" },
    toolName: "tide_open_browser",
    input: { url },
  });

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.output.kind, "open_browser");
  return result as Extract<typeof result, { ok: true }>;
}

function threadSeed(
  threadId: string,
  overrides: Partial<ThreadSeed> = {},
): ThreadSeed {
  return {
    threadId,
    title: "MCP Workbench thread",
    agentBinding: {
      agentId: "codex",
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

function runtimeHandle(threadId: string, runtimeId: string): AgentRuntimeHandle {
  return {
    runtimeId,
    threadId,
    agentId: "codex",
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
  writes: { handle: AgentRuntimeHandle; input: TerminalInput }[] = [];

  async start(input: AgentRuntimeStartInput): Promise<AgentRuntimeHandle> {
    this.events.push("start");
    return runtimeHandle(input.threadId, `runtime-start-${this.events.length}`);
  }

  async resume(input: AgentRuntimeResumeInput): Promise<AgentRuntimeHandle> {
    this.events.push("resume");
    return runtimeHandle(input.threadId, `runtime-resume-${this.events.length}`);
  }

  async writeInput(
    handle: AgentRuntimeHandle,
    input: TerminalInput,
  ): Promise<void> {
    this.events.push("writeInput");
    this.writes.push({ handle, input });
  }

  async stop(_handle: AgentRuntimeHandle): Promise<void> {
    this.events.push("stop");
  }
}

class FakeProviderReadinessPort implements ProviderReadinessPort {
  private readonly result: ProviderReadinessResult;

  constructor(result: ProviderReadinessResult) {
    this.result = result;
  }

  async check(
    input: ProviderReadinessCheckInput,
  ): Promise<ProviderReadinessResult> {
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
