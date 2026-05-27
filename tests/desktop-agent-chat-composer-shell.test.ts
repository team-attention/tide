// Spec: docs_v2/specs/desktop-agent-chat-composer-shell.md

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  createAgentChatShellState,
  createAgentChatShellViewModel,
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

test("composer_shell_command_adapter_does_not_claim_unsupported_backend_command_kinds", () => {
  const source = readRepoFile(
    "src/desktop/adapters/inbound/react-renderer/agent-chat-contract-adapter.ts",
  );

  assert.doesNotMatch(source, /BackendCommandKind/);
  assert.doesNotMatch(source, /as AgentChatBackendCommandDraft/);
  assert.match(source, /"thread\.start"/);
  assert.match(source, /"composer\.sendInput"/);
  assert.match(source, /"prompt\.answer"/);
  assert.doesNotMatch(source, /"agentRuntime\.stop"/);
  assert.doesNotMatch(source, /"workbench\.command"/);
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
