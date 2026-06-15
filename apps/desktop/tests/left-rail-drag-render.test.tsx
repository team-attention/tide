// Spec: docs_v2/specs/left-rail-manual-ordering.md (S6 DnD rendering)
import assert from "node:assert/strict";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { TideProductShell } from "../src/desktop/adapters/inbound/react-renderer/product-shell/product-shell.tsx";
import { createProductShellState } from "../src/desktop/application/domains/product-shell/product-shell.ts";

// The dev fixture pins thread-master-plan and has projects tide / slice.
const markup = renderToStaticMarkup(<TideProductShell initialState={createProductShellState()} />);

test("pinned top-level items render as drag-reorderable handles", () => {
  assert.match(markup, /rail-drag-item/);
  assert.match(markup, /draggable=/);
  // The pinned thread carries its kind-tagged rail key.
  assert.match(markup, /data-rail-key="t:thread-master-plan"/);
});

test("project folders render as drag-reorderable handles keyed by project id", () => {
  assert.match(markup, /data-rail-key="tide"/);
  assert.match(markup, /data-rail-key="slice"/);
});
