// Spec: live-turn-activity-visibility.md (Slice A). While a turn is running, the
// view-model summarizes in-flight tool/agent activity (block status pending/streaming)
// into liveActivity.summaryLabel, and the Working indicator appends it after the
// elapsed timer — so a long fan-out reads as alive, not hung.

import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  applyAgentChatBackendEvent,
  createAgentChatShellState,
  createAgentChatShellViewModel,
} from "../src/desktop/application/domains/agent-chat/agent-chat.ts";
import type {
  AgentChatBlock,
  AgentChatShellState,
  AgentChatThreadSummary,
  AgentRuntimeStateName,
} from "../src/desktop/application/domains/agent-chat/agent-chat.ts";
import { AgentWorkingIndicator } from "../src/desktop/adapters/inbound/react-renderer/agent-chat/transcript/working-indicator.tsx";

function toolBlock(
  blockId: string,
  title: string,
  status: AgentChatBlock["status"],
  kind = "tool_call",
): AgentChatBlock {
  return {
    blockId,
    threadId: "t1",
    kind,
    role: "tool",
    status,
    title,
    updatedAt: "2026-06-23T00:00:00.000Z",
  };
}

function runningViewModel(blocks: AgentChatBlock[], runtimeState: AgentRuntimeStateName = "running") {
  const state: AgentChatShellState = {
    ...createAgentChatShellState(),
    runtimeState,
    blocks,
  };
  return createAgentChatShellViewModel(state);
}

function threadSummary(threadId: string): AgentChatThreadSummary {
  return {
    threadId,
    title: threadId,
    agentBinding: { agentId: "claude" },
    scope: { kind: "project", projectId: "p1", cwd: "/tmp/project" },
    createdAt: "2026-06-23T00:00:00.000Z",
    updatedAt: "2026-06-23T00:00:00.000Z",
    pinned: false,
    archived: false,
    lastKnownState: "running",
  };
}

test("A1: three in-flight Task tool calls summarize as '3 agents running'", () => {
  const vm = runningViewModel([
    toolBlock("b1", "Agent", "pending"),
    toolBlock("b2", "Agent", "pending"),
    toolBlock("b3", "Agent", "pending"),
  ]);
  assert.equal(vm.chatState, "running");
  assert.equal(vm.liveActivity?.summaryLabel, "3 agents running");
});

test("A2: a completed tool call is not counted in-flight", () => {
  const vm = runningViewModel([toolBlock("b1", "Agent", "complete")]);
  assert.equal(vm.liveActivity, undefined);
});

test("A3: no live activity when the turn is not running", () => {
  const vm = runningViewModel([toolBlock("b1", "Agent", "pending")], "idle");
  assert.notEqual(vm.chatState, "running");
  assert.equal(vm.liveActivity, undefined);
});

test("A5: a single in-flight non-agent tool shows its own title", () => {
  const vm = runningViewModel([toolBlock("b1", "WebSearch", "pending", "search")]);
  assert.equal(vm.liveActivity?.summaryLabel, "WebSearch");
});

test("A5b: multiple in-flight non-agent tools summarize as a count", () => {
  const vm = runningViewModel([
    toolBlock("b1", "WebSearch", "pending", "search"),
    toolBlock("b2", "Bash", "streaming", "command_run"),
  ]);
  assert.equal(vm.liveActivity?.summaryLabel, "2 tools running");
});

test("A4: the indicator appends the activity summary after the timer", () => {
  const markup = renderToStaticMarkup(
    <AgentWorkingIndicator liveActivitySummary="3 agents running" />,
  );
  assert.match(markup, /Working…/);
  assert.match(markup, /·\s*3 agents running/);
});

test("A4b: the indicator shows only the timer when there is no summary", () => {
  const markup = renderToStaticMarkup(<AgentWorkingIndicator />);
  assert.match(markup, /Working…/);
  assert.doesNotMatch(markup, /·/);
});

// ---- Slice B: nested subagent enrichment merged into the indicator ----

test("B-merge: nested counts win and read as 'N agents · M tool calls'", () => {
  const state: AgentChatShellState = {
    ...createAgentChatShellState(),
    runtimeState: "running",
    liveActivityEnrichment: { nestedAgents: 32, nestedToolCalls: 187 },
  };
  assert.equal(createAgentChatShellViewModel(state).liveActivity?.summaryLabel, "32 agents · 187 tool calls");
});

