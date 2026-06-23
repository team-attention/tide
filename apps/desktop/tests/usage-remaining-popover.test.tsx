// Spec: docs_v2/specs/usage-remaining-popover.md — the quiet usage chip above the
// Composer is clickable when the active thread's provider reports quota windows:
// it opens a Codex-style "Usage remaining" popover listing each window as
// remaining % + reset time. Outside-click and Escape close it.
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act } from "react";

import { UsageMeter } from "../src/desktop/adapters/inbound/react-renderer/agent-chat/composer/usage-meter.tsx";
import type { AgentChatUsageView } from "../src/desktop/application/domains/agent-chat/agent-chat.ts";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
(globalThis as unknown as { window: unknown }).window = dom.window;
(globalThis as unknown as { document: unknown }).document = dom.window.document;
(globalThis as unknown as { MouseEvent: unknown }).MouseEvent = dom.window.MouseEvent;
(globalThis as unknown as { KeyboardEvent: unknown }).KeyboardEvent = dom.window.KeyboardEvent;
(globalThis as unknown as { Node: unknown }).Node = dom.window.Node;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const usage: AgentChatUsageView = {
  contextPercentLabel: "25%",
  contextUsedPercent: 25,
  tokensLabel: "64k tokens",
  rateLimits: [
    { label: "5h", remainingPercent: 100, remainingLabel: "100%", resetLabel: "8:31 PM" },
    { label: "Weekly", remainingPercent: 29, remainingLabel: "29%", resetLabel: "Jun 28" },
  ],
};

async function mount(): Promise<{ container: HTMLElement; unmount: () => Promise<void> }> {
  const { createRoot } = await import("react-dom/client");
  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<UsageMeter usage={usage} />);
  });
  return {
    container,
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

test("usage_chip_shows_remaining_summary_and_opens_popover_on_click", async () => {
  const { container, unmount } = await mount();

  // Closed by default: compact remaining summary, no popover.
  assert.equal(container.querySelector(".agent-usage__popover"), null);
  const trigger = container.querySelector<HTMLButtonElement>(".agent-usage__trigger");
  assert.ok(trigger, "chip is a button when quota windows exist");
  assert.match(trigger.textContent ?? "", /5h 100% · Weekly 29%/);
  assert.equal(trigger.getAttribute("aria-expanded"), "false");

  // Click → popover with one row per window (label · remaining % · reset).
  await act(async () => trigger.click());
  const popover = container.querySelector(".agent-usage__popover");
  assert.ok(popover, "popover opens on click");
  assert.match(popover.textContent ?? "", /Usage remaining/);
  const rows = [...container.querySelectorAll(".agent-usage__row")];
  assert.equal(rows.length, 2);
  assert.match(rows[0].textContent ?? "", /5h.*100%.*8:31 PM|5h.*100%.*8:31 PM/);
  assert.match(rows[1].textContent ?? "", /Weekly.*29%.*Jun 28/);
  assert.equal(trigger.getAttribute("aria-expanded"), "true");

  await unmount();
});

test("usage_popover_closes_on_escape", async () => {
  const { container, unmount } = await mount();
  const trigger = container.querySelector<HTMLButtonElement>(".agent-usage__trigger");
  assert.ok(trigger);

  await act(async () => trigger.click());
  assert.ok(container.querySelector(".agent-usage__popover"), "open before Escape");

  await act(async () => {
    dom.window.document.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  assert.equal(container.querySelector(".agent-usage__popover"), null, "closed after Escape");

  await unmount();
});
