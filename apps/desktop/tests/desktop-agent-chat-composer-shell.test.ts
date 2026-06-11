// Spec: docs_v2/specs/desktop-agent-chat-composer-shell.md

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  applyAgentChatBackendEvent,
  createAgentChatShellState,
  createAgentChatShellViewModel,
  selectAgentChatChoiceSurfaceRow,
  selectComposerAgent,
  setComposerActiveSurface,
  setComposerNewWorktreeIntent,
  resolveComposerNewWorktreeIntent,
  submitComposer,
  editQueuedInput,
  updateComposerDraft,
  addComposerAttachment,
  removeComposerAttachment,
  addComposerContextChip,
  removeComposerContextChip,
  setComposerContextChipComment,
  type AgentChatShellState,
} from "../src/desktop/application/domains/agent-chat/agent-chat-shell-state.ts";
import {
  applyBackendEventToAgentChatShell,
  toBackendCommandDraft,
} from "../src/desktop/adapters/inbound/react-renderer/agent-chat-contract-adapter.ts";
import { AgentChatShell } from "../src/desktop/adapters/inbound/react-renderer/agent-chat-shell.ts";
import {
  CONTRACT_VERSION,
  type AgentSessionBlockDto,
  type BackendEventEnvelope,
  type BackendEventKind,
  type BackendEventPayloadByKind,
  type PromptStateDto,
  type ProviderReadinessDto,
  type ThreadSummaryDto,
  type WorkbenchPaneRefDto,
} from "../src/shared/contracts/index.ts";

const now = "2026-05-27T00:00:00.000Z";
const later = "2026-05-27T00:00:01.000Z";

test("typing_in_start_composer_keeps_a_local_draft_without_emitting_a_backend_command", () => {
  const result = updateComposerDraft(createAgentChatShellState(), "Draft a plan");

  assert.equal(result.command, null);
  assert.equal(result.state.composer.draft, "Draft a plan");
  assert.equal(result.state.thread, null);
});

test("sending_a_non_empty_start_composer_draft_emits_thread_start_with_launch_options", () => {
  const state = updateComposerDraft(
    createAgentChatShellState({
      startOptions: {
        agentBinding: { agentId: "codex" },
        scope: { kind: "project", projectId: "project-tide", cwd: "/repo/tide" },
        launchOptions: {
          model: "GPT-5.5 High",
          permission: "Auto-review",
          worktree: "current folder",
          branch: "main",
        },
      },
    }),
    "Build the Desktop shell",
  ).state;

  const result = submitComposer(state);
  const command = result.command ? toBackendCommandDraft(result.command) : null;

  assert.equal(command?.kind, "thread.start");
  // A client-generated threadId is attached so the new thread opens optimistically
  // and the backend binds to the same id.
  assert.equal(typeof command?.payload.threadId, "string");
  assert.equal(command?.payload.initialMessage, "Build the Desktop shell");
  assert.deepEqual(command?.payload.agentBinding, { agentId: "codex" });
  assert.deepEqual(command?.payload.scope, {
    kind: "project",
    projectId: "project-tide",
    cwd: "/repo/tide",
  });
  assert.deepEqual(command?.payload.launchOptions, {
    model: "GPT-5.5 High",
    permission: "Auto-review",
    worktree: "current folder",
    branch: "main",
  });
});

test("sending_an_empty_start_composer_draft_emits_no_command", () => {
  const state = updateComposerDraft(createAgentChatShellState(), "   ").state;
  const result = submitComposer(state);

  assert.equal(result.command, null);
});

// Spec: docs_v2/specs/worktree-start-experience.md

test("new_worktree_intent_defers_creation_and_labels_the_worktree_chip", () => {
  const base = createAgentChatShellState({
    startOptions: {
      agentBinding: { agentId: "claude" },
      scope: { kind: "project", projectId: "repo", cwd: "/repo" },
      launchOptions: { worktree: "current folder", branch: "main" },
    },
  });

  // Blank name → pending intent; the chip reads "New worktree (auto)" (never "new").
  const auto = setComposerNewWorktreeIntent(base, { name: "" }).state;
  assert.equal(auto.composer.startOptions.launchOptions?.worktree, "new");
  assert.equal(auto.composer.startOptions.launchOptions?.newWorktreeName, "");
  const autoItems = createAgentChatShellViewModel(auto).composer.contextItems;
  assert.equal(autoItems.find((item) => item.label === "Worktree")?.value, "New worktree (auto)");

  // Typed name → chip reads "New worktree: <name>".
  const named = setComposerNewWorktreeIntent(base, { name: "spike" }).state;
  const namedItems = createAgentChatShellViewModel(named).composer.contextItems;
  assert.equal(namedItems.find((item) => item.label === "Worktree")?.value, "New worktree: spike");

  // A base branch chosen in the inline form is stored as the launch branch (the
  // `git worktree add` start point read at send). The Branch chip reflects it.
  const based = setComposerNewWorktreeIntent(base, { name: "spike", baseBranch: "develop" }).state;
  assert.equal(based.composer.startOptions.launchOptions?.branch, "develop");
  const basedItems = createAgentChatShellViewModel(based).composer.contextItems;
  assert.equal(basedItems.find((item) => item.label === "Branch")?.value, "develop");
});

test("resolving_new_worktree_intent_rescopes_and_resets_launch_options", () => {
  const base = createAgentChatShellState({
    startOptions: {
      agentBinding: { agentId: "claude" },
      scope: { kind: "project", projectId: "repo", cwd: "/repo" },
      launchOptions: { worktree: "new", newWorktreeName: "x", branch: "develop" },
    },
  });

  const resolved = resolveComposerNewWorktreeIntent(base, {
    cwd: "/repo.worktree/fix-login",
    branch: "fix-login",
  }).state;

  // The Start Composer is scoped to the created worktree cwd...
  assert.deepEqual(resolved.composer.startOptions.scope, {
    kind: "project",
    projectId: "fix-login",
    cwd: "/repo.worktree/fix-login",
  });
  // ...and the worktree sentinel is reset (the new cwd is now its own folder),
  // the branch reflects the created branch, and the pending name is dropped.
  const options = resolved.composer.startOptions.launchOptions ?? {};
  assert.equal(options.worktree, "current folder");
  assert.equal(options.branch, "fix-login");
  assert.equal("newWorktreeName" in options, false);
});

test("composer_worktree_menu_offers_delete_on_existing_worktrees", () => {
  // Spec: docs_v2/specs/worktree-branch-deletion.md — each existing worktree row
  // carries a trailing delete action (routed via a `delete-worktree:` rowId).
  const base = createAgentChatShellState({
    startOptions: {
      agentBinding: { agentId: "claude" },
      scope: { kind: "project", projectId: "repo", cwd: "/repo" },
      launchOptions: { worktree: "current folder" },
    },
  });
  const state: AgentChatShellState = {
    ...setComposerActiveSurface(base, "worktree_menu").state,
    availableWorktrees: [
      { path: "/repo", branch: "main", current: true },
      { path: "/repo.worktree/fix-login", branch: "fix-login", current: false },
    ],
  };

  const surface = createAgentChatShellViewModel(state).composer.activeSurface;
  const worktreeRow = surface?.rows.find(
    (entry) => entry.rowId === "worktree:/repo.worktree/fix-login",
  );
  assert.equal(worktreeRow?.action?.rowId, "delete-worktree:/repo.worktree/fix-login");
  // The "current folder" / new-worktree affordances carry no delete action.
  assert.equal(surface?.rows.find((entry) => entry.rowId === "worktree:current")?.action, undefined);
  assert.equal(surface?.rows.find((entry) => entry.rowId === "new-worktree")?.action, undefined);
});

// --- UC-2: Compose Composer Attachments ---
// Spec: docs_v2/specs/composer-image-attachments.md

