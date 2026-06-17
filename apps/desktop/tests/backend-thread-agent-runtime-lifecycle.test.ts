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
  type ComposerAttachmentInput,
  type ComposerAttachmentStorePort,
  type ProviderTrustPort,
} from "../src/backend/application/services/thread/thread-runtime-service.ts";
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

test("archiving_a_thread_excludes_it_from_the_default_list_but_keeps_it_retrievable", async () => {
  // Spec: docs_v2/specs/backend-thread-list-product-shell-bootstrap.md
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [threadSeed("thread-keep"), threadSeed("thread-archive")],
  });

  const archived = await service.archiveThread({ threadId: "thread-archive", archived: true });
  assert.equal(archived.ok, true);
  assert.equal(archived.ok && archived.thread.lifecycleState, "archived");

  const visible = await service.listThreads({});
  assert.deepEqual(
    (visible.ok ? visible.threads : []).map((thread) => thread.threadId),
    ["thread-keep"],
  );

  const all = await service.listThreads({ includeArchived: true });
  assert.equal(
    all.ok && all.threads.some((thread) => thread.threadId === "thread-archive"),
    true,
  );

  // Unarchiving restores it to the default list.
  const restored = await service.archiveThread({ threadId: "thread-archive", archived: false });
  assert.equal(restored.ok, true);
  const visibleAgain = await service.listThreads({});
  assert.equal(
    visibleAgain.ok && visibleAgain.threads.some((thread) => thread.threadId === "thread-archive"),
    true,
  );
});

test("archiving_a_missing_thread_returns_thread_not_found", async () => {
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [threadSeed("thread-only")],
  });
  const result = await service.archiveThread({ threadId: "missing", archived: true });
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error.code, "thread_not_found");
});

test("pinning_a_thread_sets_pinned_on_its_summary_and_can_be_unset", async () => {
  // Spec: docs_v2/specs/backend-thread-list-product-shell-bootstrap.md
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [threadSeed("thread-pin")],
  });

  const pinned = await service.setThreadPinned({ threadId: "thread-pin", pinned: true });
  assert.equal(pinned.ok, true);
  assert.equal(pinned.ok && pinned.thread.pinned, true);

  const listed = await service.listThreads({});
  const row = listed.ok ? listed.threads.find((thread) => thread.threadId === "thread-pin") : undefined;
  assert.equal(row?.pinned, true);

  const unpinned = await service.setThreadPinned({ threadId: "thread-pin", pinned: false });
  assert.equal(unpinned.ok && unpinned.thread.pinned, false);
});

test("pinning_a_missing_thread_returns_thread_not_found", async () => {
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [threadSeed("thread-only")],
  });
  const result = await service.setThreadPinned({ threadId: "missing", pinned: true });
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error.code, "thread_not_found");
});

test("renaming_a_thread_sets_a_trimmed_collapsed_title", async () => {
  // Spec: docs_v2/specs/backend-thread-list-product-shell-bootstrap.md
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [threadSeed("thread-rename", { title: "Old title" })],
  });

  const renamed = await service.renameThread({
    threadId: "thread-rename",
    title: "  New    title  ",
  });
  assert.equal(renamed.ok, true);
  assert.equal(renamed.ok && renamed.thread.title, "New title");

  const empty = await service.renameThread({ threadId: "thread-rename", title: "   " });
  assert.equal(empty.ok, false);
  assert.equal(!empty.ok && empty.error.code, "invalid_thread_title");

  const missing = await service.renameThread({ threadId: "missing", title: "x" });
  assert.equal(missing.ok, false);
  assert.equal(!missing.ok && missing.error.code, "thread_not_found");
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

test("thread_start_seeds_adopted_composer_panes_into_the_workbench", async () => {
  // Spec: docs_v2/specs/workbench-dock-parity.md — composer-screen panes are adopted
  // by the new Thread (seeded at start, race-free; they ride along in thread.started).
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("thread"),
  });

  const result = await service.startThread({
    initialMessage: "open the repo with this page",
    agentBinding: { agentId: "codex" },
    scope: { kind: "scratch", scratchCwd: "/tmp/tide-seed" },
    initialWorkbenchPanes: [{ kind: "browser", url: "https://seeded.test", title: "Seeded" }],
  });

  assert.equal(result.ok, true);
  const browser = result.ok
    ? result.thread.workbench.panes.find((pane) => pane.kind === "browser")
    : undefined;
  assert.equal(browser?.visible, true);
  assert.equal(
    browser !== undefined && browser.kind === "browser" ? browser.url : undefined,
    "https://seeded.test",
  );
});

test("granting_trust_replays_the_held_first_message_via_launch_not_typed_input", async () => {
  // Regression: after trust, the held first message must be delivered as the launch
  // prompt (like a normal start) so the provider CLI reliably begins a turn — not
  // only typed via writeInput, which left the CLI idle ("Working" forever).
  const fakes = createFakes({
    readiness: {
      ready: false,
      agentId: "codex",
      blockers: [
        {
          kind: "directory_trust_required",
          scope: "execution_context",
          message: "trust required",
          action: "open_terminal",
        },
      ],
    },
  });
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("thread"),
  });

  const started = await service.startThread({
    initialMessage: "explain this repo",
    agentBinding: {
      agentId: "codex",
      runtimeSource: { kind: "provider_cli", integrationId: "codex" },
    },
    scope: { kind: "project", projectId: "p1", cwd: "/repo" },
  });
  assert.equal(started.ok && started.status, "provider_not_ready");
  const threadId = started.ok ? started.thread.threadId : "";
  assert.equal(fakes.runtime.starts.length, 0);

  fakes.readiness.setResult({ ready: true, agentId: "codex", blockers: [] });
  const trusted = await service.trustWorkspace({ threadId });
  assert.equal(trusted.ok && trusted.status, "trusted");

  // Started exactly once, carrying the held message as the launch prompt.
  assert.equal(fakes.runtime.starts.length, 1);
  assert.equal(fakes.runtime.starts[0].initialPrompt, "explain this repo");
  // A provider CLI got the prompt via launch, so it is NOT typed again via writeInput.
  assert.equal(fakes.runtime.writes.length, 0);
});

test("scratch_thread_materializes_a_real_tide_owned_cwd_and_auto_trusts_it", async () => {
  // Spec: docs_v2/specs/scratch-execution-context.md
  const fakes = createFakes();
  const created: string[] = [];
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("thread"),
    ensureScratchDirectory: (threadId) => {
      const dir = `/app-support/scratch/${threadId}`;
      created.push(dir);
      return dir;
    },
  });

  const result = await service.startThread({
    initialMessage: "scratch run",
    agentBinding: { agentId: "codex" },
    // The placeholder cwd a new Scratch Thread is created with.
    scope: { kind: "scratch", scratchCwd: "Scratch" },
  });

  assert.equal(result.ok, true);
  const scope = result.ok ? result.thread.scope : undefined;
  assert.equal(scope?.kind, "scratch");
  const cwd = scope?.kind === "scratch" ? scope.scratchCwd : "";
  // Placeholder "Scratch" became a real per-thread dir, which was created...
  assert.notEqual(cwd, "Scratch");
  assert.ok(/\/app-support\/scratch\/thread/.test(cwd), `real scratch cwd, got ${cwd}`);
  assert.ok(created.includes(cwd), "scratch directory was created");
  // ...and auto-trusted for the agent so no directory-trust prompt blocks it.
  assert.ok(
    fakes.providerTrust.calls.some((call) => call.agentId === "codex" && call.cwd === cwd),
    "scratch cwd auto-trusted for the agent",
  );
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
  // The turn's start time is recorded so the Working indicator can show elapsed
  // since the turn started, even after the thread is reopened.
  assert.equal(result.thread.runtimeStartedAt, now);
  assert.deepEqual(fakes.runtime.events, ["start", "writeInput"]);
  assert.equal(fakes.runtime.writes[0].input.kind, "composer_input");
  assert.equal(fakes.runtime.writes[0].input.value, "Implement the backend lifecycle");
});

