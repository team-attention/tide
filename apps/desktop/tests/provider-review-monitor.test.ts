import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { workbenchSnapshotPaneRef } from "../src/backend/application/services/workbench/workbench-snapshot.ts";
import type { ReviewPaneState } from "../src/backend/application/domains/workbench/workbench.ts";
import { AgentMonitorPanel } from "../src/desktop/adapters/inbound/react-renderer/product-shell/agent-monitor-panel.tsx";
import type { ProductShellHandlers } from "../src/desktop/adapters/inbound/react-renderer/product-shell/support/types.ts";
import {
  applyProductShellBackendEvent,
  answerProductShellMonitorPromptChoice,
  createProductShellState,
  createProductShellViewModel,
  setProductShellListSettings,
  toAgentChatThreadSummary,
} from "../src/desktop/application/domains/product-shell/product-shell.ts";
import type { ProductShellAgentMonitorSession } from "../src/desktop/application/domains/product-shell/product-shell.ts";
import type { AgentChatPromptState, AgentChatThreadSummary } from "../src/desktop/application/domains/agent-chat/agent-chat.ts";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
(globalThis as unknown as { window: unknown }).window = dom.window;
(globalThis as unknown as { document: unknown }).document = dom.window.document;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test("review pane snapshots carry cwd and provider agent", () => {
  const pane: ReviewPaneState = {
    paneId: "pane-review",
    kind: "review",
    title: "Review",
    revision: "rev-1",
    updatedAt: "2026-07-04T00:00:00.000Z",
    cwd: "/repo/tide",
    agentId: "codex",
  };

  const ref = workbenchSnapshotPaneRef(pane);

  assert.equal(ref.kind, "review");
  assert.equal(ref.cwd, "/repo/tide");
  assert.equal(ref.agentId, "codex");
});

test("agent monitor sessions derive needs-attention state from background runtime events", () => {
  const listed = applyProductShellBackendEvent(createProductShellState({ includeFixtureData: false }), {
    kind: "thread.listed",
    payload: { threads: [threadSummary()] },
  });
  const waiting = applyProductShellBackendEvent(listed, {
    kind: "agentRuntime.stateChanged",
    payload: {
      threadId: "thread-review",
      state: "waiting_for_approval",
      changedAt: "2026-07-04T00:03:00.000Z",
      queuedInputs: ["fix the review finding"],
    },
  });
  const prompted = applyProductShellBackendEvent(waiting, {
    kind: "prompt.changed",
    payload: { threadId: "thread-review", prompt: approvalPrompt() },
  });

  const view = createProductShellViewModel(prompted);

  assert.equal(view.agentMonitorSessions.length, 1);
  assert.equal(view.agentMonitorSessions[0]?.threadId, "thread-review");
  assert.equal(view.agentMonitorSessions[0]?.state, "waiting_for_approval");
  assert.equal(view.agentMonitorSessions[0]?.pendingPromptKind, "approval");
  assert.equal(view.agentMonitorSessions[0]?.prompt?.promptId, "prompt-review");
  assert.deepEqual(
    view.agentMonitorSessions[0]?.prompt?.choices.map((choice) => `${choice.choiceId}:${choice.label}`),
    ["allow:Allow", "deny:Deny"],
  );
  assert.equal(view.agentMonitorSessions[0]?.queuedInputCount, 1);
  assert.equal(view.agentMonitorSessions[0]?.cwd, "/repo/tide");
});

test("agent monitor shows provider-owned external sessions only when enabled", () => {
  const listed = applyProductShellBackendEvent(createProductShellState({ includeFixtureData: false }), {
    kind: "thread.listed",
    payload: { threads: [adoptedThreadSummary()] },
  });

  const hidden = createProductShellViewModel(listed);
  assert.deepEqual(hidden.agentMonitorSessions.map((session) => session.threadId), []);

  const shown = createProductShellViewModel(
    setProductShellListSettings(listed, { showExternalSessions: true }),
  );
  assert.equal(shown.agentMonitorSessions.length, 1);
  assert.equal(shown.agentMonitorSessions[0]?.threadId, "adopted-claude-session-1");
  assert.equal(shown.agentMonitorSessions[0]?.state, "idle");
  assert.equal(shown.agentMonitorSessions[0]?.providerOwned, true);
  assert.equal(shown.agentMonitorSessions[0]?.providerSessionRef, "claude-session-1");
});