test("adds_and_removes_composer_image_attachments", () => {
  // UC-2 BR-4: an attachment can be added to and removed from the Composer draft.
  const attachment = {
    id: "att-1",
    name: "shot.png",
    mediaType: "image/png",
    dataBase64: "AAAA",
  };
  const added = addComposerAttachment(createAgentChatShellState(), attachment).state;
  assert.equal(added.composer.attachments.length, 1);
  assert.equal(added.composer.attachments[0].id, "att-1");

  const removed = removeComposerAttachment(added, "att-1").state;
  assert.equal(removed.composer.attachments.length, 0);
});

test("clears_composer_attachments_after_send", () => {
  // UC-2 BR-5: a successful send clears the Composer attachments and carries them
  // on the command (text-empty send is still valid when an image is attached).
  const withAttachment = addComposerAttachment(createAgentChatShellState(), {
    id: "att-1",
    name: "shot.png",
    mediaType: "image/png",
    dataBase64: "AAAA",
  }).state;

  const result = submitComposer(withAttachment);

  assert.equal(result.command?.kind, "thread.start");
  assert.equal(
    result.command?.kind === "thread.start" &&
      result.command.payload.attachments?.length,
    1,
  );
  assert.equal(result.state.composer.attachments.length, 0);
});

test("directory_trust_blocker_offers_a_trust_this_folder_action", () => {
  // Spec: docs_v2/specs/workspace-trust-grant.md
  // UC-2 BR-4: selecting the trust row emits provider.trustWorkspace for the thread.
  const base = createAgentChatShellState();
  const state: AgentChatShellState = {
    ...base,
    providerReadiness: {
      agentId: "claude",
      ready: false,
      blockers: [
        {
          kind: "directory_trust_required",
          message: "Claude Code workspace trust is required.",
          scope: "execution_context",
        },
      ],
    },
  };

  const result = selectAgentChatChoiceSurfaceRow(
    state,
    "provider_readiness",
    "directory_trust_required:trust",
    "thread-1",
  );

  assert.equal(result.command?.kind, "provider.trustWorkspace");
  assert.equal(
    result.command?.kind === "provider.trustWorkspace" &&
      result.command.payload.threadId,
    "thread-1",
  );
});

test("new_thread_start_screen_renders_start_composer_without_fake_cues", () => {
  const state = createAgentChatShellState({
    startOptions: {
      agentBinding: { agentId: "codex" },
      scope: { kind: "project", projectId: "tide", cwd: "/repo/tide" },
      launchOptions: {
        model: "GPT-5.5 High",
        permission: "Auto-review",
        worktree: "current folder",
        branch: "main",
      },
    },
  });
  const html = renderShell(state);

  assert.match(html, /data-composer-mode="start"/);
  assert.match(html, /What should we build in tide\?/);
  assert.match(html, /Do anything/);
  assert.match(html, /Codex CLI/);
  assert.match(html, /current folder/);
  assert.match(html, /GPT-5\.5 High/);
  assert.doesNotMatch(html, /Start with one focused Thread/);
  assert.doesNotMatch(html, /Review changes/);
  assert.doesNotMatch(html, /Open a browser check/);
  assert.doesNotMatch(html, /Continue implementation/);
});

test("follow_up_composer_emits_composer_send_input_for_the_active_thread", () => {
  const hydrated = applyBackendEventToAgentChatShell(
    createAgentChatShellState(),
    backendEvent("thread.hydrated", {
      thread,
      blocks: [],
      runtimeState: "idle",
    }),
  );
  const state = updateComposerDraft(hydrated, "Continue this Thread").state;

  const result = submitComposer(state);
  const command = result.command ? toBackendCommandDraft(result.command) : null;

  assert.equal(command?.kind, "composer.sendInput");
  assert.equal(command?.payload.threadId, "thread-shell");
  assert.equal(command?.payload.input, "Continue this Thread");
  // Follow-ups carry the current composer launch options so a changed model
  // (or reasoning/permission) applies, not just the thread's original.
  assert.ok("launchOptions" in (command?.payload ?? {}));
});

test("editing_the_queued_message_emits_edit_queued_input_command", () => {
  const hydrated = applyBackendEventToAgentChatShell(
    createAgentChatShellState(),
    backendEvent("thread.hydrated", { thread, blocks: [], runtimeState: "running" }),
  );
  const sent = submitComposer(updateComposerDraft(hydrated, "teh typo").state);
  assert.deepEqual(sent.state.queuedInputs, ["teh typo"]);

  const edited = editQueuedInput(sent.state, 0, "the fix");

  assert.deepEqual(edited.state.queuedInputs, ["the fix"]);
  const command = edited.command ? toBackendCommandDraft(edited.command) : null;
  assert.equal(command?.kind, "composer.editQueuedInput");
  assert.equal(command?.payload.threadId, "thread-shell");
  assert.equal(command?.payload.value, "the fix");
  assert.equal(command?.payload.index, 0);
});

test("editing_the_queued_message_with_blank_value_discards_the_queued_row", () => {
  const hydrated = applyBackendEventToAgentChatShell(
    createAgentChatShellState(),
    backendEvent("thread.hydrated", { thread, blocks: [], runtimeState: "running" }),
  );
  const sent = submitComposer(updateComposerDraft(hydrated, "second").state);

  const discarded = editQueuedInput(sent.state, 0, "   ");

  assert.deepEqual(discarded.state.queuedInputs, []);
  assert.equal(discarded.command?.kind, "composer.editQueuedInput");
});

test("multiple_followups_stack_then_reconcile_to_the_backend_queue_on_state_change", () => {
  const hydrated = applyBackendEventToAgentChatShell(
    createAgentChatShellState(),
    backendEvent("thread.hydrated", { thread, blocks: [], runtimeState: "running" }),
  );
  const first = submitComposer(updateComposerDraft(hydrated, "first").state);
  const second = submitComposer(updateComposerDraft(first.state, "second").state);

  // Optimistic stack in submission order — the user SEES several queued instantly.
  assert.deepEqual(second.state.queuedInputs, ["first", "second"]);
  const html = renderShell(second.state);
  assert.match(html, /first/);
  assert.match(html, /second/);

  // The backend is authoritative: when it flushes the head, agentRuntime.stateChanged
  // carries the reduced queue and the renderer reflects it (no user-block guessing).
  const afterFlush = applyBackendEventToAgentChatShell(
    second.state,
    backendEvent("agentRuntime.stateChanged", {
      threadId: "thread-shell",
      state: "running",
      changedAt: "2026-05-29T00:00:01.000Z",
      queuedInputs: ["second"],
    }),
  );
  assert.deepEqual(afterFlush.queuedInputs, ["second"]);
});

test("queued_messages_stay_docked_in_the_steer_stack_while_a_prompt_is_open", () => {
  // A queued follow-up must not jump into the transcript when an Allow/Deny card
  // opens (chatState=waiting_for_approval) and back to the steer stack when it closes.
  const running = applyBackendEventToAgentChatShell(
    createAgentChatShellState(),
    backendEvent("thread.hydrated", { thread, blocks: [], runtimeState: "running" }),
  );
  const queued = submitComposer(updateComposerDraft(running, "queued one").state).state;
  const withPrompt = applyBackendEventToAgentChatShell(
    queued,
    backendEvent("prompt.changed", { threadId: "thread-shell", prompt }),
  );

  // Still docked as a "대기 중" steer chip even though a prompt is open.
  const html = renderShell(withPrompt);
  assert.match(html, /대기 중/);
  assert.match(html, /queued one/);
});