// --- UC-1: Materialize Composer Attachments ---
// Spec: docs_v2/specs/composer-image-attachments.md

test("materializes_pasted_images_into_the_thread_workspace", async () => {
  // UC-1 BR-1: each image is written under <cwd>/.tide/attachments/.
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("thread"),
  });

  await service.startThread({
    initialMessage: "Look at this",
    agentBinding: { agentId: "codex" },
    scope: { kind: "project", projectId: "project-1", cwd: "/repo" },
    attachments: [{ name: "shot.png", mediaType: "image/png", dataBase64: "AAAA" }],
  });

  assert.equal(fakes.composerAttachments.calls.length, 1);
  // Materialized under Tide's app-data dir keyed by threadId (NOT the repo).
  assert.ok(fakes.composerAttachments.calls[0].threadId.length > 0);
  assert.equal(fakes.composerAttachments.calls[0].attachments[0].name, "shot.png");
});

test("appends_attachment_path_references_to_the_message_text", async () => {
  // UC-1 BR-2: one path line per attachment is appended to the message the Agent receives.
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("thread"),
  });

  await service.startThread({
    initialMessage: "Compare these",
    agentBinding: { agentId: "codex" },
    scope: { kind: "project", projectId: "project-1", cwd: "/repo" },
    attachments: [
      { name: "a.png", mediaType: "image/png", dataBase64: "AAAA" },
      { name: "b.png", mediaType: "image/png", dataBase64: "BBBB" },
    ],
  });

  // The folded "[Attached image: <app-data path>]" lines drive the transcript
  // thumbnail; the agent also gets each attachment natively (codex localImage).
  const value = fakes.runtime.writes[0]?.input.value ?? "";
  assert.match(value, /^Compare these\n\n/);
  assert.match(value, /\[Attached image: \/app-data\/attachments\/[^/]+\/0-a\.png\]/);
  assert.match(value, /\[Attached image: \/app-data\/attachments\/[^/]+\/1-b\.png\]/);
  // ...and the native image refs ride alongside the text.
  assert.equal(fakes.runtime.writes[0]?.input.attachments?.length, 2);
});

test("sends_attachment_paths_when_the_message_text_is_empty", async () => {
  // UC-1 BR-3: a text-empty message still carries the path lines.
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [
      threadSeed("thread-img", {
        agentBinding: {
          agentId: "codex",
          providerSessionRef: { kind: "codex_rollout", value: "rollout-1" },
        },
        scope: { kind: "project", projectId: "project-1", cwd: "/repo" },
      }),
    ],
  });

  await service.sendComposerInput({
    threadId: "thread-img",
    input: "",
    attachments: [{ name: "only.png", mediaType: "image/png", dataBase64: "AAAA" }],
  });

  assert.equal(
    fakes.runtime.writes[0]?.input.value,
    "[Attached image: /app-data/attachments/thread-img/0-only.png]",
  );
  assert.equal(fakes.runtime.writes[0]?.input.attachments?.length, 1);
});

// --- UC-1: Grant Workspace Trust ---
// Spec: docs_v2/specs/workspace-trust-grant.md

test("trusting_a_workspace_writes_provider_trust_for_the_thread_cwd", async () => {
  // UC-1 BR-1: trust is written for the Thread's Execution Context cwd + agent.
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [
      threadSeed("thread-trust", {
        agentBinding: { agentId: "claude" },
        scope: { kind: "project", projectId: "p1", cwd: "/repo" },
      }),
    ],
  });

  const result = await service.trustWorkspace({ threadId: "thread-trust" });

  assert.equal(result.ok, true);
  assert.deepEqual(fakes.providerTrust.calls, [{ agentId: "claude", cwd: "/repo" }]);
});

test("trusting_a_workspace_rechecks_provider_readiness", async () => {
  // UC-1 BR-2: after writing trust, readiness is re-checked and reported.
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [
      threadSeed("thread-trust", {
        agentBinding: { agentId: "claude" },
        scope: { kind: "project", projectId: "p1", cwd: "/repo" },
      }),
    ],
  });

  const checksBefore = fakes.readiness.checks.length;
  const result = await service.trustWorkspace({ threadId: "thread-trust" });

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.status, "trusted");
  assert.equal(fakes.readiness.checks.length, checksBefore + 1);
  assert.equal(result.ok && result.providerReadiness.ready, true);
});

test("trusting_a_workspace_without_a_cwd_fails", async () => {
  // UC-1 BR-3: a Thread with no Execution Context cwd cannot be trusted.
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [
      threadSeed("thread-no-cwd", { agentBinding: { agentId: "claude" }, scope: undefined }),
    ],
  });

  const result = await service.trustWorkspace({ threadId: "thread-no-cwd" });

  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error.code, "directory_trust_unavailable");
  assert.deepEqual(fakes.providerTrust.calls, []);
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
    initialMessage: "Run with Gemini",
    agentBinding: {
      agentId: "gemini",
      runtimeSource: { kind: "provider_cli", integrationId: "gemini" },
    },
    scope: { kind: "project", projectId: "tide", cwd: "/repo/tide" },
    launchOptions: { model: "Gemini default", permission: "default" },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.thread.launchOptions, {
    model: "Gemini default",
    permission: "default",
  });
  assert.deepEqual(fakes.runtime.starts[0]?.launchOptions, {
    model: "Gemini default",
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

test("sending_input_to_a_thread_without_a_provider_session_starts_a_new_runtime", async () => {
  // A hydrated/seeded thread that has never run has no providerSessionRef, so
  // follow-up input must START a fresh runtime rather than fail to resume.
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [
      threadSeed("thread-never-run", {
        agentBinding: { agentId: "claude" },
      }),
    ],
  });

  const result = await service.sendComposerInput({
    threadId: "thread-never-run",
    input: "First message to a never-run thread",
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "sent");
  assert.equal(result.runtimeState, "running");
  assert.deepEqual(fakes.runtime.events, ["start", "writeInput"]);
  assert.equal(fakes.runtime.starts[0]?.threadId, "thread-never-run");
  assert.equal(fakes.runtime.writes[0]?.input.value, "First message to a never-run thread");
});

function busyThreadService() {
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [
      threadSeed("thread-busy", {
        agentBinding: {
          agentId: "codex",
          providerSessionRef: { kind: "codex_rollout", value: "rollout-busy" },
        },
      }),
    ],
  });
  return { fakes, service };
}

// ── Mid-thread Launch Option changes ──────────────────────────────────────
// Spec: docs_v2/specs/mid-thread-launch-option-changes.md

test("update_thread_launch_options_applies_live_and_persists", async () => {
  const { fakes, service } = busyThreadService();
  await service.sendComposerInput({ threadId: "thread-busy", input: "first" });

  const result = await service.updateThreadLaunchOptions({
    threadId: "thread-busy",
    launchOptions: { model: "gpt-5.4" },
  });

  assert.equal(result.ok, true);
  assert.equal(result.applied, "live");
  assert.deepEqual(result.changedKeys, ["model"]);
  assert.equal(result.thread.launchOptions?.model, "gpt-5.4");
  assert.deepEqual(fakes.runtime.sessionConfigUpdates[0]?.changedKeys, ["model"]);
});

test("update_thread_launch_options_without_live_runtime_only_changes_spawn_options", async () => {
  const { fakes, service } = busyThreadService();

  const result = await service.updateThreadLaunchOptions({
    threadId: "thread-busy",
    launchOptions: { model: "gpt-5.4" },
  });

  assert.equal(result.ok, true);
  assert.equal(result.applied, "none");
  // No live runtime, but the option DID change → changedKeys is non-empty so the
  // renderer reads it as "pending" (applies at the next message), not "no change".
  assert.deepEqual(result.changedKeys, ["model"]);
  assert.equal(fakes.runtime.sessionConfigUpdates.length, 0);
  // The next send resumes the provider session WITH the changed options.
  await service.sendComposerInput({ threadId: "thread-busy", input: "go" });
  assert.equal(fakes.runtime.resumes[0]?.launchOptions?.model, "gpt-5.4");
});

