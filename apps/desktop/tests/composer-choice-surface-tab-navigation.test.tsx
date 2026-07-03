// Spec: docs_v2/specs/desktop-agent-chat-composer-shell.md
// Composer choice surfaces are transient menus, but slash command suggestions still need
// keyboard browse behavior: Tab enters from the Composer input, then cycles rows.
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act } from "react";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost/",
});

const globals = globalThis as unknown as Record<string, unknown>;
globals.window = dom.window;
globals.document = dom.window.document;
globals.Node = dom.window.Node;
globals.HTMLElement = dom.window.HTMLElement;
globals.KeyboardEvent = dom.window.KeyboardEvent;
globals.requestAnimationFrame = (cb: (t: number) => void) =>
  setTimeout(() => cb(Date.now()), 0) as unknown as number;
globals.cancelAnimationFrame = (id: number) => clearTimeout(id);
globals.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globals.IS_REACT_ACT_ENVIRONMENT = true;

const { createRoot } = await import("react-dom/client");
const {
  createAgentChatShellState,
  createAgentChatShellViewModel,
  updateComposerDraft,
} = await import("../src/desktop/application/domains/agent-chat/agent-chat.ts");
const { AgentChatShell } = await import(
  "../src/desktop/adapters/inbound/react-renderer/agent-chat/agent-chat.tsx"
);
const { nextChoiceSurfaceTabIndex } = await import(
  "../src/desktop/adapters/inbound/react-renderer/agent-chat/composer/choice-surface.tsx"
);

test("choice surface tab index wraps in both directions", () => {
  assert.equal(nextChoiceSurfaceTabIndex(-1, 3, 1), 0);
  assert.equal(nextChoiceSurfaceTabIndex(-1, 3, -1), 2);
  assert.equal(nextChoiceSurfaceTabIndex(0, 3, 1), 1);
  assert.equal(nextChoiceSurfaceTabIndex(2, 3, 1), 0);
  assert.equal(nextChoiceSurfaceTabIndex(0, 3, -1), 2);
  assert.equal(nextChoiceSurfaceTabIndex(1, 3, -1), 0);
  assert.equal(nextChoiceSurfaceTabIndex(0, 0, 1), -1);
});

test("slash command choice surface tabs from the Composer input through rows", async () => {
  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  const state = {
    ...updateComposerDraft(createAgentChatShellState(), "/").state,
    availableCommands: [
      { name: "work", description: "Run engineering work", trigger: "/" as const },
      { name: "goal", description: "Set thread goal", trigger: "/" as const },
      { name: "help", description: "Show help", trigger: "/" as const },
    ],
  };

  try {
    await act(async () => {
      root.render(<AgentChatShell viewModel={createAgentChatShellViewModel(state)} />);
    });

    const input = container.querySelector("[data-composer-input]") as HTMLTextAreaElement | null;
    const rows = Array.from(container.querySelectorAll<HTMLButtonElement>("[data-choice-row]"));
    assert.ok(input, "Composer input should render");
    assert.ok(rows.length >= 3, "slash command menu should render multiple rows");

    input.focus();
    const firstTab = dispatchTab(input);
    assert.equal(firstTab.defaultPrevented, true);
    assert.equal(dom.window.document.activeElement, rows[0]);

    const secondTab = dispatchTab(rows[0]);
    assert.equal(secondTab.defaultPrevented, true);
    assert.equal(dom.window.document.activeElement, rows[1]);

    const shiftBack = dispatchTab(rows[1], true);
    assert.equal(shiftBack.defaultPrevented, true);
    assert.equal(dom.window.document.activeElement, rows[0]);

    const shiftWrap = dispatchTab(rows[0], true);
    assert.equal(shiftWrap.defaultPrevented, true);
    assert.equal(dom.window.document.activeElement, rows[rows.length - 1]);
  } finally {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }
});

function dispatchTab(target: Element, shiftKey = false): KeyboardEvent {
  const event = new dom.window.KeyboardEvent("keydown", {
    key: "Tab",
    bubbles: true,
    cancelable: true,
    shiftKey,
  });
  target.dispatchEvent(event);
  return event;
}
