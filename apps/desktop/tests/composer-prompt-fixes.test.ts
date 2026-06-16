import assert from "node:assert/strict";
import test from "node:test";

import {
  answerPromptText,
  createAgentChatShellState,
  selectAgentChatChoiceSurfaceRow,
  updateComposerDraft,
} from "../src/desktop/application/domains/agent-chat/agent-chat.ts";
import type { AgentChatPromptState, AgentChatShellState } from "../src/desktop/application/domains/agent-chat/state/types.ts";

// Spec: docs_v2/specs/composer-prompt-browser-fixes.md (issue 2: answering a prompt
// must NOT wipe what the user was typing in the composer).

const PROMPT: AgentChatPromptState = {
  promptId: "p-1",
  threadId: "t-1",
  agentId: "claude",
  kind: "choice",
  message: "Pick one",
  choices: [
    { choiceId: "a", label: "Option A", providerValue: "structured:option:Option A" },
    { choiceId: "b", label: "Option B", providerValue: "structured:option:Option B" },
  ],
  source: "provider_hook",
};

function stateWithPromptAndDraft(draft: string): AgentChatShellState {
  const base = createAgentChatShellState({
    startOptions: {
      agentBinding: { agentId: "claude" },
      scope: { kind: "project", projectId: "p", cwd: "/repo" },
      launchOptions: {},
    },
  });
  const drafted = updateComposerDraft(base, draft).state;
  return { ...drafted, promptState: PROMPT };
}

test("selecting a prompt choice answers it but keeps the in-progress composer draft", () => {
  const state = stateWithPromptAndDraft("a follow-up I was typing");
  const result = selectAgentChatChoiceSurfaceRow(state, "prompt_state", "a", "t-1");
  assert.equal(result.command?.kind, "prompt.answer");
  assert.equal(result.state.promptState, null, "the prompt is cleared");
  assert.equal(result.state.composer.draft, "a follow-up I was typing", "the draft survives");
});

test("answering a prompt via free text keeps the in-progress composer draft", () => {
  const state = stateWithPromptAndDraft("still here");
  const result = answerPromptText(state, "my custom reply");
  assert.equal(result.command?.kind, "prompt.answer");
  assert.equal(result.state.promptState, null);
  assert.equal(result.state.composer.draft, "still here", "the composer draft is not wiped by the card answer");
});
