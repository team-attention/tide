// Spec: docs_v2/specs/multi-step-prompt-navigation.md — a multi-step prompt (claude
// AskUserQuestion's batched questions) renders as a navigable wizard: the user moves
// Back/Next, revises any earlier answer, and submits every answer together. A single
// prompt (every permission/approval, a 1-question AskUserQuestion) keeps the plain
// single card with Skip + Submit — the non-regression guard that also covers the other
// providers' (codex/opencode) single-card question interface.
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PromptCard } from "../src/desktop/adapters/inbound/react-renderer/agent-chat/prompt-card/prompt-card.tsx";
import type { AgentChatPromptState, AgentChatPromptStepAnswer } from "../src/desktop/application/domains/agent-chat/agent-chat.ts";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
(globalThis as unknown as { window: unknown }).window = dom.window;
(globalThis as unknown as { document: unknown }).document = dom.window.document;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function wizardPrompt(): AgentChatPromptState {
  return {
    promptId: "p1",
    threadId: "t1",
    agentId: "claude",
    kind: "choice",
    message: "Pick one?",
    choices: [
      { choiceId: "opt-A", label: "A", providerValue: "structured:option:A" },
      { choiceId: "opt-B", label: "B", providerValue: "structured:option:B" },
    ],
    defaultChoiceId: "opt-A",
    source: "provider_hook",
    steps: [
      {
        stepId: "q-0",
        message: "Pick one?",
        choices: [
          { choiceId: "opt-A", label: "A", providerValue: "structured:option:A" },
          { choiceId: "opt-B", label: "B", providerValue: "structured:option:B" },
        ],
        defaultChoiceId: "opt-A",
      },
      {
        stepId: "q-1",
        message: "Describe it?",
        choices: [
          { choiceId: "opt-C", label: "C", providerValue: "structured:option:C" },
          { choiceId: "opt-D", label: "D", providerValue: "structured:option:D" },
        ],
        defaultChoiceId: "opt-C",
      },
    ],
  };
}

function singlePrompt(): AgentChatPromptState {
  return {
    promptId: "p2",
    threadId: "t1",
    agentId: "codex",
    kind: "approval",
    message: "Run this command?",
    choices: [
      { choiceId: "approve", label: "Approve", providerValue: "structured:option:approve" },
      { choiceId: "deny", label: "Deny", providerValue: "structured:deny" },
    ],
    defaultChoiceId: "approve",
    source: "provider_signal",
  };
}

// A single (non-wizard) AskUserQuestion: kind "choice" with no steps → the plain card,
// which (unlike approval/permission) offers the per-answer note field.
function singleAuqPrompt(): AgentChatPromptState {
  return {
    promptId: "p3",
    threadId: "t1",
    agentId: "claude",
    kind: "choice",
    message: "Pick one?",
    choices: [
      { choiceId: "opt-A", label: "A", providerValue: "structured:option:A" },
      { choiceId: "opt-B", label: "B", providerValue: "structured:option:B" },
    ],
    defaultChoiceId: "opt-A",
    source: "provider_hook",
  };
}

function query<T extends Element>(container: Element, selector: string): T {
  const found = container.querySelector(selector);
  assert.ok(found !== null, `expected to find ${selector}`);
  return found as T;
}

function clickOptionByLabel(container: Element, label: string): void {
  const options = [...container.querySelectorAll(".prompt-card__option")];
  const target = options.find(
    (option) => option.querySelector(".prompt-card__option-label")?.textContent === label,
  );
  assert.ok(target !== undefined, `expected an option labeled "${label}"`);
  (target as HTMLButtonElement).click();
}

async function mountWizard(onAnswerSteps: (steps: AgentChatPromptStepAnswer[]) => void) {
  const { createRoot } = await import("react-dom/client");
  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <PromptCard
        prompt={wizardPrompt()}
        onSelectChoice={() => {}}
        onAnswerText={() => {}}
        onAnswerSteps={onAnswerSteps}
      />,
    );
  });
  return { container, root };
}