test("B-merge: a single agent with no tool calls yet reads as '1 agent running'", () => {
  const state: AgentChatShellState = {
    ...createAgentChatShellState(),
    runtimeState: "running",
    liveActivityEnrichment: { nestedAgents: 1, nestedToolCalls: 0 },
  };
  assert.equal(createAgentChatShellViewModel(state).liveActivity?.summaryLabel, "1 agent running");
});

test("B-merge: enrichment is ignored when the turn is not running", () => {
  const state: AgentChatShellState = {
    ...createAgentChatShellState(),
    runtimeState: "idle",
    liveActivityEnrichment: { nestedAgents: 5, nestedToolCalls: 9 },
  };
  assert.equal(createAgentChatShellViewModel(state).liveActivity, undefined);
});

test("B-reducer: activityChanged sets enrichment; an empty activity clears it", () => {
  const base = { ...createAgentChatShellState(), runtimeState: "running" as const };
  const set = applyAgentChatBackendEvent(base, {
    kind: "agentRuntime.activityChanged",
    payload: { threadId: "t1", activity: { nestedAgents: 3, nestedToolCalls: 12 } },
  });
  assert.deepEqual(set.liveActivityEnrichment, { nestedAgents: 3, nestedToolCalls: 12 });
  const cleared = applyAgentChatBackendEvent(set, {
    kind: "agentRuntime.activityChanged",
    payload: { threadId: "t1", activity: {} },
  });
  assert.equal(cleared.liveActivityEnrichment, undefined);
});

test("B-reducer: activityChanged tolerates a missing payload", () => {
  const base = {
    ...createAgentChatShellState(),
    runtimeState: "running" as const,
    liveActivityEnrichment: { nestedAgents: 3, nestedToolCalls: 12 },
  };
  const cleared = applyAgentChatBackendEvent(base, {
    kind: "agentRuntime.activityChanged",
    payload: undefined,
  });
  assert.equal(cleared.liveActivityEnrichment, undefined);
});

test("B'-merge: codex/ACP plan progress reads as 'done/total steps'", () => {
  const state: AgentChatShellState = {
    ...createAgentChatShellState(),
    runtimeState: "running",
    liveActivityEnrichment: { planTotal: 7, planCompleted: 3 },
  };
  assert.equal(createAgentChatShellViewModel(state).liveActivity?.summaryLabel, "3/7 steps");
});

test("B'-merge: nested agents win over plan when both are present", () => {
  const state: AgentChatShellState = {
    ...createAgentChatShellState(),
    runtimeState: "running",
    liveActivityEnrichment: { nestedAgents: 2, nestedToolCalls: 5, planTotal: 7, planCompleted: 3 },
  };
  assert.equal(createAgentChatShellViewModel(state).liveActivity?.summaryLabel, "2 agents · 5 tool calls");
});

test("B-reducer: leaving an active state drops the enrichment", () => {
  const running = {
    ...createAgentChatShellState(),
    runtimeState: "running" as const,
    liveActivityEnrichment: { nestedAgents: 4, nestedToolCalls: 8 },
  };
  const idle = applyAgentChatBackendEvent(running, {
    kind: "agentRuntime.stateChanged",
    payload: { state: "idle", changedAt: "2026-06-23T00:00:01.000Z" },
  });
  assert.equal(idle.liveActivityEnrichment, undefined);
});

test("B-reducer: hydrating a different thread drops stale enrichment", () => {
  const state: AgentChatShellState = {
    ...createAgentChatShellState(),
    thread: threadSummary("old-thread"),
    runtimeState: "running",
    liveActivityEnrichment: { nestedAgents: 4, nestedToolCalls: 8 },
  };
  const hydrated = applyAgentChatBackendEvent(state, {
    kind: "thread.hydrated",
    payload: {
      thread: threadSummary("new-thread"),
      blocks: [],
      runtimeState: "running",
    },
  });
  assert.equal(hydrated.liveActivityEnrichment, undefined);
});

test("B-reducer: starting a new thread drops stale enrichment", () => {
  const state: AgentChatShellState = {
    ...createAgentChatShellState(),
    thread: threadSummary("old-thread"),
    runtimeState: "running",
    liveActivityEnrichment: { nestedAgents: 4, nestedToolCalls: 8 },
  };
  const started = applyAgentChatBackendEvent(state, {
    kind: "thread.started",
    payload: {
      thread: threadSummary("new-thread"),
      runtimeState: "running",
    },
  });
  assert.equal(started.liveActivityEnrichment, undefined);
});