test("update_thread_launch_options_with_unchanged_values_is_a_no_op", async () => {
  const { fakes, service } = busyThreadService();
  await service.sendComposerInput({ threadId: "thread-busy", input: "first" });
  await service.updateThreadLaunchOptions({
    threadId: "thread-busy",
    launchOptions: { model: "gpt-5.4" },
  });

  const repeat = await service.updateThreadLaunchOptions({
    threadId: "thread-busy",
    launchOptions: { model: "gpt-5.4" },
  });

  assert.equal(repeat.ok, true);
  assert.equal(repeat.applied, "none");
  // Nothing actually differed → no changed keys → the renderer shows no feedback.
  assert.deepEqual(repeat.changedKeys, []);
  assert.equal(fakes.runtime.sessionConfigUpdates.length, 1);
});

test("restart_required_change_restarts_the_runtime_at_the_next_send", async () => {
  const { fakes, service } = busyThreadService();
  fakes.runtime.sessionConfigResult = "restart_required";
  await service.sendComposerInput({ threadId: "thread-busy", input: "first" });
  await service.recordTurnComplete({ threadId: "thread-busy" });

  const result = await service.updateThreadLaunchOptions({
    threadId: "thread-busy",
    launchOptions: { reasoning: "xhigh" },
  });
  assert.equal(result.ok, true);
  assert.equal(result.applied, "next_turn");
  assert.deepEqual(result.changedKeys, ["reasoning"]);

  await service.sendComposerInput({ threadId: "thread-busy", input: "next" });
  // The idle process is stopped and a fresh provider-native resume carries the
  // new options before the message is written — all under the turn spinner.
  assert.deepEqual(fakes.runtime.events, [
    "resume",
    "writeInput",
    "applySessionConfig",
    "stop",
    "resume",
    "writeInput",
  ]);
  assert.equal(fakes.runtime.resumes[1]?.launchOptions?.reasoning, "xhigh");
});

test("restart_required_change_mid_turn_applies_when_the_queued_input_flushes", async () => {
  const { fakes, service } = busyThreadService();
  fakes.runtime.sessionConfigResult = "restart_required";
  await service.sendComposerInput({ threadId: "thread-busy", input: "first" });
  // Mid-turn: change options, then queue a follow-up. The in-flight turn is
  // never interrupted; the restart happens when the queued input flushes.
  await service.updateThreadLaunchOptions({
    threadId: "thread-busy",
    launchOptions: { model: "gpt-5.2" },
  });
  const queued = await service.sendComposerInput({
    threadId: "thread-busy",
    input: "follow-up",
  });
  assert.equal(queued.ok, true);
  assert.equal(queued.status, "queued");
  assert.equal(fakes.runtime.stops.length, 0);

  const done = await service.recordTurnComplete({ threadId: "thread-busy" });
  assert.equal(done.ok, true);
  assert.equal(done.flushedInput, "follow-up");
  assert.equal(fakes.runtime.stops.length, 1);
  assert.equal(fakes.runtime.resumes[1]?.launchOptions?.model, "gpt-5.2");
  assert.equal(fakes.runtime.writes[1]?.input.value, "follow-up");
});

test("send_input_launch_options_apply_to_the_live_session", async () => {
  // Options piggybacked on composer.sendInput route through the same merge/
  // apply path as the explicit command (no silent drop on follow-ups).
  const { fakes, service } = busyThreadService();
  await service.sendComposerInput({ threadId: "thread-busy", input: "first" });
  await service.recordTurnComplete({ threadId: "thread-busy" });

  await service.sendComposerInput({
    threadId: "thread-busy",
    input: "second",
    launchOptions: { model: "gpt-5.2" },
  });

  assert.equal(fakes.runtime.sessionConfigUpdates.length, 1);
  assert.deepEqual(fakes.runtime.sessionConfigUpdates[0]?.changedKeys, ["model"]);
});