test("an_idle_send_runs_and_its_optimistic_chip_reconciles_away_not_queued", () => {
  // Regression: after a turn ends, typing + sending must RUN the message, not leave
  // it queued. The optimistic chip clears when the command's stateChanged carries
  // the backend's (empty) queue — no more "sent AND queued".
  const hydrated = applyBackendEventToAgentChatShell(
    createAgentChatShellState(),
    backendEvent("thread.hydrated", { thread, blocks: [], runtimeState: "idle" }),
  );
  const sent = submitComposer(updateComposerDraft(hydrated, "run me").state);
  assert.deepEqual(sent.state.queuedInputs, ["run me"]); // instant optimistic chip

  const reconciled = applyBackendEventToAgentChatShell(
    sent.state,
    backendEvent("agentRuntime.stateChanged", {
      threadId: "thread-shell",
      state: "running",
      changedAt: "2026-05-29T00:00:01.000Z",
      queuedInputs: [],
    }),
  );
  assert.deepEqual(reconciled.queuedInputs, []);
});

test("editing_with_no_queued_message_is_a_noop", () => {
  const hydrated = applyBackendEventToAgentChatShell(
    createAgentChatShellState(),
    backendEvent("thread.hydrated", { thread, blocks: [], runtimeState: "idle" }),
  );

  const result = editQueuedInput(hydrated, 0, "anything");

  assert.equal(result.command, null);
  assert.equal(result.state, hydrated);
});

test("the_queued_row_renders_an_edit_affordance_while_a_turn_runs", () => {
  const hydrated = applyBackendEventToAgentChatShell(
    createAgentChatShellState(),
    backendEvent("thread.hydrated", { thread, blocks: [], runtimeState: "running" }),
  );
  const queued = submitComposer(updateComposerDraft(hydrated, "queued message").state).state;

  const markup = renderShell(queued);

  // A message queued behind a live turn docks to the Composer as a "steer" chip
  // (Codex-style): the "대기 중" badge plus an edit affordance to fix it before it
  // runs.
  assert.ok(markup.includes("대기 중"));
  assert.ok(markup.includes("composer-steer"));
  assert.ok(markup.includes("Edit queued message"));
});

test("an_editor_code_selection_added_to_chat_is_folded_into_the_sent_message", () => {
  // Content→chat: selecting code in the editor and clicking "Add to chat" stages
  // a context chip; on send it is prepended to the message as a labeled,
  // fenced-code reference (with the user's per-region comment), and the chips
  // clear so the next message is clean. This is the full editor→composer→backend
  // contract the renderer panes drive via onAddContentToChat.
  const hydrated = applyBackendEventToAgentChatShell(
    createAgentChatShellState(),
    backendEvent("thread.hydrated", { thread, blocks: [], runtimeState: "idle" }),
  );
  const withChip = addComposerContextChip(hydrated, {
    id: "chip-1",
    kind: "code",
    label: "thread.ts L10-12",
    text: "`thread.ts` (L10-12)\n```ts\nexport type AgentId = string;\n```",
  }).state;
  const commented = setComposerContextChipComment(withChip, "chip-1", "what is this type for?").state;
  const drafted = updateComposerDraft(commented, "explain").state;

  // The composer renders the staged chip (label + remove + comment affordance).
  const markup = renderShell(drafted);
  assert.ok(markup.includes("thread.ts L10-12"));

  const result = submitComposer(drafted);
  const command = result.command ? toBackendCommandDraft(result.command) : null;
  assert.equal(command?.kind, "composer.sendInput");
  const input = command?.kind === "composer.sendInput" ? String(command.payload.input) : "";
  // Labeled header, the per-region comment, the fenced code, then the draft.
  assert.ok(input.includes("**↳ thread.ts L10-12**"));
  assert.ok(input.includes("what is this type for?"));
  assert.ok(input.includes("```ts\nexport type AgentId = string;\n```"));
  assert.ok(input.trimEnd().endsWith("explain"));
  // Chips clear on send.
  assert.equal(result.state.composer.contextChips.length, 0);
});

test("a_message_with_only_an_added_chip_and_no_draft_is_still_a_valid_send", () => {
  // Adding content to chat WITHOUT typing is a complete message — the staged
  // chip alone is sent (a blank-draft, no-chip, no-attachment composer is the
  // only no-op).
  const hydrated = applyBackendEventToAgentChatShell(
    createAgentChatShellState(),
    backendEvent("thread.hydrated", { thread, blocks: [], runtimeState: "idle" }),
  );
  const withChip = addComposerContextChip(hydrated, {
    id: "chip-1",
    kind: "terminal",
    label: "npm test",
    text: "```\nnpm test → 564 passing\n```",
  }).state;

  const result = submitComposer(withChip);
  const command = result.command ? toBackendCommandDraft(result.command) : null;
  assert.equal(command?.kind, "composer.sendInput");
  const input = command?.kind === "composer.sendInput" ? String(command.payload.input) : "";
  assert.ok(input.includes("**↳ npm test**"));
  assert.ok(input.includes("npm test → 564 passing"));
});

test("removing_a_staged_chip_drops_it_from_the_next_message", () => {
  const hydrated = applyBackendEventToAgentChatShell(
    createAgentChatShellState(),
    backendEvent("thread.hydrated", { thread, blocks: [], runtimeState: "idle" }),
  );
  const withTwo = addComposerContextChip(
    addComposerContextChip(hydrated, {
      id: "chip-1",
      kind: "code",
      label: "keep.ts",
      text: "kept",
    }).state,
    { id: "chip-2", kind: "code", label: "drop.ts", text: "dropped" },
  ).state;
  const pruned = removeComposerContextChip(withTwo, "chip-2").state;
  const drafted = updateComposerDraft(pruned, "go").state;

  const result = submitComposer(drafted);
  const command = result.command ? toBackendCommandDraft(result.command) : null;
  const input = command?.kind === "composer.sendInput" ? String(command.payload.input) : "";
  assert.ok(input.includes("**↳ keep.ts**"));
  assert.ok(!input.includes("drop.ts"));
  assert.ok(!input.includes("dropped"));
});

test("follow_up_carries_a_changed_model_in_launch_options", () => {
  const hydrated = applyBackendEventToAgentChatShell(
    createAgentChatShellState(),
    backendEvent("thread.hydrated", { thread, blocks: [], runtimeState: "idle" }),
  );
  // Change the model via the model menu, then send a follow-up.
  const remodeled = selectAgentChatChoiceSurfaceRow(
    setComposerActiveSurface(hydrated, "model_menu").state,
    "model_menu",
    "model:gpt-5.4",
  ).state;
  const state = updateComposerDraft(remodeled, "go").state;
  const command = submitComposer(state).command;
  assert.equal(command?.kind, "composer.sendInput");
  assert.equal(
    command?.kind === "composer.sendInput" && command.payload.launchOptions?.model,
    "gpt-5.4",
  );
});

test("hydrating_thread_with_workbench_panes_marks_workbench_open", () => {
  const state = applyBackendEventToAgentChatShell(
    createAgentChatShellState(),
    backendEvent("thread.hydrated", {
      thread,
      blocks: [],
      runtimeState: "idle",
      workbenchPanes: [browserPane("pane-browser-1")],
    }),
  );
  const view = createAgentChatShellViewModel(state);

  assert.equal(state.workbenchOpen, true);
  assert.equal(view.workbenchOpen, true);
});

test("active_prompt_state_routes_submit_to_prompt_answer", () => {
  const withThread = applyBackendEventToAgentChatShell(
    createAgentChatShellState(),
    backendEvent("thread.hydrated", {
      thread,
      blocks: [],
      runtimeState: "waiting_for_approval",
    }),
  );
  const withPrompt = applyBackendEventToAgentChatShell(
    withThread,
    backendEvent("prompt.changed", {
      threadId: "thread-shell",
      prompt,
    }),
  );
  const state = updateComposerDraft(withPrompt, "allow_once").state;

  const result = submitComposer(state);
  const command = result.command ? toBackendCommandDraft(result.command) : null;

  assert.equal(command?.kind, "prompt.answer");
  assert.deepEqual(command?.payload, {
    threadId: "thread-shell",
    promptId: "prompt-approval",
    value: "allow_once",
  });
});

