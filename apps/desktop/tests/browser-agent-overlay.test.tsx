// Spec: docs_v2/specs/browser-pane-agent-computer-use.md
// Slice 1b-ii — the on-screen "agent is driving" theater (D3): a lock veil + a cursor at
// agentCursor + a Take control button. Pure render derivation; the foreground pane gates
// it on agentDriving so it never appears for an offscreen/background pane.
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { BrowserAgentOverlay } from "../src/desktop/adapters/inbound/react-renderer/product-shell/workbench/browser-agent-overlay.tsx";

test("overlay renders a lock veil, Take control, and a cursor at agentCursor", () => {
  const markup = renderToStaticMarkup(
    <BrowserAgentOverlay cursor={{ x: 120, y: 240 }} onTakeControl={() => {}} />,
  );
  assert.match(markup, /browser-agent-overlay__veil/);
  assert.match(markup, /Take control/);
  assert.match(markup, /browser-agent-overlay__cursor/);
  assert.match(markup, /left:120px/);
  assert.match(markup, /top:240px/);
});

test("overlay omits the cursor when there is no agentCursor yet", () => {
  const markup = renderToStaticMarkup(
    <BrowserAgentOverlay cursor={null} onTakeControl={() => {}} />,
  );
  assert.doesNotMatch(markup, /browser-agent-overlay__cursor/);
  // The lock veil + Take control still render (driving before any pointer move).
  assert.match(markup, /browser-agent-overlay__veil/);
  assert.match(markup, /Take control/);
});