test("update_thread_launch_options_for_a_missing_thread_fails", async () => {
  const { service } = busyThreadService();
  const result = await service.updateThreadLaunchOptions({
    threadId: "thread-unknown",
    launchOptions: { model: "gpt-5.4" },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "thread_not_found");
});

test("input_sent_while_a_turn_is_running_is_queued_not_sent", async () => {
  // A second input during a live turn queues Tide-side (an idle thread sends at once).
  const { fakes, service } = busyThreadService();
  await service.sendComposerInput({ threadId: "thread-busy", input: "first" });
  const queued = await service.sendComposerInput({ threadId: "thread-busy", input: "second" });

  assert.equal(queued.ok, true);
  assert.equal(queued.status, "queued");
  // Only the first input reached the runtime; the second is held.
  assert.deepEqual(fakes.runtime.events, ["resume", "writeInput"]);
  assert.equal(fakes.runtime.writes.length, 1);
});

test("input_during_a_running_turn_is_queued_even_for_a_steer_capable_provider", async () => {
  // UNIFORM QUEUE: Tide queues EVERY provider's follow-up while a turn is live —
  // even codex, whose protocol CAN inject input mid-turn (supportsTurnSteer) — so
  // the queued "steer" chips stack the same on every agent. Nothing is steered into
  // the running turn; the second input is held and reaches no runtime write.
  const { fakes, service } = busyThreadService();
  fakes.readiness.setResult({
    ready: true,
    agentId: "codex",
    blockers: [],
    capabilities: { supportsTurnSteer: true },
  });
  await service.sendComposerInput({ threadId: "thread-busy", input: "first" });
  const queued = await service.sendComposerInput({ threadId: "thread-busy", input: "second" });

  assert.equal(queued.ok, true);
  assert.equal(queued.status, "queued");
  assert.equal(queued.runtimeState, "running");
  // Only the first input reached the runtime; the second stacks as a queued follow-up.
  assert.deepEqual(fakes.runtime.events, ["resume", "writeInput"]);
  assert.equal(fakes.runtime.writes.length, 1);
  assert.deepEqual(queued.thread.queuedInputs, ["second"]);
});

test("input_during_a_prompt_card_is_queued_even_for_a_steer_capable_provider", async () => {
  // An open prompt card (waiting_for_approval) must be answered first, so the input
  // queues and flushes on settle — the same uniform queue every state takes, and a
  // steer-capable provider (codex) is no exception.
  const { fakes, service } = busyThreadService();
  fakes.readiness.setResult({
    ready: true,
    agentId: "codex",
    blockers: [],
    capabilities: { supportsTurnSteer: true },
  });
  await service.sendComposerInput({ threadId: "thread-busy", input: "first" });
  await service.recordProviderPromptState({
    threadId: "thread-busy",
    promptState: {
      promptId: "p1",
      threadId: "thread-busy",
      agentId: "codex",
      kind: "approval",
      message: "Run command?",
      choices: [
        { choiceId: "allow", label: "Allow", providerValue: "structured:accept" },
        { choiceId: "deny", label: "Deny", providerValue: "structured:decline" },
      ],
      defaultChoiceId: "allow",
      source: "provider_hook",
    },
  });
  const queued = await service.sendComposerInput({ threadId: "thread-busy", input: "second" });

  assert.equal(queued.ok, true);
  assert.equal(queued.status, "queued");
  // The second input did NOT reach the runtime (only the first turn's writeInput).
  assert.deepEqual(fakes.runtime.events, ["resume", "writeInput"]);
});

test("recording_turn_complete_flushes_the_queued_input_into_the_next_turn", async () => {
  const { fakes, service } = busyThreadService();
  await service.sendComposerInput({ threadId: "thread-busy", input: "first" });
  await service.sendComposerInput({ threadId: "thread-busy", input: "second" });
  const done = await service.recordTurnComplete({ threadId: "thread-busy" });

  assert.equal(done.ok, true);
  assert.equal(done.flushedInput, "second");
  assert.equal(done.runtimeState, "running");
  assert.deepEqual(fakes.runtime.events, ["resume", "writeInput", "writeInput"]);
  assert.equal(fakes.runtime.writes[1]?.input.value, "second");
});

test("recording_turn_complete_with_no_queue_returns_the_runtime_to_idle", async () => {
  // The lingering-loading fix: a turn ending with no queued input goes idle.
  const { service } = busyThreadService();
  await service.sendComposerInput({ threadId: "thread-busy", input: "first" });
  const done = await service.recordTurnComplete({ threadId: "thread-busy" });

  assert.equal(done.ok, true);
  assert.equal(done.runtimeState, "idle");
  assert.equal(done.flushedInput, undefined);
});

const approvalCard = {
  promptId: "p1",
  threadId: "thread-busy",
  agentId: "codex" as const,
  kind: "approval" as const,
  message: "Run command?",
  choices: [{ choiceId: "allow", label: "Allow", providerValue: "structured:accept" }],
  source: "provider_hook" as const,
};

test("a_bare_turn_end_does_not_drop_a_live_unanswered_prompt_card", async () => {
  // A spurious turn-end (claude's history reader can infer one while a permission card
  // is still open) must NOT settle a still-live, never-answered prompt to idle — that
  // dropped the card, so a user who had switched away came back to an empty, idle-
  // looking thread even though the session was alive and resumable. The card stays.
  const { service } = busyThreadService();
  await service.sendComposerInput({ threadId: "thread-busy", input: "do it" });
  await service.recordProviderPromptState({ threadId: "thread-busy", promptState: approvalCard });

  const done = await service.recordTurnComplete({ threadId: "thread-busy" });

  assert.equal(done.ok, true);
  assert.equal(done.ok && done.runtimeState, "waiting_for_approval");
  assert.equal(done.ok && done.thread.promptState?.promptId, "p1");
});

test("a_forced_turn_complete_settles_even_past_a_live_prompt_card", async () => {
  // A genuine runtime exit passes force: true — the runtime is gone, so the card is
  // truly dead (it can no longer receive the answer) and the thread settles to idle.
  const { service } = busyThreadService();
  await service.sendComposerInput({ threadId: "thread-busy", input: "do it" });
  await service.recordProviderPromptState({ threadId: "thread-busy", promptState: approvalCard });

  const done = await service.recordTurnComplete({ threadId: "thread-busy", force: true });

  assert.equal(done.ok, true);
  assert.equal(done.ok && done.runtimeState, "idle");
  assert.equal(done.ok && done.thread.promptState, undefined);
});

test("a_turn_end_after_the_prompt_is_answered_still_settles_the_runtime", async () => {
  // Regression guard for the "Working forever after answering a stale card" fix:
  // answering clears promptState first, so the following bare turn-end settles
  // normally (the live-prompt guard only protects an UNanswered card).
  const { service } = busyThreadService();
  await service.sendComposerInput({ threadId: "thread-busy", input: "do it" });
  await service.recordProviderPromptState({ threadId: "thread-busy", promptState: approvalCard });
  await service.answerPrompt({ threadId: "thread-busy", promptId: "p1", choiceId: "allow" });

  const done = await service.recordTurnComplete({ threadId: "thread-busy" });

  assert.equal(done.ok, true);
  assert.equal(done.ok && done.runtimeState, "idle");
  assert.equal(done.ok && done.thread.promptState, undefined);
});

test("stacked_followups_flush_in_fifo_order_one_per_turn_end", async () => {
  // Several follow-ups queued behind a live turn run in submission order, one per
  // turn-end; the runtime stays running until the queue drains, then goes idle.
  const { service } = busyThreadService();
  await service.sendComposerInput({ threadId: "thread-busy", input: "first" }); // runs now
  const q1 = await service.sendComposerInput({ threadId: "thread-busy", input: "second" });
  const q2 = await service.sendComposerInput({ threadId: "thread-busy", input: "third" });
  assert.equal(q1.status, "queued");
  assert.equal(q2.status, "queued");

  const done1 = await service.recordTurnComplete({ threadId: "thread-busy" });
  assert.equal(done1.flushedInput, "second");
  assert.equal(done1.runtimeState, "running");

  const done2 = await service.recordTurnComplete({ threadId: "thread-busy" });
  assert.equal(done2.flushedInput, "third");
  assert.equal(done2.runtimeState, "running");

  const done3 = await service.recordTurnComplete({ threadId: "thread-busy" });
  assert.equal(done3.flushedInput, undefined);
  assert.equal(done3.runtimeState, "idle");
});

test("the_thread_snapshot_publishes_the_followup_queue_head_first", async () => {
  // The renderer DISPLAYS this (backend-authoritative); it never guesses the queue.
  const { service } = busyThreadService();
  await service.sendComposerInput({ threadId: "thread-busy", input: "first" }); // runs now
  await service.sendComposerInput({ threadId: "thread-busy", input: "second" }); // queued head
  const q2 = await service.sendComposerInput({ threadId: "thread-busy", input: "third" }); // queued tail
  assert.deepEqual(q2.thread.queuedInputs, ["second", "third"]);

  // Flushing the head shrinks the published queue.
  const done = await service.recordTurnComplete({ threadId: "thread-busy" });
  assert.deepEqual(done.thread.queuedInputs, ["third"]);
});

test("editing_a_queued_followup_by_index_targets_that_message_and_keeps_the_rest", async () => {
  const { service } = busyThreadService();
  await service.sendComposerInput({ threadId: "thread-busy", input: "first" }); // runs now
  await service.sendComposerInput({ threadId: "thread-busy", input: "second" }); // queued head
  await service.sendComposerInput({ threadId: "thread-busy", input: "third" }); // queued tail

  // "first" is running, so the queued list (head-first) is [second, third].
  // Discard the tail ("third") at index 1 with a blank value.
  const removed = await service.editPendingInput({ threadId: "thread-busy", value: "  ", index: 1 });
  assert.equal(removed.ok, true);
  assert.equal(removed.status, "discarded");

  // The head ("second") still flushes first; the removed tail does not run.
  const done1 = await service.recordTurnComplete({ threadId: "thread-busy" });
  assert.equal(done1.flushedInput, "second");
  const done2 = await service.recordTurnComplete({ threadId: "thread-busy" });
  assert.equal(done2.flushedInput, undefined);
  assert.equal(done2.runtimeState, "idle");
});

test("a_full_session_composes_send_queue_edit_prompt_answer_and_turn_end_flush", async () => {
  // Proves the seamless features work TOGETHER in one flow (not just in isolation):
  // send -> queue a follow-up -> edit the queued message -> a provider prompt
  // arrives and is answered -> the turn ends and the EDITED queued message flushes.
  const { fakes, service } = busyThreadService();

  const first = await service.sendComposerInput({ threadId: "thread-busy", input: "first" });
  assert.equal(first.status, "sent");

  const queued = await service.sendComposerInput({
    threadId: "thread-busy",
    input: "teh queued typo",
  });
  assert.equal(queued.status, "queued");

  const edited = await service.editPendingInput({
    threadId: "thread-busy",
    value: "the queued fix",
  });
  assert.equal(edited.ok, true);
  assert.equal(edited.status, "edited");

  // A provider permission prompt arrives mid-turn; the user answers it.
  await service.recordProviderPromptState({
    threadId: "thread-busy",
    promptState: {
      promptId: "p1",
      threadId: "thread-busy",
      agentId: "codex",
      kind: "permission",
      message: "Allow command?",
      source: "provider_hook",
    },
  });
  const answered = await service.answerPrompt({
    threadId: "thread-busy",
    promptId: "p1",
    value: "yes",
  });
  assert.equal(answered.ok, true);
  assert.equal(answered.runtimeState, "running");

  // The turn ends — the corrected queued message runs as the next turn.
  const done = await service.recordTurnComplete({ threadId: "thread-busy" });
  assert.equal(done.ok, true);
  assert.equal(done.flushedInput, "the queued fix");
  assert.equal(done.runtimeState, "running");
  // The edited message (not the typo) is what reached the runtime last.
  assert.equal(
    fakes.runtime.writes[fakes.runtime.writes.length - 1]?.input.value,
    "the queued fix",
  );
});

test("editing_queued_input_replaces_text_and_preserves_launch_options", async () => {
  const { service } = busyThreadService();
  await service.sendComposerInput({ threadId: "thread-busy", input: "first" });
  await service.sendComposerInput({
    threadId: "thread-busy",
    input: "teh typo",
    launchOptions: { model: "gpt-5.5" },
  });

  const edited = await service.editPendingInput({
    threadId: "thread-busy",
    value: "the fix",
  });

  assert.equal(edited.ok, true);
  assert.equal(edited.status, "edited");
  assert.equal(edited.thread.pendingInput?.value, "the fix");
  assert.deepEqual(edited.thread.pendingInput?.launchOptions, { model: "gpt-5.5" });
});

test("editing_queued_input_does_not_write_to_runtime", async () => {
  const { fakes, service } = busyThreadService();
  await service.sendComposerInput({ threadId: "thread-busy", input: "first" });
  await service.sendComposerInput({ threadId: "thread-busy", input: "second" });
  const writesBefore = fakes.runtime.writes.length;

  await service.editPendingInput({ threadId: "thread-busy", value: "edited" });

  // The queued input was never sent, so editing it touches no runtime input.
  assert.equal(fakes.runtime.writes.length, writesBefore);
});

test("turn_end_flushes_the_edited_queued_message", async () => {
  const { fakes, service } = busyThreadService();
  await service.sendComposerInput({ threadId: "thread-busy", input: "first" });
  await service.sendComposerInput({ threadId: "thread-busy", input: "second" });
  await service.editPendingInput({ threadId: "thread-busy", value: "edited second" });

  const done = await service.recordTurnComplete({ threadId: "thread-busy" });

  assert.equal(done.ok, true);
  assert.equal(done.flushedInput, "edited second");
  assert.equal(fakes.runtime.writes[1]?.input.value, "edited second");
});

test("editing_with_no_queued_input_fails", async () => {
  const { service } = busyThreadService();
  // A single send goes straight to the runtime (running, nothing queued).
  await service.sendComposerInput({ threadId: "thread-busy", input: "first" });

  const result = await service.editPendingInput({ threadId: "thread-busy", value: "x" });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "no_pending_input");
});