test("provider-owned thread summaries preserve provider session refs", () => {
  const listed = applyProductShellBackendEvent(createProductShellState({ includeFixtureData: false }), {
    kind: "thread.listed",
    payload: { threads: [adoptedThreadSummary()] },
  });
  const thread = listed.threads.find((candidate) => candidate.threadId === "adopted-claude-session-1");

  assert.notEqual(thread, undefined);
  assert.equal(thread?.providerSessionRef?.kind, "claude_transcript");
  assert.equal(thread?.providerSessionRef?.value, "claude-session-1");

  const summary = toAgentChatThreadSummary(thread!);
  assert.deepEqual(summary.agentBinding.providerSessionRef, {
    kind: "claude_transcript",
    value: "claude-session-1",
    transcriptPath: "/repo/.claude/projects/repo/claude-session-1.jsonl",
  });
});

test("agent monitor prompt snapshots answer background choices by thread id", () => {
  const listed = applyProductShellBackendEvent(createProductShellState({ includeFixtureData: false }), {
    kind: "thread.listed",
    payload: { threads: [threadSummary()] },
  });
  const prompted = applyProductShellBackendEvent(listed, {
    kind: "prompt.changed",
    payload: { threadId: "thread-review", prompt: approvalPrompt() },
  });
  const session = createProductShellViewModel(prompted).agentMonitorSessions[0];
  const choice = session?.prompt?.choices.find((candidate) => candidate.choiceId === "allow");

  assert.notEqual(choice, undefined);
  const answered = answerProductShellMonitorPromptChoice(prompted, {
    threadId: "thread-review",
    promptId: "prompt-review",
    choice: choice!,
  });

  assert.deepEqual(answered.command, {
    kind: "prompt.answer",
    payload: {
      threadId: "thread-review",
      promptId: "prompt-review",
      choiceId: "allow",
      value: "yes",
    },
  });
  assert.equal(answered.state.runtimeSnapshotsByThreadId["thread-review"]?.state, "running");
  assert.equal(answered.state.runtimeSnapshotsByThreadId["thread-review"]?.pendingPromptKind, undefined);
  assert.equal(answered.state.runtimeSnapshotsByThreadId["thread-review"]?.prompt, undefined);
});

test("agent monitor snapshots preserve background activity without active-chat leakage", () => {
  const listed = applyProductShellBackendEvent(createProductShellState({ includeFixtureData: false }), {
    kind: "thread.listed",
    payload: { threads: [activeThreadSummary(), threadSummary()] },
  });
  const active = { ...listed, activeThreadId: "thread-active" };
  const running = applyProductShellBackendEvent(active, {
    kind: "agentRuntime.stateChanged",
    payload: {
      threadId: "thread-review",
      state: "running",
      changedAt: "2026-07-04T00:03:00.000Z",
      queuedInputs: ["follow-up review question"],
    },
  });
  const enriched = applyProductShellBackendEvent(running, {
    kind: "agentRuntime.activityChanged",
    payload: {
      threadId: "thread-review",
      activity: { planCompleted: 1, planTotal: 3 },
    },
  });

  assert.equal(enriched.agentChat.liveActivityEnrichment, undefined);
  assert.equal(enriched.runtimeSnapshotsByThreadId["thread-review"]?.state, "running");
  assert.equal(enriched.runtimeSnapshotsByThreadId["thread-review"]?.planCompleted, 1);
  assert.equal(enriched.runtimeSnapshotsByThreadId["thread-review"]?.planTotal, 3);

  const withoutBackgroundChat = {
    ...enriched,
    agentChatByThreadId: {},
  };
  const session = createProductShellViewModel(withoutBackgroundChat)
    .agentMonitorSessions.find((candidate) => candidate.threadId === "thread-review");

  assert.equal(session?.state, "running");
  assert.equal(session?.activityLabel, "1/3 steps");
  assert.equal(session?.planCompleted, 1);
  assert.equal(session?.planTotal, 3);
  assert.equal(session?.queuedInputCount, 1);
  assert.equal(session?.changedAt, "2026-07-04T00:03:00.000Z");
});