test("provider_readiness_blocker_preserves_the_composer_draft_and_marks_shell_blocked", () => {
  const drafted = updateComposerDraft(createAgentChatShellState(), "Keep this draft").state;
  const blocked = applyBackendEventToAgentChatShell(
    drafted,
    backendEvent("providerReadiness.changed", {
      readiness: providerReadiness,
    }),
  );
  const view = createAgentChatShellViewModel(blocked);

  assert.equal(blocked.composer.draft, "Keep this draft");
  assert.equal(view.chatState, "provider_not_ready");
  assert.match(renderShell(blocked), /Directory Trust is required/);
});

test("provider_readiness_setup_row_emits_workbench_command_and_preserves_draft", () => {
  // Spec: docs_v2/specs/provider-setup-surface-workbench-command.md
  const withThread = applyBackendEventToAgentChatShell(
    updateComposerDraft(createAgentChatShellState(), "Keep this draft").state,
    backendEvent("thread.hydrated", {
      thread,
      blocks: [],
      runtimeState: "not_started",
    }),
  );
  const blocked = applyBackendEventToAgentChatShell(
    withThread,
    backendEvent("providerReadiness.changed", {
      readiness: providerReadiness,
    }),
  );

  const selected = selectAgentChatChoiceSurfaceRow(
    blocked,
    "provider_readiness",
    "directory_trust_required:setup",
  );
  const command = selected.command ? toBackendCommandDraft(selected.command) : null;

  assert.equal(selected.state.composer.draft, "Keep this draft");
  assert.equal(command?.kind, "workbench.command");
  assert.deepEqual(command?.payload, {
    threadId: "thread-shell",
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
});

test("follow_up_composer_has_no_thread_context_block", () => {
  // Canonical board (1303:1866): the follow-up composer is just the input +
  // chips — no read-only Agent/Project context block, no inline edit controls.
  const state = applyBackendEventToAgentChatShell(
    createAgentChatShellState(),
    backendEvent("thread.hydrated", {
      thread,
      blocks: [],
      runtimeState: "idle",
    }),
  );
  const view = createAgentChatShellViewModel(state);

  assert.equal(view.composer.mode, "follow_up");
  assert.equal(view.composer.contextControlsEditable, false);
  const html = renderShell(state);
  assert.doesNotMatch(html, /composer-shell__context\b/);
  assert.doesNotMatch(html, /data-context-kind="agent"/);
  assert.doesNotMatch(html, /name="agent"/);
  assert.match(html, /Ask for follow-up changes/);
});

test("follow_up_shell_does_not_fabricate_worktree_or_branch_when_thread_contract_omits_them", () => {
  const state = applyBackendEventToAgentChatShell(
    createAgentChatShellState(),
    backendEvent("thread.hydrated", {
      thread,
      blocks: [],
      runtimeState: "idle",
    }),
  );
  const html = renderShell(state);

  assert.doesNotMatch(html, /current folder/);
  assert.doesNotMatch(html, />main</);
});

test("agent_session_block_upserts_render_one_visible_block_per_block_id", () => {
  const withFirstBlock = applyBackendEventToAgentChatShell(
    createAgentChatShellState(),
    backendEvent("agentSessionBlock.upserted", {
      block: block("block-1", "streaming", "hel"),
    }),
  );
  const withUpdatedBlock = applyBackendEventToAgentChatShell(
    withFirstBlock,
    backendEvent("agentSessionBlock.upserted", {
      block: block("block-1", "complete", "hello"),
    }),
  );
  const view = createAgentChatShellViewModel(withUpdatedBlock);

  assert.equal(view.blocks.length, 1);
  assert.equal(view.blocks[0].body, "hello");
  assert.match(renderShell(withUpdatedBlock), /hello/);
});

test("an attached image renders as a thumbnail, not the raw '[Attached image: path]'", () => {
  // The agent gets the image PATH in the message (to read the file); the user's
  // transcript should show a preview and drop the path plumbing.
  const state = applyBackendEventToAgentChatShell(
    createAgentChatShellState(),
    backendEvent("agentSessionBlock.upserted", {
      block: {
        blockId: "u1",
        threadId: "thread-shell",
        agentId: "codex",
        kind: "agent_message",
        role: "user",
        status: "complete",
        body: "look at this\n\n[Attached image: /tmp/My Pics/x.png]",
        updatedAt: later,
      },
    }),
  );
  const html = renderShell(state);
  assert.match(html, /class="agent-session-turn__image"/); // a thumbnail element
  assert.match(html, /src="file:\/\/\/tmp\/My%20Pics\/x\.png"/); // file:// w/ encoded path
  assert.doesNotMatch(html, /Attached image:/); // raw path text is gone
  assert.match(html, /look at this/); // the message text stays
});

function withToolBlocks(
  ...specs: { id: string; kind: "tool_call" | "tool_result"; title: string; body: string }[]
): AgentChatShellState {
  let state = createAgentChatShellState();
  for (const spec of specs) {
    state = applyBackendEventToAgentChatShell(
      state,
      backendEvent("agentSessionBlock.upserted", {
        block: {
          blockId: spec.id,
          threadId: "thread-shell",
          agentId: "codex",
          kind: spec.kind,
          role: "tool",
          status: "complete",
          title: spec.title,
          body: spec.body,
          updatedAt: later,
        },
      }),
    );
  }
  return state;
}

test("consecutive_tool_blocks_collapse_into_a_codex_style_activity_summary", () => {
  // Spec: docs_v2/specs/agent-session-block-rendering-path.md D13
  const state = withToolBlocks(
    { id: "t1", kind: "tool_call", title: "apply_patch", body: "*** patch" },
    { id: "t2", kind: "tool_result", title: "apply_patch", body: "ok" },
    { id: "t3", kind: "tool_call", title: "exec_command", body: "ls" },
    { id: "t4", kind: "tool_result", title: "exec_command", body: "a.txt" },
    { id: "t5", kind: "tool_call", title: "exec_command", body: "pwd" },
    { id: "t6", kind: "tool_result", title: "exec_command", body: "/tmp" },
  );
  const html = renderShell(state);

  // One muted summary row aggregating the calls by category, distinct tool role.
  assert.match(html, /data-block-role="tool"/);
  assert.match(html, /Edited 1 file, ran 2 commands/);
  // Collapsed by default: the per-tool monospace detail is not rendered yet.
  assert.doesNotMatch(html, /agent-session-turn__tool-body/);
});

test("tool_activity_summary_categorizes_read_and_search_tools", () => {
  // Spec: docs_v2/specs/agent-session-block-rendering-path.md D13
  const state = withToolBlocks(
    { id: "r1", kind: "tool_call", title: "Read", body: "file.ts" },
    { id: "r2", kind: "tool_result", title: "Read", body: "..." },
    { id: "g1", kind: "tool_call", title: "Grep", body: "needle" },
    { id: "g2", kind: "tool_result", title: "Grep", body: "3 matches" },
  );
  assert.match(renderShell(state), /Read 1 file, 1 search/);
});

test("edit_tool_calls_surface_a_files_changed_list", () => {
  // Spec: docs_v2/specs/agent-session-block-rendering-path.md D14
  const state = withToolBlocks(
    { id: "e1", kind: "tool_call", title: "Edit", body: '{"file_path":"src/desktop/app.ts","old_string":"a"}' },
    { id: "e2", kind: "tool_result", title: "Edit", body: "ok" },
    { id: "w1", kind: "tool_call", title: "Write", body: '{"file_path":"README.md"}' },
    { id: "w2", kind: "tool_result", title: "Write", body: "ok" },
  );
  const html = renderShell(state);

  // Distinct edited files surface with filename + muted parent dir, display-only.
  assert.match(html, /agent-session-tools__files/);
  assert.match(html, /app\.ts/);
  assert.match(html, /README\.md/);
});

test("codex_apply_patch_files_changed_list_parses_patch_headers", () => {
  // Spec: docs_v2/specs/agent-session-block-rendering-path.md D14
  const state = withToolBlocks(
    {
      id: "p1",
      kind: "tool_call",
      title: "apply_patch",
      body: "*** Begin Patch\n*** Update File: docs/glossary.md\n@@\n+x\n*** Add File: docs/new.md\n",
    },
    { id: "p2", kind: "tool_result", title: "apply_patch", body: "ok" },
  );
  const html = renderShell(state);
  assert.match(html, /glossary\.md/);
  assert.match(html, /new\.md/);
});

test("agent_session_text_blocks_render_as_transcript_turns_not_status_cards", () => {
  const state = applyBackendEventToAgentChatShell(
    createAgentChatShellState(),
    backendEvent("thread.hydrated", {
      thread,
      runtimeState: "idle",
      blocks: [
        {
          blockId: "block-user-1",
          threadId: "thread-shell",
          kind: "user_message",
          role: "user",
          status: "complete",
          title: "You",
          body: "Can you review this layout?",
          updatedAt: later,
        },
        block("block-agent-1", "complete", "Yes. I will check the Thread flow first."),
      ],
    }),
  );
  const html = renderShell(state);

  assert.match(html, /agent-session-turn agent-session-turn--user/);
  assert.match(html, /agent-session-turn agent-session-turn--agent/);
  assert.match(html, /Can you review this layout/);
  assert.match(html, /Yes\. I will check the Thread flow first/);
  assert.doesNotMatch(html, /agent-session-block/);
  assert.doesNotMatch(html, />complete</);
});

test("running_agent_runtime_state_does_not_render_a_terminal_pane", () => {
  const running = applyBackendEventToAgentChatShell(
    createAgentChatShellState(),
    backendEvent("agentRuntime.stateChanged", {
      threadId: "thread-shell",
      state: "running",
      changedAt: now,
    }),
  );
  const html = renderShell(running);

  assert.match(html, /data-runtime-state="running"/);
  assert.doesNotMatch(html, /Terminal Pane/);
  assert.doesNotMatch(html, /role="terminal"/);
});

test("composer_shell_displays_thread_runtime_and_prompt_state", () => {
  const withThread = applyBackendEventToAgentChatShell(
    createAgentChatShellState(),
    backendEvent("thread.hydrated", {
      thread,
      blocks: [],
      runtimeState: "waiting_for_approval",
    }),
  );
  const withPrompt = applyBackendEventToAgentChatShell(
    withThread,
    backendEvent("prompt.changed", {
      threadId: "thread-shell",
      prompt,
    }),
  );
  const html = renderShell(withPrompt);

  assert.match(html, /Desktop shell/);
  assert.match(html, /waiting_for_approval/);
  assert.match(html, /Allow command/);
});

test("desktop_application_shell_state_does_not_import_react_backend_or_shared_contracts", () => {
  const mentions = findSourceMentions(
    ["src/desktop/application"],
    /from\s+["'][^"']*(?:react|backend\/|shared\/contracts)|import\(["'][^"']*(?:react|backend\/|shared\/contracts)/,
  );

  assert.deepEqual(mentions, []);
});

test("composer_shell_command_adapter_only_claims_shell_owned_backend_command_kinds", () => {
  const source = readRepoFile(
    "src/desktop/adapters/inbound/react-renderer/agent-chat-contract-adapter.ts",
  );

  assert.doesNotMatch(source, /BackendCommandKind/);
  assert.doesNotMatch(source, /as AgentChatBackendCommandDraft/);
  assert.match(source, /"thread\.start"/);
  assert.match(source, /"composer\.sendInput"/);
  assert.match(source, /"prompt\.answer"/);
  assert.match(source, /"workbench\.command"/);
  // The composer's interrupt action emits agentRuntime.stop (a runtime-lifecycle
  // command the agent chat owns, alongside thread.start / composer.sendInput).
  assert.match(source, /"agentRuntime\.stop"/);
});

test("agent_chip_renders_one_visible_value_for_provider_cli_and_tide_api_sources", () => {
  const codexHtml = renderShell(createAgentChatShellState());
  const openAiState = selectComposerAgent(createAgentChatShellState(), "openai_api").state;
  const openAiHtml = renderShell(openAiState);

  assert.equal((codexHtml.match(/data-context-kind="agent"/g) ?? []).length, 1);
  assert.equal((openAiHtml.match(/data-context-kind="agent"/g) ?? []).length, 1);
  assert.match(codexHtml, /Codex CLI/);
  assert.match(openAiHtml, /OpenAI API/);
  assert.match(openAiHtml, /data-agent-runtime-source="tide_api"/);
  assert.doesNotMatch(openAiHtml, /Tide API runtime.*Codex Agent Integration/s);
});

test("model_chip_routes_menu_data_by_agent_runtime_source", () => {
  const codexState = setComposerActiveSurface(createAgentChatShellState(), "model_menu").state;
  const openAiState = setComposerActiveSurface(
    selectComposerAgent(createAgentChatShellState(), "openai_api").state,
    "model_menu",
  ).state;
  const codexHtml = renderShell(codexState);
  const openAiHtml = renderShell(openAiState);

  assert.match(codexHtml, /Model/);
  assert.match(codexHtml, /Codex Agent Integration/);
  assert.doesNotMatch(codexHtml, /OpenAI Provider Account/);
  assert.match(openAiHtml, /OpenAI Provider Account/);
  assert.doesNotMatch(openAiHtml, /Codex Agent Integration/);
});

test("codex_model_chip_renders_polished_label_but_stores_provider_native_value", () => {
  // Spec: docs_v2/specs/composer-agent-runtime-source.md D5/D5a
  const withModelMenu = setComposerActiveSurface(
    createAgentChatShellState(),
    "model_menu",
  ).state;
  const selected = selectAgentChatChoiceSurfaceRow(
    withModelMenu,
    "model_menu",
    "model:gpt-5.5",
  ).state;
  const view = createAgentChatShellViewModel(selected);

  assert.equal(selected.composer.startOptions.launchOptions?.model, "gpt-5.5");
  // Reasoning defaults to Medium when unset; the label shows model + effort.
  assert.equal(view.composer.modelLabel, "GPT-5.5 · Medium");
});

test("codex_reasoning_effort_row_sets_launch_option_and_updates_chip_label", () => {
  // Spec: docs_v2/specs/composer-agent-runtime-source.md D5a
  const withModelMenu = setComposerActiveSurface(
    createAgentChatShellState(),
    "model_menu",
  ).state;
  const high = selectAgentChatChoiceSurfaceRow(
    withModelMenu,
    "model_menu",
    "reasoning-high",
  ).state;
  const view = createAgentChatShellViewModel(high);

  assert.equal(high.composer.startOptions.launchOptions?.reasoning, "high");
  assert.equal(view.composer.modelLabel, "GPT-5.5 · High");
});

test("selecting_antigravity_updates_visible_model_and_permission_defaults_away_from_codex_gpt", () => {
  const selected = selectComposerAgent(createAgentChatShellState(), "antigravity").state;
  const view = createAgentChatShellViewModel(selected);

  assert.equal(selected.composer.startOptions.agentBinding.agentId, "antigravity");
  assert.equal(selected.composer.startOptions.agentBinding.runtimeSource?.kind, "provider_cli");
  assert.equal(view.composer.modelLabel, "Default");
  assert.equal(view.composer.permissionLabel, "Ask for approval");
  assert.notEqual(view.composer.modelLabel, "GPT-5.5 High");
});

test("selecting_openai_api_uses_api_model_id_not_codex_model_label", () => {
  const selected = selectComposerAgent(createAgentChatShellState(), "openai_api").state;
  const view = createAgentChatShellViewModel(selected);

  assert.equal(selected.composer.startOptions.agentBinding.agentId, "openai_api");
  assert.equal(selected.composer.startOptions.agentBinding.runtimeSource?.kind, "tide_api");
  assert.equal(selected.composer.startOptions.launchOptions?.model, "gpt-5.5");
  assert.equal(view.composer.modelLabel, "gpt-5.5");
});

test("follow_up_composer_model_label_uses_active_thread_launch_options", () => {
  // Spec: docs_v2/specs/thread-launch-options-contract.md
  const state = createAgentChatShellState({
    startOptions: {
      agentBinding: { agentId: "codex" },
      scope: { kind: "project", projectId: "tide", cwd: "/repo/tide" },
      launchOptions: { model: "GPT-5.5 High", permission: "workspace-write" },
    },
  });
  const hydrated = applyAgentChatBackendEvent(
    state,
    backendEvent("thread.hydrated", {
      thread: {
        ...thread,
        agentBinding: {
          agentId: "antigravity",
          runtimeSource: { kind: "provider_cli", integrationId: "antigravity" },
        },
        launchOptions: { model: "Antigravity default", permission: "default" },
      },
      blocks: [],
      runtimeState: "idle",
    }),
  );
  const view = createAgentChatShellViewModel(hydrated);

  assert.equal(view.composer.mode, "follow_up");
  assert.equal(view.composer.modelLabel, "Default");
  assert.equal(view.composer.permissionLabel, "Ask for approval");
});

test("follow_up_composer_model_label_falls_back_to_active_agent_default", () => {
  // Spec: docs_v2/specs/thread-launch-options-contract.md
  const state = createAgentChatShellState({
    startOptions: {
      agentBinding: { agentId: "codex" },
      scope: { kind: "project", projectId: "tide", cwd: "/repo/tide" },
      launchOptions: { model: "GPT-5.5 High", permission: "workspace-write" },
    },
  });
  const hydrated = applyAgentChatBackendEvent(
    state,
    backendEvent("thread.hydrated", {
      thread: {
        ...thread,
        agentBinding: {
          agentId: "antigravity",
          runtimeSource: { kind: "provider_cli", integrationId: "antigravity" },
        },
      },
      blocks: [],
      runtimeState: "idle",
    }),
  );
  const view = createAgentChatShellViewModel(hydrated);

  assert.equal(view.composer.modelLabel, "Default");
  assert.equal(view.composer.permissionLabel, "Ask for approval");
});

test("permission_menu_renders_only_the_selected_agent_provider_values", () => {
  const codexHtml = renderShell(
    setComposerActiveSurface(createAgentChatShellState(), "permission_menu").state,
  );
  const claudeHtml = renderShell(
    setComposerActiveSurface(
      selectComposerAgent(createAgentChatShellState(), "claude").state,
      "permission_menu",
    ).state,
  );
  const antigravityHtml = renderShell(
    setComposerActiveSurface(
      selectComposerAgent(createAgentChatShellState(), "antigravity").state,
      "permission_menu",
    ).state,
  );
  const openAiHtml = renderShell(
    setComposerActiveSurface(
      selectComposerAgent(createAgentChatShellState(), "openai_api").state,
      "permission_menu",
    ).state,
  );

  // Codex mirrors the Codex app's 3 friendly approval modes (not raw CLI flags).
  assert.match(codexHtml, /Approve for me/);
  assert.match(codexHtml, /Full access/);
  assert.doesNotMatch(codexHtml, /Accept edits/);
  assert.doesNotMatch(codexHtml, /workspace-write/);
  // Claude mirrors the Claude app's mode labels.
  assert.match(claudeHtml, /Accept edits/);
  assert.match(claudeHtml, /Bypass permissions/);
  assert.doesNotMatch(claudeHtml, /Approve for me/);
  // Antigravity uses the same friendly shape.
  assert.match(antigravityHtml, /Sandbox/);
  assert.match(antigravityHtml, /Bypass permissions/);
  assert.doesNotMatch(antigravityHtml, /Accept edits/);
  assert.match(openAiHtml, /Tide tool policy/);
  assert.doesNotMatch(openAiHtml, /workspace-write/);
  assert.doesNotMatch(openAiHtml, /Bypass permissions/);
});

test("composer_options_and_command_prefix_render_as_transient_choice_surfaces", () => {
  const optionsHtml = renderShell(
    setComposerActiveSurface(createAgentChatShellState(), "composer_options").state,
  );
  // Typing / shows the real provider commands injected for the cwd+agent.
  const slashHtml = renderShell({
    ...updateComposerDraft(createAgentChatShellState(), "/").state,
    availableCommands: [
      { name: "check", description: "Check repo evidence", trigger: "/" as const },
      { name: "work", description: "Run actionable work", trigger: "/" as const },
    ],
  });

  // The chip dropdown now renders as an anchored popover (fixed-position), so it
  // no longer needs to precede the composer in the DOM — just that it renders.
  assert.match(optionsHtml, /aria-label="Choice Surface"/);
  assert.match(optionsHtml, /chip-popover/);
  assert.match(optionsHtml, /Files and images/);
  assert.match(optionsHtml, /Current file or selection/);
  // Unwired context-attach rows are shown disabled (greyed), not as no-ops; the
  // placeholder "Agent tools" row was removed entirely.
  assert.match(optionsHtml, /choice-surface__row--disabled/);
  assert.doesNotMatch(optionsHtml, /Agent tools/);
  assert.doesNotMatch(optionsHtml, /This popover never shows/i);
  assert.match(slashHtml, /Commands/);
  assert.match(slashHtml, /\/check/);
  assert.match(slashHtml, /\/work/);
});

test("slash_menu_triggers_on_the_token_under_the_cursor_mid_message", () => {
  // The provider apps keep the command menu open while you type a trigger token
  // ANYWHERE in the message, not only as the first character. Tide used to open
  // it only when "/" was the very first char (start-anchored).
  const commands = [
    { name: "check", description: "Check repo evidence", trigger: "/" as const },
    { name: "work", description: "Run actionable work", trigger: "/" as const },
  ];

  // Mid-message "/" with a query opens the menu and filters to the match.
  const midTyped = {
    ...updateComposerDraft(createAgentChatShellState(), "explain /che").state,
    availableCommands: commands,
  };
  assert.equal(midTyped.composer.activeSurface, "command_suggestions");
  const midHtml = renderShell(midTyped);
  assert.match(midHtml, /\/check/);
  assert.doesNotMatch(midHtml, /\/work/);

  // Finishing the token (trailing space) closes the menu again.
  assert.equal(updateComposerDraft(midTyped, "explain /check ").state.composer.activeSurface, null);

  // A "/" inside a word/path (no leading boundary) does NOT open the menu.
  assert.equal(
    updateComposerDraft(createAgentChatShellState(), "look at src/app.ts").state.composer.activeSurface,
    null,
  );
});

test("picking_a_command_mid_message_splices_in_place_and_keeps_the_prefix", () => {
  const opened = {
    ...updateComposerDraft(createAgentChatShellState(), "explain /ch").state,
    availableCommands: [{ name: "check", description: "Check repo evidence", trigger: "/" as const }],
  };
  const picked = selectAgentChatChoiceSurfaceRow(opened, "command_suggestions", "command:/check").state;
  assert.equal(picked.composer.draft, "explain /check ");
  assert.equal(picked.composer.activeSurface, null);
});

test("claude_model_menu_lists_fable_5", () => {
  const claudeModelMenu = setComposerActiveSurface(
    selectComposerAgent(createAgentChatShellState(), "claude").state,
    "model_menu",
  ).state;
  assert.match(renderShell(claudeModelMenu), /Fable 5/);
});

test("openai_api_readiness_mentions_provider_account_not_hidden_pty", () => {
  const openAiState = selectComposerAgent(createAgentChatShellState(), "openai_api").state;
  const blocked = applyAgentChatBackendEvent(openAiState, {
    kind: "providerReadiness.changed",
    payload: {
      readiness: {
        agentId: "openai_api",
        ready: false,
        blockers: [
          {
            kind: "provider_account_required",
            scope: "provider_account",
            message: "Provider Account required: OpenAI API key.",
            action: "Open Provider Account setup",
          },
        ],
      },
    },
  });
  const html = renderShell(blocked);

  assert.match(html, /Provider Account required/);
  assert.match(html, /Open Provider Account setup/);
  assert.match(html, /preserve draft/);
  assert.doesNotMatch(html, /hidden PTY/i);
  assert.doesNotMatch(html, /Directory Trust/);
  assert.doesNotMatch(html, /provider CLI hooks/i);
});

test("composer_menu_rows_update_start_context_and_close_the_surface", () => {
  // The Project menu lists real injected projects (not a hardcoded set).
  const base: AgentChatShellState = {
    ...createAgentChatShellState(),
    availableProjects: [
      { projectId: "tide", name: "tide", cwd: "/Users/you/Workspace/tide" },
      { projectId: "slice", name: "slice", cwd: "/Users/you/Workspace/slice" },
    ],
  };
  const agentSelected = selectAgentChatChoiceSurfaceRow(
    setComposerActiveSurface(base, "agent_menu").state,
    "agent_menu",
    "claude",
  ).state;
  const projectSelected = selectAgentChatChoiceSurfaceRow(
    setComposerActiveSurface(agentSelected, "project_menu").state,
    "project_menu",
    "project:slice",
  ).state;
  const permissionSelected = selectAgentChatChoiceSurfaceRow(
    setComposerActiveSurface(projectSelected, "permission_menu").state,
    "permission_menu",
    "claude-accept",
  ).state;
  const html = renderShell(permissionSelected);

  assert.equal(permissionSelected.composer.activeSurface, null);
  assert.equal(permissionSelected.composer.startOptions.agentBinding.agentId, "claude");
  assert.deepEqual(permissionSelected.composer.startOptions.scope, {
    kind: "project",
    projectId: "slice",
    cwd: "/Users/you/Workspace/slice",
  });
  assert.equal(permissionSelected.composer.startOptions.launchOptions?.permission, "acceptEdits");
  assert.match(html, /Claude Code/);
  assert.match(html, /What should we build in slice/);
  assert.match(html, /composer-shell__chip-label">slice/);
  assert.doesNotMatch(html, /data-choice-surface/);
});

test("active provider-agent rows bind; the coming-soon row is an intentional no-op", () => {
  // Regression: every selectable agent row must actually bind its agent (the
  // opencode row was once rendered+enabled but composerAgentIdForRow lacked its
  // case, so it was a SILENT no-op). The active agents must bind...
  for (const agentId of ["codex", "claude", "gemini"] as const) {
    const opened = setComposerActiveSurface(createAgentChatShellState(), "agent_menu").state;
    const selected = selectAgentChatChoiceSurfaceRow(opened, "agent_menu", agentId).state;
    assert.equal(
      selected.composer.startOptions.agentBinding.agentId,
      agentId,
      `selecting the ${agentId} row should bind the thread to ${agentId}`,
    );
  }
  // ...and opencode is "Coming soon": its row is disabled, so selecting it must
  // leave the bound agent unchanged (an intentional no-op, not a missing mapping).
  const base = setComposerActiveSurface(createAgentChatShellState(), "agent_menu").state;
  const before = base.composer.startOptions.agentBinding.agentId;
  const afterOpencode = selectAgentChatChoiceSurfaceRow(base, "agent_menu", "opencode").state;
  assert.equal(
    afterOpencode.composer.startOptions.agentBinding.agentId,
    before,
    "selecting the coming-soon opencode row must not change the bound agent",
  );
});

test("project_menu_lists_real_injected_projects_not_a_hardcoded_set", () => {
  const base: AgentChatShellState = {
    ...createAgentChatShellState({
      startOptions: {
        agentBinding: { agentId: "codex" },
        scope: { kind: "project", projectId: "tide", cwd: "/Users/you/Workspace/tide" },
      },
    }),
    availableProjects: [
      { projectId: "tide", name: "tide", cwd: "/Users/you/Workspace/tide" },
      { projectId: "money", name: "money", cwd: "/Users/you/Workspace/money" },
    ],
  };
  const html = renderShell(setComposerActiveSurface(base, "project_menu").state);

  // Real projects appear; the old hardcoded "slice" placeholder does not.
  assert.match(html, /data-choice-surface="project_menu"/);
  assert.match(html, /money/);
  assert.match(html, /Scratch/);
  assert.match(html, /Open folder/);
  assert.doesNotMatch(html, /slice/);
  // Menu rows render lucide SVGs (semantic icon keys), not stray glyphs like □;
  // the literal "folder"/"check" key strings must not leak as text either.
  assert.match(html, /lucide-folder/);
  assert.match(html, /lucide-check/);
  assert.doesNotMatch(html, /□/);
  assert.doesNotMatch(html, /row-icon" aria-hidden="true">folder</);
});

test("branch_menu_lists_real_git_branches_not_placeholders", () => {
  // Spec: docs_v2/specs/git-backed-worktree-branch-menus.md UC-1
  const base: AgentChatShellState = {
    ...createAgentChatShellState(),
    availableBranches: [
      { name: "main", kind: "local", current: true },
      { name: "feature/x", kind: "local", current: false },
      { name: "origin/main", kind: "remote", current: false },
    ],
  };
  const html = renderShell(setComposerActiveSurface(base, "branch_menu").state);

  assert.match(html, /feature\/x/);
  assert.match(html, /origin\/main/);
  assert.match(html, /Create new branch/);
  // The old fabricated placeholders are gone.
  assert.doesNotMatch(html, /feature\/sidebar/);
  assert.doesNotMatch(html, /release\/2026-05/);
});

test("branch_menu_falls_back_to_current_value_when_no_git_data", () => {
  // Spec: docs_v2/specs/git-backed-worktree-branch-menus.md UC-3
  const html = renderShell(setComposerActiveSurface(createAgentChatShellState(), "branch_menu").state);
  assert.match(html, /Create new branch/);
  assert.doesNotMatch(html, /feature\/sidebar/);
  assert.doesNotMatch(html, /codex\/v2-shell/);
});

test("worktree_menu_lists_real_worktrees", () => {
  // Spec: docs_v2/specs/git-backed-worktree-branch-menus.md UC-2
  const base: AgentChatShellState = {
    ...createAgentChatShellState(),
    availableWorktrees: [
      { path: "/Users/you/Workspace/tide", branch: "main", current: true },
      { path: "/Users/you/Workspace/tide-wt", branch: "feature/x", current: false },
    ],
  };
  const html = renderShell(setComposerActiveSurface(base, "worktree_menu").state);
  assert.match(html, /current folder/);
  assert.match(html, /feature\/x/);
  assert.match(html, /New worktree/);
  assert.doesNotMatch(html, /existing worktree/);
});

test("open_provider_setup_row_dispatches_the_setup_surface_command", () => {
  // Spec: docs_v2/specs/provider-setup-surface-input-and-retry.md
  // Regression: the readiness surface rows were rendered without onRowSelect, so
  // "Open provider setup" was a dead click. Selecting it must emit the command.
  const blocked = applyBackendEventToAgentChatShell(
    applyBackendEventToAgentChatShell(
      createAgentChatShellState(),
      backendEvent("thread.hydrated", { thread, blocks: [], runtimeState: "idle" }),
    ),
    backendEvent("providerReadiness.changed", {
      readiness: {
        agentId: "codex",
        ready: false,
        blockers: [
          {
            kind: "directory_trust_required",
            scope: "execution_context",
            message: "Codex Directory Trust is required for this Execution Context.",
            setup: {
              command: "codex",
              args: ["--no-alt-screen"],
              cwd: "/Users/you/Workspace/tide",
              expectedCompletion: "retry_preflight",
            },
          },
        ],
      },
    }),
  );
  // The rendered surface wires onRowSelect (no longer a dead row).
  assert.match(renderShell(blocked), /Set up in the provider terminal/);

  const result = selectAgentChatChoiceSurfaceRow(
    blocked,
    "provider_readiness",
    "directory_trust_required:setup",
    "thread-shell",
  );
  assert.equal(result.command?.kind, "workbench.command");
  assert.equal(result.command?.payload.command, "open_provider_setup_surface");
});

test("opening_a_thread_shows_a_loading_skeleton_that_clears_even_with_zero_blocks", () => {
  // While a thread is hydrating (opened, blocks not back yet) the chat area shows a
  // skeleton instead of flashing blank.
  const opened = applyBackendEventToAgentChatShell(
    createAgentChatShellState(),
    backendEvent("thread.hydrated", { thread, blocks: [], runtimeState: "idle" }),
  );
  const loading = { ...opened, hydrating: true };
  assert.equal(createAgentChatShellViewModel(loading).chatState, "hydrating");
  assert.match(renderShell(loading), /agent-session-skeleton/);

  // The real hydrate returning — even with ZERO blocks (e.g. an agent that produced
  // nothing) — must clear the skeleton, not leave it spinning forever.
  const hydratedEmpty = applyBackendEventToAgentChatShell(
    loading,
    backendEvent("thread.hydrated", { thread, blocks: [], runtimeState: "idle" }),
  );
  assert.equal(createAgentChatShellViewModel(hydratedEmpty).chatState, "ready");
  assert.doesNotMatch(renderShell(hydratedEmpty), /agent-session-skeleton/);
});

test("a_loaded_thread_with_no_messages_shows_an_empty_placeholder", () => {
  // A hydrated, idle thread with zero blocks (e.g. an agent that produced nothing)
  // shows a friendly empty state instead of a blank void.
  const empty = applyBackendEventToAgentChatShell(
    createAgentChatShellState(),
    backendEvent("thread.hydrated", { thread, blocks: [], runtimeState: "idle" }),
  );
  assert.equal(createAgentChatShellViewModel(empty).chatState, "ready");
  const html = renderShell(empty);
  assert.match(html, /No messages here/);
  assert.doesNotMatch(html, /agent-session-skeleton/);
});

test("a_submitted_message_hides_the_empty_placeholder_even_before_its_block_arrives", () => {
  // The moment a message is submitted it shows as the optimistic "You" row while the
  // real user block is still in flight (blocks stays empty for a beat). The "No
  // messages here" placeholder must NOT render alongside that row — they contradict.
  const opened = applyBackendEventToAgentChatShell(
    createAgentChatShellState(),
    backendEvent("thread.hydrated", { thread, blocks: [], runtimeState: "idle" }),
  );
  const submitted = submitComposer(updateComposerDraft(opened, "do the thing").state).state;

  assert.deepEqual(submitted.queuedInputs, ["do the thing"]);
  const html = renderShell(submitted);
  assert.doesNotMatch(html, /No messages here/);
  assert.match(html, /do the thing/);
});

test("prompt_choice_surface_row_emits_prompt_answer", () => {
  const withPrompt = applyBackendEventToAgentChatShell(
    applyBackendEventToAgentChatShell(
      createAgentChatShellState(),
      backendEvent("thread.hydrated", {
        thread,
        blocks: [],
        runtimeState: "waiting_for_approval",
      }),
    ),
    backendEvent("prompt.changed", {
      threadId: "thread-shell",
      prompt,
    }),
  );

  const result = selectAgentChatChoiceSurfaceRow(withPrompt, "prompt_state", "allow-once");

  assert.deepEqual(result.command, {
    kind: "prompt.answer",
    payload: {
      threadId: "thread-shell",
      promptId: "prompt-approval",
      choiceId: "allow-once",
      value: "allow_once",
    },
  });
  assert.equal(result.state.promptState, null);
});

function renderShell(state: AgentChatShellState): string {
  return renderToStaticMarkup(
    createElement(AgentChatShell, {
      viewModel: createAgentChatShellViewModel(state),
    }),
  );
}

function backendEvent<TKind extends BackendEventKind>(
  kind: TKind,
  payload: BackendEventPayloadByKind[TKind],
): BackendEventEnvelope<TKind> {
  return {
    contractVersion: CONTRACT_VERSION,
    eventId: `evt-${kind}`,
    kind,
    emittedAt: later,
    payload,
  };
}

const thread: ThreadSummaryDto = {
  threadId: "thread-shell",
  title: "Desktop shell",
  agentBinding: { agentId: "codex" },
  scope: { kind: "project", projectId: "project-tide", cwd: "/repo/tide" },
  createdAt: now,
  updatedAt: now,
  pinned: false,
  archived: false,
  lastKnownState: "idle",
};

const prompt: PromptStateDto = {
  promptId: "prompt-approval",
  threadId: "thread-shell",
  agentId: "codex",
  kind: "approval",
  message: "Allow command?",
  source: "provider_signal",
  choices: [
    {
      choiceId: "allow-once",
      label: "Allow once",
      providerValue: "allow_once",
    },
  ],
};

const providerReadiness: ProviderReadinessDto = {
  agentId: "codex",
  ready: false,
  blockers: [
    {
      kind: "directory_trust_required",
      scope: "execution_context",
      message: "Directory Trust is required.",
      action: "open_terminal",
      setup: {
        command: "/usr/local/bin/codex",
        args: [],
        cwd: "/repo",
        expectedCompletion: "retry_preflight",
      },
    },
  ],
};

function block(
  blockId: string,
  status: AgentSessionBlockDto["status"],
  body: string,
): AgentSessionBlockDto {
  return {
    blockId,
    threadId: "thread-shell",
    agentId: "codex",
    kind: "agent_message",
    role: "agent",
    status,
    body,
    updatedAt: later,
  };
}

function browserPane(paneId: string): WorkbenchPaneRefDto {
  return {
    paneId,
    kind: "browser",
    title: "Local preview",
    visible: true,
    revision: "rev-1",
    updatedAt: later,
    url: "http://localhost:3000",
    loading: false,
  };
}

function findSourceMentions(roots: string[], pattern: RegExp): string[] {
  const repoRoot = repoRootPath();
  const matches: string[] = [];

  for (const root of roots) {
    const absoluteRoot = path.join(repoRoot, root);
    if (!fs.existsSync(absoluteRoot)) {
      continue;
    }

    for (const file of walkSourceFiles(absoluteRoot)) {
      const source = fs.readFileSync(file, "utf8");
      if (pattern.test(source)) {
        matches.push(path.relative(repoRoot, file));
      }
    }
  }

  return matches.sort();
}

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRootPath(), relativePath), "utf8");
}

function repoRootPath(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function walkSourceFiles(root: string): string[] {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkSourceFiles(fullPath));
    } else if (entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

test("hydrating seeds the queue from the backend snapshot (authoritative)", () => {
  // On open/switch, the renderer takes the backend's real queue verbatim — it does
  // not guess from blocks. The backend already dropped any messages that ran while
  // away, so the snapshot's queuedInputs is exactly what to show.
  const withQueued: AgentChatShellState = {
    ...createAgentChatShellState(),
    thread,
    runtimeState: "running",
    queuedInputs: ["stale optimistic"],
  };

  const hydrated = applyAgentChatBackendEvent(
    withQueued,
    backendEvent("thread.hydrated", {
      thread: { ...thread, queuedInputs: ["still pending"] },
      blocks: [],
      runtimeState: "running",
    }),
  );

  assert.deepEqual(hydrated.queuedInputs, ["still pending"]);
});
