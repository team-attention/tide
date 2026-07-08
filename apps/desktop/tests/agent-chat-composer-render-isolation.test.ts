// Spec: docs_v2/specs/agent-chat-composer-render-isolation.md

import assert from "node:assert/strict";
import test from "node:test";

import {
  createAgentChatShellState,
  createAgentChatShellViewModel,
  updateComposerDraft,
  type AgentChatBlock,
  type AgentChatShellState,
  type AgentChatThreadSummary,
} from "../src/desktop/application/domains/agent-chat/agent-chat.ts";
import {
  createProductShellState,
  selectAgentChatViewModel,
  updateProductShellComposerDraft,
  type ProductShellState,
} from "../src/desktop/application/domains/product-shell/product-shell.ts";

function threadSummary(threadId = "thread-long"): AgentChatThreadSummary {
  return {
    threadId,
    title: "Long Thread",
    agentBinding: { agentId: "codex" },
    scope: { kind: "project", projectId: "tide", cwd: "/repo/tide" },
    createdAt: "2026-07-08T00:00:00.000Z",
    updatedAt: "2026-07-08T00:00:00.000Z",
    pinned: false,
    archived: false,
    lastKnownState: "idle",
  };
}

function block(blockId: string, index: number): AgentChatBlock {
  return {
    blockId,
    threadId: "thread-long",
    kind: index % 3 === 0 ? "tool_call" : index % 2 === 0 ? "agent_message" : "user_message",
    role: index % 3 === 0 ? "tool" : index % 2 === 0 ? "agent" : "user",
    status: "complete",
    title: index % 3 === 0 ? "Bash" : undefined,
    body: `block body ${index}`,
    updatedAt: "2026-07-08T00:00:00.000Z",
  };
}

function longThreadState(count = 750): AgentChatShellState {
  return {
    ...createAgentChatShellState(),
    thread: threadSummary(),
    runtimeState: "idle",
    blocks: Array.from({ length: count }, (_, index) => block(`block-${index}`, index)),
  };
}

test("draft-only updates preserve the long-thread block view reference", () => {
  const state = longThreadState();
  const before = createAgentChatShellViewModel(state);

  const afterState = updateComposerDraft(state, "typing in a long thread").state;
  const after = createAgentChatShellViewModel(afterState);

  assert.equal(after.composer.draft, "typing in a long thread");
  assert.equal(after.blocks, before.blocks);
  assert.equal(after.blocks[0], before.blocks[0]);
  assert.equal(after.blocks[after.blocks.length - 1], before.blocks[before.blocks.length - 1]);
});

test("source block updates invalidate only the changed block view", () => {
  const state = longThreadState(12);
  const before = createAgentChatShellViewModel(state);
  const changedBlock = { ...state.blocks[5], body: "updated body" };
  const after = createAgentChatShellViewModel({
    ...state,
    blocks: state.blocks.map((candidate) =>
      candidate.blockId === changedBlock.blockId ? changedBlock : candidate,
    ),
  });

  assert.notEqual(after.blocks, before.blocks);
  assert.equal(after.blocks[0], before.blocks[0]);
  assert.notEqual(after.blocks[5], before.blocks[5]);
  assert.equal(after.blocks[5].body, "updated body");
});

test("product-shell draft updates preserve the nested agent-chat block view reference", () => {
  const baseShell = createProductShellState({ includeFixtureData: false });
  const state: ProductShellState = {
    ...baseShell,
    agentChat: longThreadState(),
  };
  const before = selectAgentChatViewModel(state);
  const afterState = updateProductShellComposerDraft(state, "typing through product shell");
  const after = selectAgentChatViewModel(afterState);

  assert.notEqual(after, before);
  assert.equal(after.composer.draft, "typing through product shell");
  assert.equal(after.blocks, before.blocks);
});