test("agent monitor runtime snapshots cover idle failed and queued transitions", () => {
  const listed = applyProductShellBackendEvent(createProductShellState({ includeFixtureData: false }), {
    kind: "thread.listed",
    payload: { threads: [threadSummary()] },
  });
  const running = applyProductShellBackendEvent(listed, {
    kind: "agentRuntime.stateChanged",
    payload: {
      threadId: "thread-review",
      state: "running",
      changedAt: "2026-07-04T00:03:00.000Z",
      queuedInputs: ["queued follow-up"],
    },
  });
  assert.equal(createProductShellViewModel(running).agentMonitorSessions[0]?.state, "running");
  assert.equal(createProductShellViewModel(running).agentMonitorSessions[0]?.queuedInputCount, 1);

  const waitingForInput = applyProductShellBackendEvent(running, {
    kind: "agentRuntime.stateChanged",
    payload: {
      threadId: "thread-review",
      state: "waiting_for_input",
      changedAt: "2026-07-04T00:03:30.000Z",
    },
  });
  assert.equal(createProductShellViewModel(waitingForInput).agentMonitorSessions[0]?.state, "waiting_for_input");

  const resumed = applyProductShellBackendEvent(waitingForInput, {
    kind: "agentRuntime.stateChanged",
    payload: {
      threadId: "thread-review",
      state: "running",
      changedAt: "2026-07-04T00:03:45.000Z",
    },
  });
  assert.equal(createProductShellViewModel(resumed).agentMonitorSessions[0]?.state, "running");

  const idle = applyProductShellBackendEvent(resumed, {
    kind: "agentRuntime.stateChanged",
    payload: {
      threadId: "thread-review",
      state: "idle",
      changedAt: "2026-07-04T00:04:00.000Z",
      queuedInputs: [],
    },
  });
  assert.equal(createProductShellViewModel(idle).agentMonitorSessions[0]?.state, "idle");
  assert.equal(createProductShellViewModel(idle).agentMonitorSessions[0]?.queuedInputCount, 0);

  const failed = applyProductShellBackendEvent(idle, {
    kind: "agentRuntime.stateChanged",
    payload: {
      threadId: "thread-review",
      state: "failed",
      changedAt: "2026-07-04T00:05:00.000Z",
    },
  });
  assert.equal(createProductShellViewModel(failed).agentMonitorSessions[0]?.state, "failed");
});

test("agent monitor renders multi-provider rows and queued input counts", async () => {
  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  const handlers = {
    onAgentMonitorToggle: () => undefined,
    onThreadSelect: () => undefined,
    onOpenThreadChanges: () => undefined,
    onInterrupt: () => undefined,
  } as Partial<ProductShellHandlers> as ProductShellHandlers;

  await act(async () => {
    root.render(
      createElement(AgentMonitorPanel, {
        sessions: [
          {
            threadId: "thread-codex",
            agentId: "codex",
            title: "Codex review",
            cwd: "/repo/codex",
            state: "waiting_for_input",
            queuedInputCount: 2,
            active: false,
          },
          {
            threadId: "thread-claude",
            agentId: "claude",
            title: "Claude fanout",
            cwd: "/repo/claude",
            state: "running",
            activityLabel: "3 agents, 5 tools",
            active: true,
          },
          {
            threadId: "thread-opencode",
            agentId: "opencode",
            title: "opencode plan",
            cwd: "/repo/opencode",
            state: "idle",
            providerOwned: true,
            active: false,
          },
        ] satisfies ProductShellAgentMonitorSession[],
        handlers,
      }),
    );
  });

  const text = container.textContent ?? "";
  assert.match(text, /Needs You/);
  assert.match(text, /Running/);
  assert.match(text, /Idle \/ Stopped/);
  assert.match(text, /Codex/);
  assert.match(text, /2 queued/);
  assert.match(text, /Claude/);
  assert.match(text, /3 agents, 5 tools/);
  assert.match(text, /opencode/);
  assert.match(text, /provider-owned/);

  await act(async () => {
    root.unmount();
  });
});

