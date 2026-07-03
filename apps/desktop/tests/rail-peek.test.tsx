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
  assert.match(shell(false), /data-rail-peek-hot-zone="true"/);
});

test("open rail renders no floating peek", () => {
  // The peek only exists while collapsed; an open rail is the normal grid column.
  assert.doesNotMatch(shell(true), /data-rail-peek-hot-zone="true"/);
});

test("open rail peek lets row context popovers escape the panel clip", () => {
  // Thread row context surfaces are position:fixed. The open peek panel must not keep
  // a transform/overflow clip that turns those fixed surfaces into hidden panel children.
  const source = fs.readFileSync(
    path.join(
      repoRoot,
      "src/desktop/adapters/inbound/react-renderer/product-shell/left-rail/rail-peek.tsx",
    ),
    "utf8",
  );

  assert.match(source, /const RailPeekPanel = styled\.div`[^`]*overflow:\s*hidden/s);
  assert.match(source, /\$\{RailPeekFrame\}\[data-open\] & \{[^}]*transform:\s*none/s);
  assert.match(source, /\$\{RailPeekFrame\}\[data-open\] & \{[^}]*overflow:\s*visible/s);
});
