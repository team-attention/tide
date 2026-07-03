// Spec: docs_v2/specs/multitask-navigation.md (L2 pin jump + L3 live cycle + HUD)
import assert from "node:assert/strict";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import {
  advanceLiveHighlight,
  initialLiveHighlight,
  resolvePinJump,
} from "../src/desktop/adapters/inbound/react-renderer/product-shell/multitask/multitask-navigation.ts";
import { createLiveSwitcherHud } from "../src/desktop/adapters/inbound/react-renderer/product-shell/multitask/live-switcher-hud.tsx";
import type { ProductShellThreadView } from "../src/desktop/application/domains/product-shell/product-shell.ts";

const pins = [{ threadId: "p1" }, { threadId: "p2" }, { threadId: "p3" }];

test("resolvePinJump maps ⌥N to the N-th rail-order thread, else null", () => {
  assert.equal(resolvePinJump(pins, 1), "p1");
  assert.equal(resolvePinJump(pins, 3), "p3");
  assert.equal(resolvePinJump(pins, 4), null); // beyond the list
  assert.equal(resolvePinJump(pins, 0), null); // out of 1..9
  assert.equal(resolvePinJump(pins, 10), null); // out of 1..9
});

test("initialLiveHighlight steps one off the active thread (⌘-Tab style)", () => {
  const live = [{ threadId: "a" }, { threadId: "b" }, { threadId: "c" }];
  assert.equal(initialLiveHighlight(live, "a", 1), 1); // forward → next
  assert.equal(initialLiveHighlight(live, "a", -1), 2); // backward → wraps to last
  assert.equal(initialLiveHighlight(live, "c", 1), 0); // forward wraps
  assert.equal(initialLiveHighlight(live, "zzz", 1), 0); // active not live → first
  assert.equal(initialLiveHighlight(live, "zzz", -1), 2); // → last
  assert.equal(initialLiveHighlight([], "a", 1), 0); // empty
});

test("advanceLiveHighlight wraps both directions", () => {
  assert.equal(advanceLiveHighlight(3, 2, 1), 0);
  assert.equal(advanceLiveHighlight(3, 0, -1), 2);
  assert.equal(advanceLiveHighlight(3, 1, 1), 2);
});

function threadView(threadId: string, title: string, extra?: Partial<ProductShellThreadView>): ProductShellThreadView {
  return {
    threadId,
    title,
    agentId: "claude",
    time: "now",
    scope: { kind: "project", projectId: "p", cwd: "/r" },
    workbenchPanes: [],
    active: false,
    archiveConfirming: false,
    renaming: false,
    contextMenuOpen: false,
    ...extra,
  } as ProductShellThreadView;
}

test("live switcher HUD renders the live set and highlights the current index", () => {
  const markup = renderToStaticMarkup(
    createLiveSwitcherHud([threadView("a", "Alpha"), threadView("b", "Beta")], 1),
  );
  assert.match(markup, /Alpha/);
  assert.match(markup, /Beta/);
  // The highlighted (index 1 = Beta) card carries semantic active state + aria-current.
  assert.match(markup, /data-active="true"/);
  assert.match(markup, /aria-current="true"[^>]*data-thread-id="b"|data-thread-id="b"[^>]*aria-current="true"/);
});

test("live switcher HUD is null for an empty live set", () => {
  assert.equal(createLiveSwitcherHud([], 0), null);
});
