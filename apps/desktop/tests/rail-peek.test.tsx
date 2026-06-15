// Spec: docs_v2/specs/multitask-navigation.md (L1 floating rail peek)
import assert from "node:assert/strict";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { TideProductShell } from "../src/desktop/adapters/inbound/react-renderer/product-shell/product-shell.tsx";
import {
  applyProductShellBackendEvent,
  createProductShellState,
} from "../src/desktop/application/domains/product-shell/product-shell.ts";

function shell(leftRailOpen: boolean): string {
  const seeded = applyProductShellBackendEvent(
    createProductShellState({ includeFixtureData: false }),
    { kind: "thread.listed", payload: { threads: [] } },
  );
  return renderToStaticMarkup(<TideProductShell initialState={{ ...seeded, leftRailOpen }} />);
}

test("collapsed rail mounts a floating peek hot-zone", () => {
  // L1: when the rail is collapsed, a left-edge hot zone reveals the floating peek.
  assert.match(shell(false), /rail-peek__hot-zone/);
});

test("open rail renders no floating peek", () => {
  // The peek only exists while collapsed; an open rail is the normal grid column.
  assert.doesNotMatch(shell(true), /rail-peek__hot-zone/);
});