async function mountPrompt(prompt: AgentChatPromptState) {
  const { createRoot } = await import("react-dom/client");
  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <PromptCard
        prompt={prompt}
        onSelectChoice={() => {}}
        onAnswerText={() => {}}
        onAnswerSteps={() => {}}
      />,
    );
  });
  return { container, root };
}

test("AUQ single card: 'Other…' shows the custom-reply field instead of the note (one input, not two)", async () => {
  const { container, root } = await mountPrompt(singleAuqPrompt());
  try {
    // Default: a listed option is selected → the note field is offered, no custom-reply box yet.
    assert.ok(container.querySelector(".prompt-card__note") !== null, "note field shown for a selection");
    assert.ok(container.querySelector(".prompt-card__other") === null, "no custom-reply box before Other");

    // Pick "Other…": the custom-reply box appears and the note field is hidden — exactly one input,
    // not the two boxes (custom reply + note) stacked on top of each other.
    await act(async () => clickOptionByLabel(container, "Other…"));
    assert.ok(container.querySelector(".prompt-card__other") !== null, "custom-reply box shown for Other");
    assert.ok(
      container.querySelector(".prompt-card__note") === null,
      "note field hidden while Other is active (no second input box)",
    );
  } finally {
    await act(async () => root.unmount());
  }
});

test("wizard: Next/Back navigate, defaults submit one answer per step", async () => {
  const captured: AgentChatPromptStepAnswer[][] = [];
  const { container, root } = await mountWizard((steps) => captured.push(steps));
  try {
    // Step 1 of 2: Back disabled, primary action is "Next" (not Submit yet).
    assert.match(container.textContent ?? "", /1 of 2/);
    assert.equal(query<HTMLButtonElement>(container, ".prompt-card__skip").disabled, true);
    assert.match(query(container, ".prompt-card__submit").textContent ?? "", /Next/);
    assert.equal(container.querySelectorAll(".prompt-card__step-dot").length, 2);

    // Advance to the last step → Back enabled, primary becomes "Submit".
    await act(async () => query<HTMLButtonElement>(container, ".prompt-card__submit").click());
    assert.match(container.textContent ?? "", /2 of 2/);
    assert.equal(query<HTMLButtonElement>(container, ".prompt-card__skip").disabled, false);
    assert.match(query(container, ".prompt-card__submit").textContent ?? "", /Submit/);

    // Submit with each step left at its default option.
    await act(async () => query<HTMLButtonElement>(container, ".prompt-card__submit").click());
    assert.equal(captured.length, 1);
    assert.deepEqual(captured[0], [
      { stepId: "q-0", value: "structured:option:A" },
      { stepId: "q-1", value: "structured:option:C" },
    ]);
  } finally {
    await act(async () => root.unmount());
  }
});

test("wizard: going back to revise an earlier step changes only that step's answer", async () => {
  const captured: AgentChatPromptStepAnswer[][] = [];
  const { container, root } = await mountWizard((steps) => captured.push(steps));
  try {
    // Forward to step 2, then back to step 1 — the revisit must be possible.
    await act(async () => query<HTMLButtonElement>(container, ".prompt-card__submit").click());
    await act(async () => query<HTMLButtonElement>(container, ".prompt-card__skip").click());
    assert.match(container.textContent ?? "", /1 of 2/);

    // Revise step 1 from the default A → B.
    await act(async () => clickOptionByLabel(container, "B"));
    // Forward and submit.
    await act(async () => query<HTMLButtonElement>(container, ".prompt-card__submit").click());
    await act(async () => query<HTMLButtonElement>(container, ".prompt-card__submit").click());

    assert.equal(captured.length, 1);
    assert.deepEqual(captured[0], [
      { stepId: "q-0", value: "structured:option:B" }, // revised
      { stepId: "q-1", value: "structured:option:C" }, // untouched default
    ]);
  } finally {
    await act(async () => root.unmount());
  }
});