test("editing_queued_input_with_blank_value_discards_it", async () => {
  const { service } = busyThreadService();
  await service.sendComposerInput({ threadId: "thread-busy", input: "first" });
  await service.sendComposerInput({ threadId: "thread-busy", input: "second" });

  const discarded = await service.editPendingInput({ threadId: "thread-busy", value: "   " });
  assert.equal(discarded.ok, true);
  assert.equal(discarded.status, "discarded");
  assert.equal(discarded.thread.pendingInput, undefined);

  // With the queue cleared, the turn ends to idle and nothing flushes.
  const done = await service.recordTurnComplete({ threadId: "thread-busy" });
  assert.equal(done.runtimeState, "idle");
  assert.equal(done.flushedInput, undefined);
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

test("recording_provider_prompt_state_marks_a_live_thread_waiting_and_survives_hydrate", async () => {
  // Spec: docs_v2/specs/provider-signal-prompt-ingress.md
  // A provider prompt belongs to a LIVE runtime (the answer is replayed as
  // keystrokes on its PTY). Start a runtime, record the prompt, and confirm it
  // is still pending on hydrate — the in-session thread-switch case.
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
  });
  const started = await service.startThread({
    initialMessage: "do work",
    agentBinding: { agentId: "codex" },
    scope: { kind: "scratch", scratchCwd: "/tmp/thread-provider-prompt" },
  });
  assert.equal(started.ok, true);
  const threadId = started.ok ? started.thread.threadId : "";

  const providerPrompt: PromptState = {
    promptId: "prompt-provider",
    threadId,
    agentId: "codex",
    kind: "permission",
    message: "Allow command?",
    choices: [
      { choiceId: "allow", label: "Allow once", providerValue: "allow_once" },
    ],
    source: "provider_hook",
  };

  const result = await service.recordProviderPromptState({ threadId, promptState: providerPrompt });
  const hydrated = await service.hydrateThread({ threadId });

  assert.equal(result.ok, true);
  assert.equal(result.runtimeState, "waiting_for_approval");
  assert.equal(result.thread.promptState?.promptId, "prompt-provider");
  // Live runtime → the prompt survives hydrate (in-session re-open).
  assert.equal(hydrated.thread.lastKnownState, "waiting_for_approval");
  assert.equal(hydrated.thread.promptState?.promptId, "prompt-provider");
});

