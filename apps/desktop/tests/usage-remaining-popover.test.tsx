// Spec: docs_v2/specs/usage-remaining-popover.md — the usage strip above the
// Composer shows session/context and provider quota windows inline. Its details
// button opens a Codex-style popover listing each row as remaining % + reset time.
// Outside-click and Escape close it.
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
  contextRemainingPercent: 75,
  contextRemainingLabel: "75%",
  contextDetailLabel: "64k / 256k tokens",
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

test("usage_strip_shows_session_and_limits_inline_and_opens_details_on_click", async () => {
  const { container, unmount } = await mount();

  // Closed by default: session and quota windows are already visible.
  assert.equal(container.querySelector(".agent-usage__popover"), null);
  const segments = [...container.querySelectorAll(".agent-usage__segment")];
  assert.equal(segments.length, 3);
  assert.match(segments[0].textContent ?? "", /Session.*75% left.*64k \/ 256k tokens/);
  assert.match(segments[1].textContent ?? "", /5h.*100% left.*resets 8:31 PM|5h.*100% left.*resets 8:31 PM/);
  assert.match(segments[2].textContent ?? "", /Weekly.*29% left.*resets Jun 28/);

  const trigger = container.querySelector<HTMLButtonElement>(".agent-usage__trigger");
  assert.ok(trigger, "details button is shown when quota details exist");
  assert.equal(trigger.getAttribute("aria-label"), "Usage details");
  assert.equal(trigger.getAttribute("aria-expanded"), "false");

  // Click → popover with session plus one row per quota window.
  await act(async () => trigger.click());
  const popover = container.querySelector(".agent-usage__popover");
  assert.ok(popover, "popover opens on click");
  assert.match(popover.textContent ?? "", /Usage details/);
  const rows = [...container.querySelectorAll(".agent-usage__row")];
  assert.equal(rows.length, 3);
  assert.match(rows[0].textContent ?? "", /Session.*75% left.*64k \/ 256k tokens/);
  assert.match(rows[1].textContent ?? "", /5h.*100% left.*resets 8:31 PM|5h.*100% left.*resets 8:31 PM/);
  assert.match(rows[2].textContent ?? "", /Weekly.*29% left.*resets Jun 28/);
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