test("wizard: a step dot jumps directly to that step", async () => {
  const { container, root } = await mountWizard(() => {});
  try {
    const dots = [...container.querySelectorAll(".prompt-card__step-dot")] as HTMLButtonElement[];
    await act(async () => dots[1].click());
    assert.match(container.textContent ?? "", /2 of 2/);
    assert.match(container.textContent ?? "", /Describe it\?/);
  } finally {
    await act(async () => root.unmount());
  }
});

// --- ⌘N number-key selection (docs_v2/specs/prompt-card-number-key-selection.md) ---

interface Spy {
  calls: unknown[][];
  fn: (...args: unknown[]) => void;
}

function spy(): Spy {
  const calls: unknown[][] = [];
  return { calls, fn: (...args: unknown[]) => void calls.push(args) };
}

interface PromptSpies {
  onSelectChoice: Spy;
  onAnswerText: Spy;
}

function multiSelectPrompt(): AgentChatPromptState {
  return {
    promptId: "p4",
    threadId: "t1",
    agentId: "claude",
    kind: "choice",
    message: "Pick several?",
    multiSelect: true,
    choices: [
      { choiceId: "m-A", label: "MA", providerValue: "structured:option:MA" },
      { choiceId: "m-B", label: "MB", providerValue: "structured:option:MB" },
    ],
    source: "provider_hook",
  };
}

// Dispatch a ⌘+digit (or ⌘Enter) keydown on the window the prompt card listens on.
async function pressMeta(code: string): Promise<void> {
  await act(async () => {
    dom.window.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { code, key: code === "Enter" ? "Enter" : "", metaKey: true, bubbles: true }),
    );
  });
}

async function mountWithSpies(prompt: AgentChatPromptState) {
  const { createRoot } = await import("react-dom/client");
  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  const onSelectChoice = spy();
  const onAnswerText = spy();
  await act(async () => {
    root.render(
      <PromptCard
        prompt={prompt}
        onSelectChoice={onSelectChoice.fn}
        onAnswerText={onAnswerText.fn}
        onAnswerSteps={() => {}}
      />,
    );
  });
  const spies: PromptSpies = { onSelectChoice, onAnswerText };
  return { container, root, spies };
}

function optionByLabel(container: Element, label: string): Element {
  const options = [...container.querySelectorAll(".prompt-card__option")];
  const target = options.find(
    (option) => option.querySelector(".prompt-card__option-label")?.textContent === label,
  );
  assert.ok(target !== undefined, `expected an option labeled "${label}"`);
  return target;
}

test("⌘N selects the N-th option without submitting; ⌘Enter then confirms it", async () => {
  const { container, root, spies } = await mountWithSpies(singlePrompt());
  try {
    // Default-selected is the first option (Approve). ⌘2 moves selection to the 2nd (Deny).
    await pressMeta("Digit2");
    assert.equal(optionByLabel(container, "Deny").getAttribute("data-selected"), "true");
    assert.equal(optionByLabel(container, "Approve").getAttribute("data-selected"), "false");
    // Select-only: nothing committed yet.
    assert.equal(spies.onSelectChoice.calls.length, 0);

    // ⌘Enter confirms the highlighted option.
    await pressMeta("Enter");
    assert.deepEqual(spies.onSelectChoice.calls, [["deny"]]);
  } finally {
    await act(async () => root.unmount());
  }
});

test("⌘N on the trailing number activates the 'Other…' field without submitting", async () => {
  const { container, root, spies } = await mountWithSpies(singlePrompt());
  try {
    // 2 choices → "Other…" is option 3.
    await pressMeta("Digit3");
    assert.ok(container.querySelector(".prompt-card__other") !== null, "custom-reply field opened");
    assert.equal(spies.onSelectChoice.calls.length, 0);
    assert.equal(spies.onAnswerText.calls.length, 0);
  } finally {
    await act(async () => root.unmount());
  }
});