test("hydrating_a_thread_with_no_live_runtime_drops_the_stale_prompt_and_idles", async () => {
  // The prompt is answerable ONLY while the runtime that asked it is alive. A
  // thread restored from persistence (app restart) or whose runtime died keeps a
  // stale waiting state + (possibly) a prompt; resurrecting a permission card for
  // a dead PTY is a lie. Hydrate must reconcile it to idle so the composer works
  // and the user can send a follow-up (which resumes the provider session).
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [
      threadSeed("thread-restored", {
        runtimeState: "waiting_for_approval",
        lastKnownState: "waiting_for_approval",
        lifecycleState: "waiting_for_approval",
        promptState: {
          promptId: "stale-prompt",
          threadId: "thread-restored",
          agentId: "codex",
          kind: "permission",
          message: "Allow command?",
          source: "provider_hook",
        },
      }),
    ],
  });

  const hydrated = await service.hydrateThread({ threadId: "thread-restored", reconcileStaleRuntime: true });
  assert.equal(hydrated.ok, true);
  assert.equal(hydrated.thread.runtimeState, "idle");
  assert.equal(hydrated.thread.lastKnownState, "idle");
  assert.equal(hydrated.thread.promptState, undefined);
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
          agentId: "gemini",
          runtimeSource: { kind: "provider_cli", integrationId: "gemini" },
        },
        launchOptions: { model: "Gemini default", permission: "default" },
      }),
    ],
  });

  const result = await service.recordProviderSessionRef({
    threadId: "thread-provider-session",
    agentId: "gemini",
    providerSessionRef: {
      kind: "gemini_session",
      value: "conversation-1",
      transcriptPath: "/provider/chats/session-1.jsonl",
    },
  });
  const hydrated = await service.hydrateThread({
    threadId: "thread-provider-session",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.thread.agentBinding.providerSessionRef, {
    kind: "gemini_session",
    value: "conversation-1",
    transcriptPath: "/provider/chats/session-1.jsonl",
  });
  assert.deepEqual(hydrated.thread.agentBinding.providerSessionRef, {
    kind: "gemini_session",
    value: "conversation-1",
    transcriptPath: "/provider/chats/session-1.jsonl",
  });
  assert.deepEqual(hydrated.thread.launchOptions, {
    model: "Gemini default",
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
    agentId: "gemini",
    providerSessionRef: {
      kind: "gemini_session",
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
  // Stop is now a true INTERRUPT: the turn aborts (idle), the runtime stays
  // alive + resumable (handle kept), and the protocol interrupt is sent — not a
  // process kill. See docs_v2/specs/structured-agent-runtime.md.
  assert.equal(result.runtimeState, "idle");
  assert.equal(hydrated.thread.threadId, "thread-stop");
  assert.equal(hydrated.runtimeState, "idle");
  assert.deepEqual(fakes.runtime.events, ["interrupt"]);
});

test("stopping_with_a_queued_follow_up_consumes_it_into_the_next_turn", async () => {
  // Stop ends the current turn AND runs the message queued behind it (codex pattern),
  // rather than dropping it.
  const { fakes, service } = busyThreadService();
  await service.sendComposerInput({ threadId: "thread-busy", input: "first" });
  await service.sendComposerInput({ threadId: "thread-busy", input: "queued follow up" });
  const stopped = await service.stopAgentRuntime({ threadId: "thread-busy" });

  assert.equal(stopped.ok, true);
  // Stop INTERRUPTS the turn (no kill) and stays `running`, retaining the queue.
  assert.equal(stopped.runtimeState, "running");
  // The aborted turn-end then flushes the queued message onto the SAME live
  // runtime (no respawn).
  const completed = await service.recordTurnComplete({ threadId: "thread-busy" });
  assert.equal(completed.ok && completed.flushedInput, "queued follow up");
  assert.deepEqual(fakes.runtime.events, ["resume", "writeInput", "interrupt", "writeInput"]);
  assert.equal(
    fakes.runtime.writes[fakes.runtime.writes.length - 1]?.input.value,
    "queued follow up",
  );
});

test("stopping_a_thread_parked_on_a_prompt_clears_it_and_flushes_the_stranded_queue", async () => {
  // Regression (spec: waiting-state-recovery): a Thread waiting on a prompt with a
  // queued follow-up was stranded — recordTurnComplete holds the queue while a prompt
  // is live (dfc424ee early-return). Stop is the universal escape: it clears the prompt
  // so the interrupt turn-end FLUSHES the queue instead of short-circuiting. The lock
  // and its escape have no agentId branching → this covers all four providers.
  const { fakes, service } = busyThreadService();
  await service.sendComposerInput({ threadId: "thread-busy", input: "first" });
  await service.recordProviderPromptState({
    threadId: "thread-busy",
    promptState: {
      promptId: "p1",
      threadId: "thread-busy",
      agentId: "codex",
      kind: "approval",
      message: "Run command?",
      choices: [
        { choiceId: "allow", label: "Allow", providerValue: "structured:accept" },
        { choiceId: "deny", label: "Deny", providerValue: "structured:decline" },
      ],
      defaultChoiceId: "allow",
      source: "provider_hook",
    },
  });
  const queued = await service.sendComposerInput({ threadId: "thread-busy", input: "after stop" });
  assert.equal(queued.status, "queued");

  // Pre-fix: no way to reach here from the UI (interrupt was a no-op in waiting) AND
  // recordTurnComplete would not drain while the prompt was held → permanent lock.
  const stopped = await service.stopAgentRuntime({ threadId: "thread-busy" });
  assert.equal(stopped.ok, true);
  // The prompt is gone (escape) and the queued message is retained to run next.
  assert.equal(stopped.thread.promptState, undefined, "stop clears the parked prompt");
  assert.equal(stopped.runtimeState, "running");

  const completed = await service.recordTurnComplete({ threadId: "thread-busy" });
  assert.equal(
    completed.ok && completed.flushedInput,
    "after stop",
    "the previously stranded queue now flushes",
  );
  assert.deepEqual(fakes.runtime.events, ["resume", "writeInput", "interrupt", "writeInput"]);
});

test("withdrawing_the_visible_prompt_clears_it_and_resumes_running", async () => {
  // The provider retracted its own question (claude control_cancel) with nothing queued —
  // the card clears NOW and the live turn resumes running (no timer, no wait-for-turn-end).
  const { service } = busyThreadService();
  await service.sendComposerInput({ threadId: "thread-busy", input: "go" });
  await service.recordProviderPromptState({ threadId: "thread-busy", promptState: { ...approvalCard, promptId: "p1" } });

  const result = await service.withdrawProviderPrompt({ threadId: "thread-busy", promptId: "p1" });

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.promptState, null);
  assert.equal(result.ok && result.runtimeState, "running");
  assert.equal(result.ok && result.thread.promptState, undefined);
});

test("withdrawing_the_visible_prompt_promotes_the_next_queued_one", async () => {
  const { service } = busyThreadService();
  await service.sendComposerInput({ threadId: "thread-busy", input: "go" });
  await service.recordProviderPromptState({ threadId: "thread-busy", promptState: { ...approvalCard, promptId: "p1" } });
  // A second prompt arrives behind the visible one → queued.
  await service.recordProviderPromptState({ threadId: "thread-busy", promptState: { ...approvalCard, promptId: "p2", message: "Second?" } });

  const result = await service.withdrawProviderPrompt({ threadId: "thread-busy", promptId: "p1" });

  assert.equal(result.ok && result.promptState?.promptId, "p2", "the queued prompt is promoted into the visible slot");
  assert.equal(result.ok && result.runtimeState, "waiting_for_approval");
});

test("withdrawing_a_queued_prompt_leaves_the_visible_one_intact", async () => {
  const { service } = busyThreadService();
  await service.sendComposerInput({ threadId: "thread-busy", input: "go" });
  await service.recordProviderPromptState({ threadId: "thread-busy", promptState: { ...approvalCard, promptId: "p1" } });
  await service.recordProviderPromptState({ threadId: "thread-busy", promptState: { ...approvalCard, promptId: "p2", message: "Second?" } });

  const result = await service.withdrawProviderPrompt({ threadId: "thread-busy", promptId: "p2" });

  assert.equal(result.ok && result.thread.promptState?.promptId, "p1", "the visible card is untouched");
  // Answering the visible one now must NOT promote the withdrawn p2 (it was removed).
  const answered = await service.answerPrompt({ threadId: "thread-busy", promptId: "p1", choiceId: "allow" });
  assert.equal(answered.ok && answered.thread.promptState, undefined, "no stale queued prompt remained");
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

test("workbench_command_open_diff_creates_singleton_changes_pane", async () => {
  // Spec: docs_v2/specs/git-changes-view.md — open_diff creates a first-class git
  // Changes pane (cwd = the thread root) and makes it active; opening it again reveals
  // the same singleton pane rather than stacking duplicates.
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
  });
  const started = await service.startThread({
    initialMessage: "hi",
    agentBinding: { agentId: "codex" },
    scope: { kind: "project", projectId: "tide", cwd: "/repo" },
  });
  assert.equal(started.ok, true);

  const opened = await service.handleWorkbenchCommand({
    threadId: started.thread.threadId,
    command: "open_diff",
  });
  const changesPanes = opened.thread.workbench.panes.filter((pane) => pane.kind === "changes");
  assert.equal(changesPanes.length, 1);
  assert.equal(changesPanes[0]?.cwd, "/repo");
  assert.equal(opened.thread.workbench.activePaneId, changesPanes[0]?.paneId);

  const again = await service.handleWorkbenchCommand({
    threadId: started.thread.threadId,
    command: "open_diff",
  });
  assert.equal(again.thread.workbench.panes.filter((pane) => pane.kind === "changes").length, 1);
});

test("createDraftThread_registers_a_draft_with_a_workbench_and_does_not_start_an_agent", async () => {
  // Spec: docs_v2/specs/composer-draft-thread.md
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("draft"),
  });

  const created = await service.createDraftThread({
    agentBinding: { agentId: "codex" },
    scope: { kind: "project", projectId: "tide", cwd: "/repo" },
  });

  assert.equal(created.ok, true);
  assert.equal(created.ok && created.thread.lifecycleState, "draft");
  assert.equal(created.ok && created.thread.runtimeState, "not_started");
  // No agent runtime is spawned for a Draft Thread.
  assert.deepEqual(fakes.runtime.events, []);
  // A Draft is not listed in the rail until it starts.
  const listed = await service.listThreads({});
  assert.deepEqual(listed.ok ? listed.threads.map((t) => t.threadId) : ["?"], []);
});

