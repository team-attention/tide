// Spec: docs_v2/specs/multitask-navigation.md (L1 floating rail peek)
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";

import { TideProductShell } from "../src/desktop/adapters/inbound/react-renderer/product-shell/product-shell.tsx";
import {
  applyProductShellBackendEvent,
  createProductShellState,
} from "../src/desktop/application/domains/product-shell/product-shell.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

test("open rail peek lets row context popovers escape the panel clip", () => {
  // Thread row context surfaces are position:fixed. The open peek panel must not keep
  // a transform/overflow clip that turns those fixed surfaces into hidden panel children.
  const css = fs.readFileSync(
    path.join(
      repoRoot,
      "src/desktop/adapters/inbound/react-renderer/product-shell/multitask/multitask.css",
    ),
    "utf8",
  );

  assert.match(css, /\.rail-peek__panel\s*{[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.rail-peek\[data-open\]\s+\.rail-peek__panel\s*{[^}]*transform:\s*none/s);
  assert.match(css, /\.rail-peek\[data-open\]\s+\.rail-peek__panel\s*{[^}]*overflow:\s*visible/s);
});