test("agent monitor row actions target the selected thread and active runtime", async () => {
  let selectedThreadId: string | null = null;
  let openedThreadId: string | null = null;
  let interrupted = false;
  let answeredPrompt: { threadId: string; promptId: string; value: string } | null = null;
  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  const handlers = {
    onAgentMonitorToggle: () => undefined,
    onThreadSelect: (threadId: string) => {
      selectedThreadId = threadId;
    },
    onOpenThreadChanges: (threadId: string) => {
      openedThreadId = threadId;
    },
    onInterrupt: () => {
      interrupted = true;
    },
    onAnswerMonitorPromptChoice: (threadId, promptId, choice) => {
      answeredPrompt = { threadId, promptId, value: choice.providerValue };
    },
  } as Partial<ProductShellHandlers> as ProductShellHandlers;

  await act(async () => {
    root.render(
      createElement(AgentMonitorPanel, {
        sessions: [
          {
            threadId: "thread-review",
            agentId: "codex",
            title: "Review handoff",
            cwd: "/repo/tide",
            state: "running",
            active: true,
            providerOwned: true,
            pendingPromptKind: "approval",
            prompt: {
              promptId: "prompt-review",
              kind: "approval",
              message: "Approve git command?",
              choices: [
                { choiceId: "allow", label: "Allow", providerValue: "yes", kind: "allow_once" },
              ],
            },
          } satisfies ProductShellAgentMonitorSession,
        ],
        handlers,
      }),
    );
  });
  const focusButton = container.querySelector('button[aria-label="Focus thread"]') as HTMLButtonElement | null;
  const changesButton = container.querySelector('button[aria-label="Open changes"]') as HTMLButtonElement | null;
  const stopButton = container.querySelector('button[aria-label="Stop active agent"]') as HTMLButtonElement | null;
  const allowButton = container.querySelector('button[aria-label="Answer Allow"]') as HTMLButtonElement | null;
  assert.notEqual(focusButton, null);
  assert.notEqual(changesButton, null);
  assert.notEqual(stopButton, null);
  assert.notEqual(allowButton, null);
  assert.match(container.textContent ?? "", /provider-owned/);

  await act(async () => {
    focusButton?.click();
    changesButton?.click();
    allowButton?.click();
    stopButton?.click();
  });
  await act(async () => {
    root.unmount();
  });

  assert.equal(selectedThreadId, "thread-review");
  assert.equal(openedThreadId, "thread-review");
  assert.deepEqual(answeredPrompt, { threadId: "thread-review", promptId: "prompt-review", value: "yes" });
  assert.equal(interrupted, true);
});

function threadSummary(): AgentChatThreadSummary {
  return {
    threadId: "thread-review",
    title: "Review handoff",
    agentBinding: { agentId: "codex" },
    scope: { kind: "project", projectId: "tide", cwd: "/repo/tide" },
    createdAt: "2026-07-04T00:00:00.000Z",
    updatedAt: "2026-07-04T00:02:00.000Z",
    pinned: false,
    archived: false,
    lastKnownState: "idle",
    live: true,
    runtimeStartedAt: "2026-07-04T00:01:00.000Z",
  };
}

function activeThreadSummary(): AgentChatThreadSummary {
  return {
    threadId: "thread-active",
    title: "Active handoff",
    agentBinding: { agentId: "codex" },
    scope: { kind: "project", projectId: "active", cwd: "/repo/active" },
    createdAt: "2026-07-04T00:00:00.000Z",
    updatedAt: "2026-07-04T00:02:00.000Z",
    pinned: false,
    archived: false,
    lastKnownState: "idle",
    live: true,
    runtimeStartedAt: "2026-07-04T00:01:00.000Z",
  };
}

function adoptedThreadSummary(): AgentChatThreadSummary {
  return {
    threadId: "adopted-claude-session-1",
    title: "Imported Claude session",
    agentBinding: {
      agentId: "claude",
      providerSessionRef: {
        kind: "claude_transcript",
        value: "claude-session-1",
        transcriptPath: "/repo/.claude/projects/repo/claude-session-1.jsonl",
      },
    },
    scope: { kind: "project", projectId: "tide", cwd: "/repo/tide" },
    createdAt: "2026-07-04T00:00:00.000Z",
    updatedAt: "2026-07-04T00:02:00.000Z",
    pinned: false,
    archived: false,
    lastKnownState: "idle",
  };
}

function approvalPrompt(): AgentChatPromptState {
  return {
    promptId: "prompt-review",
    threadId: "thread-review",
    agentId: "codex",
    kind: "approval",
    message: "Approve git command?",
    choices: [
      { choiceId: "allow", label: "Allow", providerValue: "yes", kind: "allow_once" },
      { choiceId: "deny", label: "Deny", providerValue: "no", kind: "reject_once" },
    ],
    defaultChoiceId: "deny",
    source: "provider_signal",
  };
}