test("multi-select: ⌘1 toggles the first option on, then off, never submitting", async () => {
  const { container, root, spies } = await mountWithSpies(multiSelectPrompt());
  try {
    await pressMeta("Digit1");
    assert.equal(optionByLabel(container, "MA").getAttribute("data-selected"), "true");
    await pressMeta("Digit1");
    assert.equal(optionByLabel(container, "MA").getAttribute("data-selected"), "false");
    assert.equal(spies.onAnswerText.calls.length, 0);
  } finally {
    await act(async () => root.unmount());
  }
});

test("wizard: ⌘N selects within the current step and never advances", async () => {
  const captured: AgentChatPromptStepAnswer[][] = [];
  const { container, root } = await mountWizard((steps) => captured.push(steps));
  try {
    // ⌘2 picks the 2nd option (B) of step 1 — still on "1 of 2", no submit.
    await pressMeta("Digit2");
    assert.equal(optionByLabel(container, "B").getAttribute("data-selected"), "true");
    assert.match(container.textContent ?? "", /1 of 2/);
    assert.equal(captured.length, 0);

    // ⌘Enter still advances, carrying the ⌘2 pick into the answer set.
    await pressMeta("Enter");
    assert.match(container.textContent ?? "", /2 of 2/);
    await pressMeta("Enter");
    assert.deepEqual(captured[0]?.[0], { stepId: "q-0", value: "structured:option:B" });
  } finally {
    await act(async () => root.unmount());
  }
});

// Set a controlled textarea's value the way React expects (native setter + input event),
// so onChange fires and component state actually updates.
async function typeInto(el: Element, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(el, value);
    el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}

test("AUQ note typed before ⌘Enter rides along (no stale-closure drop)", async () => {
  const { container, root, spies } = await mountWithSpies(singleAuqPrompt());
  try {
    // A listed option is selected by default → the note field is offered.
    const note = container.querySelector(".prompt-card__note");
    assert.ok(note !== null, "note field present");
    await typeInto(note, "remember this");
    // ⌘Enter must submit with the freshly typed note, not a stale "".
    await pressMeta("Enter");
    assert.equal(spies.onAnswerText.calls.length, 1);
    assert.equal(spies.onAnswerText.calls[0]?.[1], "remember this");
  } finally {
    await act(async () => root.unmount());
  }
});

test("each shortcut-bearing option shows a ⌘N keycap", () => {
  // 2 choices + "Other…" → ⌘1, ⌘2, ⌘3.
  const markup = renderToStaticMarkup(
    <PromptCard prompt={singlePrompt()} onSelectChoice={() => {}} onAnswerText={() => {}} onAnswerSteps={() => {}} />,
  );
  assert.ok(markup.includes("⌘1"), "first option keycap");
  assert.ok(markup.includes("⌘2"), "second option keycap");
  assert.ok(markup.includes("⌘3"), "Other… keycap");
});

test("single prompt (no steps) renders the plain card — no wizard chrome", () => {
  // Static render is enough: this is the codex/opencode + claude-permission path.
  const markup = renderToStaticMarkup(
    <PromptCard
      prompt={singlePrompt()}
      onSelectChoice={() => {}}
      onAnswerText={() => {}}
      onAnswerSteps={() => {}}
    />,
  );
  assert.ok(markup.includes("Skip"), "single card keeps the Skip affordance");
  assert.ok(markup.includes("Submit"), "single card keeps Submit");
  assert.ok(!markup.includes("prompt-card__step-dot"), "no step dots on a single prompt");
  assert.ok(!markup.includes("prompt-card--wizard"), "no wizard modifier on a single prompt");
  assert.ok(!/>Next</.test(markup), "no Next button on a single prompt");
  assert.ok(!/ of \d/.test(markup), "no 'i of N' step counter on a single prompt");
});