test("open_terminal_on_a_draft_thread_starts_a_visible_pty_without_an_agent", async () => {
  // Spec: composer-draft-thread — the visible Terminal Pane works pre-send, against the
  // Draft Thread's own Workbench, with no agent runtime.
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("draft"),
  });
  const created = await service.createDraftThread({
    agentBinding: { agentId: "codex" },
    scope: { kind: "project", projectId: "tide", cwd: "/repo" },
  });
  assert.equal(created.ok, true);
  const draftId = created.ok ? created.thread.threadId : "";

  const opened = await service.handleWorkbenchCommand({
    threadId: draftId,
    command: "open_terminal",
  });

  assert.equal(opened.ok, true);
  // The PTY spawned against the DRAFT thread + its cwd — via workbenchTerminalPort, the
  // visible-terminal path, never the agent runtime.
  assert.equal(fakes.workbenchTerminal.starts.length, 1);
  assert.equal(fakes.workbenchTerminal.starts[0]?.threadId, draftId);
  assert.equal(fakes.workbenchTerminal.starts[0]?.cwd, "/repo");
  const terminalPanes = opened.ok ? opened.thread.workbench.panes.filter((p) => p.kind === "terminal") : [];
  assert.equal(terminalPanes.length, 1);
  assert.equal(terminalPanes[0]?.status, "running");
  assert.deepEqual(fakes.runtime.events, []);
});

test("sending_starts_an_existing_draft_in_place_keeping_its_workbench", async () => {
  // Spec: composer-draft-thread — Send starts the SAME thread (no new thread), the agent
  // spawns exactly once, the pre-send panes survive, and it now appears in the rail.
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("draft"),
  });
  const created = await service.createDraftThread({
    agentBinding: { agentId: "codex" },
    scope: { kind: "project", projectId: "tide", cwd: "/repo" },
  });
  const draftId = created.ok ? created.thread.threadId : "";
  await service.handleWorkbenchCommand({ threadId: draftId, command: "open_terminal" });

  const started = await service.startThread({
    threadId: draftId,
    initialMessage: "go",
    agentBinding: { agentId: "codex" },
    scope: { kind: "project", projectId: "tide", cwd: "/repo" },
  });

  assert.equal(started.ok, true);
  assert.equal(started.ok && started.status, "started");
  // Same thread id — started in place, not recreated.
  assert.equal(started.ok && started.thread.threadId, draftId);
  assert.equal(started.ok && started.thread.lifecycleState, "running");
  // Exactly one agent spawn; no duplicate PTYs.
  assert.equal(fakes.runtime.starts.length, 1);
  assert.deepEqual(fakes.runtime.events, ["start", "writeInput"]);
  assert.equal(fakes.workbenchTerminal.starts.length, 1);
  // The terminal opened pre-send rides into the started thread's workbench.
  const terminalPanes = started.ok ? started.thread.workbench.panes.filter((p) => p.kind === "terminal") : [];
  assert.equal(terminalPanes.length, 1);
  // Now listed in the rail.
  const listed = await service.listThreads({});
  assert.equal(listed.ok && listed.threads.some((t) => t.threadId === draftId), true);
});

test("discardDraftThread_kills_terminal_ptys_and_removes_the_thread", async () => {
  // Spec: composer-draft-thread — leaving the composer / switching project discards the
  // draft: its visible-terminal PTYs are stopped (no orphans) and it is removed.
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("draft"),
  });
  const created = await service.createDraftThread({
    agentBinding: { agentId: "codex" },
    scope: { kind: "project", projectId: "tide", cwd: "/repo" },
  });
  const draftId = created.ok ? created.thread.threadId : "";
  await service.handleWorkbenchCommand({ threadId: draftId, command: "open_terminal" });

  const discarded = await service.discardDraftThread({ threadId: draftId });

  assert.equal(discarded.ok, true);
  assert.equal(discarded.ok && discarded.discarded, true);
  // The PTY was stopped.
  assert.equal(fakes.workbenchTerminal.handles[0]?.stops.length, 1);
  // The thread is gone.
  const hydrated = await service.hydrateThread({ threadId: draftId });
  assert.equal(hydrated.ok, false);
  // Discarding again is a no-op.
  const again = await service.discardDraftThread({ threadId: draftId });
  assert.equal(again.ok && again.discarded, false);
});

test("discardDraftThread_refuses_to_discard_a_started_thread", async () => {
  // Spec: composer-draft-thread — discard is draft-only; a real thread is never removed.
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("real"),
  });
  const started = await service.startThread({
    initialMessage: "hi",
    agentBinding: { agentId: "codex" },
    scope: { kind: "project", projectId: "tide", cwd: "/repo" },
  });
  assert.equal(started.ok, true);

  const result = await service.discardDraftThread({
    threadId: started.ok ? started.thread.threadId : "",
  });
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error.code, "thread_not_draft");
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
    ["open_browser", "open_editor", "open_terminal", "open_diff"],
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
  const composerAttachments = new FakeComposerAttachmentStorePort();
  const providerTrust = new FakeProviderTrustPort();

  return {
    runtime,
    readiness,
    transcript,
    setupSurface,
    workspaceCommand,
    workbenchTerminal,
    workspaceFiles,
    codeIntelligence,
    composerAttachments,
    providerTrust,
    ports: {
      agentRuntimePort: runtime,
      providerReadinessPort: readiness,
      ptyTranscriptPort: transcript,
      providerSetupSurfaceTerminalPort: setupSurface,
      workbenchTerminalPort: workbenchTerminal,
      workspaceCommandPort: workspaceCommand,
      workspaceFilePort: workspaceFiles,
      workspaceCodeIntelligencePort: codeIntelligence,
      composerAttachmentStorePort: composerAttachments,
      providerTrustPort: providerTrust,
    },
  };
}

class FakeProviderTrustPort implements ProviderTrustPort {
  calls: { agentId: string; cwd: string }[] = [];

  async trust(input: { agentId: string; cwd: string }): Promise<void> {
    this.calls.push(input);
  }
}

class FakeComposerAttachmentStorePort implements ComposerAttachmentStorePort {
  calls: { threadId: string; attachments: ComposerAttachmentInput[] }[] = [];

  async materialize(input: {
    threadId: string;
    attachments: ComposerAttachmentInput[];
  }): Promise<string[]> {
    this.calls.push(input);
    return input.attachments.map(
      (attachment, index) =>
        `/app-data/attachments/${input.threadId}/${index}-${attachment.name}`,
    );
  }
}

class FakeAgentRuntimePort implements AgentRuntimePort {
  events: string[] = [];
  starts: AgentRuntimeStartInput[] = [];
  resumes: AgentRuntimeResumeInput[] = [];
  writes: { handle: AgentRuntimeHandle; input: TerminalInput }[] = [];
  stops: AgentRuntimeHandle[] = [];
  interrupts: AgentRuntimeHandle[] = [];
  sessionConfigUpdates: {
    handle: AgentRuntimeHandle;
    launchOptions: Record<string, unknown>;
    changedKeys: string[];
  }[] = [];
  sessionConfigResult: "applied" | "restart_required" = "applied";

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

  async applySessionConfig(
    handle: AgentRuntimeHandle,
    input: { launchOptions: Record<string, unknown>; changedKeys: string[] },
  ): Promise<"applied" | "restart_required"> {
    this.events.push("applySessionConfig");
    this.sessionConfigUpdates.push({ handle, ...input });
    return this.sessionConfigResult;
  }

