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
  submitComposer,
  updateComposerDraft,
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
  assert.deepEqual(command?.payload, {
    initialMessage: "Build the Desktop shell",
    agentBinding: { agentId: "codex" },
    scope: { kind: "project", projectId: "project-tide", cwd: "/repo/tide" },
    launchOptions: {
      model: "GPT-5.5 High",
      permission: "Auto-review",
      worktree: "current folder",
      branch: "main",
    },
  });
});

test("sending_an_empty_start_composer_draft_emits_no_command", () => {
  const state = updateComposerDraft(createAgentChatShellState(), "   ").state;
  const result = submitComposer(state);

  assert.equal(result.command, null);
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
  assert.deepEqual(command?.payload, {
    threadId: "thread-shell",
    input: "Continue this Thread",
  });
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

test("follow_up_shell_displays_thread_context_without_inline_edit_controls", () => {
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
  assert.deepEqual(
    view.composer.contextItems.map((item) => item.label),
    ["Agent", "Project"],
  );
  assert.match(renderShell(state), /Codex CLI/);
  assert.doesNotMatch(renderShell(state), /name="agent"/);
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
  assert.doesNotMatch(source, /"agentRuntime\.stop"/);
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
  assert.match(openAiHtml, /from Tide API runtime/);
  assert.doesNotMatch(openAiHtml, /Codex Agent Integration/);
});

test("codex_model_chip_renders_polished_label_but_stores_provider_native_value", () => {
  // Spec: docs_v2/specs/composer-agent-runtime-source.md
  const withModelMenu = setComposerActiveSurface(
    createAgentChatShellState(),
    "model_menu",
  ).state;
  const selected = selectAgentChatChoiceSurfaceRow(
    withModelMenu,
    "model_menu",
    "gpt-55-high",
  ).state;
  const view = createAgentChatShellViewModel(selected);

  assert.equal(selected.composer.startOptions.launchOptions?.model, "gpt-5.5");
  assert.equal(view.composer.modelLabel, "GPT-5.5 High");
});

test("selecting_antigravity_updates_visible_model_and_permission_defaults_away_from_codex_gpt", () => {
  const selected = selectComposerAgent(createAgentChatShellState(), "antigravity").state;
  const view = createAgentChatShellViewModel(selected);

  assert.equal(selected.composer.startOptions.agentBinding.agentId, "antigravity");
  assert.equal(selected.composer.startOptions.agentBinding.runtimeSource?.kind, "provider_cli");
  assert.equal(view.composer.modelLabel, "Antigravity default");
  assert.equal(view.composer.permissionLabel, "default");
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
  assert.equal(view.composer.modelLabel, "Antigravity default");
  assert.equal(view.composer.permissionLabel, "default");
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

  assert.equal(view.composer.modelLabel, "Antigravity default");
  assert.equal(view.composer.permissionLabel, "default");
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

  assert.match(codexHtml, /workspace-write/);
  assert.match(codexHtml, /on-request/);
  assert.doesNotMatch(codexHtml, /acceptEdits/);
  assert.doesNotMatch(codexHtml, /dangerously-skip-permissions/);
  assert.match(claudeHtml, /acceptEdits/);
  assert.match(claudeHtml, /bypassPermissions/);
  assert.doesNotMatch(claudeHtml, /workspace-write/);
  assert.match(antigravityHtml, /sandbox/);
  assert.match(antigravityHtml, /dangerously-skip-permissions/);
  assert.doesNotMatch(antigravityHtml, /acceptEdits/);
  assert.match(openAiHtml, /Tide tool policy/);
  assert.match(openAiHtml, /Tide API/);
  assert.doesNotMatch(openAiHtml, /workspace-write/);
  assert.doesNotMatch(openAiHtml, /bypassPermissions/);
});

test("composer_options_and_command_prefix_render_as_transient_choice_surfaces", () => {
  const optionsHtml = renderShell(
    setComposerActiveSurface(createAgentChatShellState(), "composer_options").state,
  );
  const slashHtml = renderShell(updateComposerDraft(createAgentChatShellState(), "/").state);

  assert.ok(optionsHtml.indexOf('aria-label="Choice Surface"') < optionsHtml.indexOf('aria-label="Composer"'));
  assert.match(optionsHtml, /Files and images/);
  assert.match(optionsHtml, /Current file or selection/);
  assert.match(optionsHtml, /Agent tools/);
  assert.doesNotMatch(optionsHtml, /This popover never shows/i);
  assert.ok(slashHtml.indexOf("Command suggestions") < slashHtml.indexOf('aria-label="Composer"'));
  assert.match(slashHtml, /Code review/);
  assert.match(slashHtml, /Context mention/);
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
  const agentSelected = selectAgentChatChoiceSurfaceRow(
    setComposerActiveSurface(createAgentChatShellState(), "agent_menu").state,
    "agent_menu",
    "openai-api",
  ).state;
  const projectSelected = selectAgentChatChoiceSurfaceRow(
    setComposerActiveSurface(agentSelected, "project_menu").state,
    "project_menu",
    "project-slice",
  ).state;
  const permissionSelected = selectAgentChatChoiceSurfaceRow(
    setComposerActiveSurface(projectSelected, "permission_menu").state,
    "permission_menu",
    "tide-ask-first",
  ).state;
  const html = renderShell(permissionSelected);

  assert.equal(permissionSelected.composer.activeSurface, null);
  assert.equal(permissionSelected.composer.startOptions.agentBinding.agentId, "openai_api");
  assert.deepEqual(permissionSelected.composer.startOptions.scope, {
    kind: "project",
    projectId: "slice",
    cwd: "/Users/eatnug/Workspace/slice",
  });
  assert.equal(permissionSelected.composer.startOptions.launchOptions?.permission, "Ask before tools");
  assert.match(html, /OpenAI API/);
  assert.match(html, /What should we build in slice/);
  assert.match(html, /composer-shell__chip-label">slice/);
  assert.doesNotMatch(html, /data-choice-surface/);
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