  async interrupt(handle: AgentRuntimeHandle): Promise<void> {
    this.events.push("interrupt");
    this.interrupts.push(handle);
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

  // The language-intelligence queries added by workbench-editor-language-
  // intelligence are not exercised by these scenarios - answer "unavailable".
  async getCompletions() {
    return { ok: false as const, error: { code: "workspace_code_intelligence_unavailable" as const, message: "Not available in this fake." } };
  }

  async getHover() {
    return { ok: false as const, error: { code: "workspace_code_intelligence_unavailable" as const, message: "Not available in this fake." } };
  }

  async getDocumentHighlights() {
    return { ok: false as const, error: { code: "workspace_code_intelligence_unavailable" as const, message: "Not available in this fake." } };
  }

  async getSignatureHelp() {
    return { ok: false as const, error: { code: "workspace_code_intelligence_unavailable" as const, message: "Not available in this fake." } };
  }

  async getDiagnostics() {
    return { ok: false as const, error: { code: "workspace_code_intelligence_unavailable" as const, message: "Not available in this fake." } };
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

test("batched_prompts_queue_and_each_answer_promotes_the_next", async () => {
  // A turn can raise SEVERAL prompts at once (claude batching two WebFetch calls
  // fires two PermissionRequest hooks in the same instant). The single prompt
  // slot used to drop all but the last — the user answered one card and the agent
  // hung forever on the unanswered call. Prompts now queue FIFO; each answer
  // writes to the PTY and promotes the next card.
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
  });
  const started = await service.startThread({
    initialMessage: "fetch two pages",
    agentBinding: { agentId: "claude" },
    scope: { kind: "scratch", scratchCwd: "/tmp/thread-batched" },
  });
  assert.equal(started.ok, true);
  const threadId = started.ok ? started.thread.threadId : "";
  const permission = (promptId: string, message: string): PromptState => ({
    promptId,
    threadId,
    agentId: "claude",
    kind: "approval",
    message,
    choices: [{ choiceId: "allow", label: "Allow", providerValue: "codex-menu:0" }],
    defaultChoiceId: "allow",
    source: "provider_hook",
  });

  // Two distinct permissions arrive back-to-back (batched calls).
  const first = await service.recordProviderPromptState({
    threadId,
    promptState: permission("perm-fetch-marketbeat", "WebFetch: marketbeat.com"),
  });
  const second = await service.recordProviderPromptState({
    threadId,
    promptState: permission("perm-fetch-fintel", "WebFetch: fintel.io"),
  });
  // The FIRST card stays visible; the second queues behind it.
  assert.equal(first.ok && first.promptState.promptId, "perm-fetch-marketbeat");
  assert.equal(second.ok && second.promptState.promptId, "perm-fetch-marketbeat");

  // Re-delivery of an already-queued prompt is idempotent (hook spool re-polls).
  const replay = await service.recordProviderPromptState({
    threadId,
    promptState: permission("perm-fetch-fintel", "WebFetch: fintel.io"),
  });
  assert.equal(replay.ok && replay.promptState.promptId, "perm-fetch-marketbeat");

  // Answering the first writes to the PTY and PROMOTES the second card.
  const answered = await service.answerPrompt({
    threadId,
    promptId: "perm-fetch-marketbeat",
    choiceId: "allow",
    value: "codex-menu:0",
  });
  assert.equal(answered.ok, true);
  assert.equal(answered.ok && answered.promptState?.promptId, "perm-fetch-fintel");
  const midway = await service.hydrateThread({ threadId });
  assert.equal(midway.thread.promptState?.promptId, "perm-fetch-fintel");
  assert.equal(midway.thread.runtimeState, "waiting_for_approval");

  // Answering the last one resumes the turn.
  const final = await service.answerPrompt({
    threadId,
    promptId: "perm-fetch-fintel",
    choiceId: "allow",
    value: "codex-menu:0",
  });
  assert.equal(final.ok && final.promptState, null);
  const after = await service.hydrateThread({ threadId });
  assert.equal(after.thread.runtimeState, "running");
  // Both answers reached the runtime as prompt_answer writes.
  const answers = fakes.runtime.writes.filter((w) => w.input.kind === "prompt_answer");
  assert.equal(answers.length, 2);
});

test("stop_clears_the_pending_prompt_and_its_queue", async () => {
  // Prompts die with the runtime: after Stop, no card may linger (it would write
  // keystrokes to a dead PTY).
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
  });
  const started = await service.startThread({
    initialMessage: "do work",
    agentBinding: { agentId: "claude" },
    scope: { kind: "scratch", scratchCwd: "/tmp/thread-stop-queue" },
  });
  const threadId = started.ok ? started.thread.threadId : "";
  for (const [id, msg] of [["p1", "WebFetch: a"], ["p2", "WebFetch: b"]]) {
    await service.recordProviderPromptState({
      threadId,
      promptState: {
        promptId: id,
        threadId,
        agentId: "claude",
        kind: "approval",
        message: msg,
        source: "provider_hook",
      },
    });
  }
  await service.stopAgentRuntime({ threadId });
  const after = await service.hydrateThread({ threadId });
  // Interrupt clears the pending card + queue (they died with the turn) and
  // settles to idle, keeping the runtime alive.
  assert.equal(after.thread.promptState, undefined);
  assert.equal(after.thread.promptQueue, undefined);
  assert.equal(after.runtimeState, "idle");
  // Answering the now-cleared prompt is rejected (no card to answer).
  const stale = await service.answerPrompt({ threadId, promptId: "p2", value: "x" });
  assert.equal(stale.ok, false);
});

test("turn_end_after_answering_a_card_settles_and_drops_the_rest_of_the_batch", async () => {
  // Once the user has ACTED on the card, a turn-end is legitimate: denying the visible
  // card can cancel the rest of a batch, the agent ends its turn, and the now-dead
  // cards drop. The settle is ONE-SHOT — ignoring it because the thread was
  // waiting_for_approval left the thread "Working" forever once the stale card was
  // answered (adversarial review finding). (A turn-end on a NEVER-answered card is
  // spurious and keeps the card — see the bare-turn-end test above.)
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
  });
  const started = await service.startThread({
    initialMessage: "do work",
    agentBinding: { agentId: "claude" },
    scope: { kind: "scratch", scratchCwd: "/tmp/thread-settle-while-waiting" },
  });
  const threadId = started.ok ? started.thread.threadId : "";
  for (const [id, msg] of [["p1", "WebFetch: a"], ["p2", "WebFetch: b"]]) {
    await service.recordProviderPromptState({
      threadId,
      promptState: { promptId: id, threadId, agentId: "claude", kind: "approval", message: msg, source: "provider_hook" },
    });
  }
  // The user denies the visible card (p1); p2 is promoted. The agent then abandons the
  // batch and ends its turn — so the promoted, now-dead p2 must drop on the settle.
  const denied = await service.answerPrompt({ threadId, promptId: "p1", value: "decline" });
  assert.equal(denied.ok, true);
  const settled = await service.recordTurnComplete({ threadId });
  assert.equal(settled.ok, true);
  const after = await service.hydrateThread({ threadId });
  assert.equal(after.thread.runtimeState, "idle");
  assert.equal(after.thread.promptState, undefined);
  // The dead cards are gone; answering them is rejected, not typed into nothing.
  const stale = await service.answerPrompt({ threadId, promptId: "p2", value: "x" });
  assert.equal(stale.ok, false);
});

test("prompt_recorded_after_stop_is_rejected_not_resurrected", async () => {
  // A hook frame written just before Stop can be read by the signal poll's grace
  // cycles AFTER the runtime died. Recording it would resurrect a card on a dead
  // runtime and re-arm polling (adversarial review finding).
  const fakes = createFakes();
  const service = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id"),
  });
  // A thread with NO live runtime handle must reject a prompt (it could never
  // be answered). Seed an open thread with no activeRuntimeHandle.
  const service2 = createThreadRuntimeService({
    ...fakes.ports,
    clock: fixedClock,
    idGenerator: sequentialIdGenerator("id2"),
    initialThreads: [threadSeed("thread-noruntime", { runtimeState: "idle" })],
  });
  const late = await service2.recordProviderPromptState({
    threadId: "thread-noruntime",
    promptState: { promptId: "late", threadId: "thread-noruntime", agentId: "codex", kind: "approval", message: "x", source: "provider_hook" },
  });
  assert.equal(late.ok, false);
  const after = await service2.hydrateThread({ threadId: "thread-noruntime" });
  assert.equal(after.thread.promptState, undefined);
});
