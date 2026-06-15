// Spec: docs_v2/specs/git-changes-view.md (read-only Changes view).
import assert from "node:assert/strict";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { ChangesPanel } from "../src/desktop/adapters/inbound/react-renderer/product-shell/workbench/changes-panel.tsx";

test("changes_panel_lists_changed_files_with_status_and_branch", () => {
  const markup = renderToStaticMarkup(
    <ChangesPanel
      branch="feature-x"
      files={[
        { path: "src/app.ts", status: "modified" },
        { path: "new.txt", status: "untracked" },
        { path: "old.ts", status: "deleted" },
      ]}
      loadDiff={() => Promise.resolve("")}
      onRefresh={() => {}}
      onClose={() => {}}
    />,
  );
  assert.match(markup, /feature-x/);
  assert.match(markup, /3 files changed/);
  assert.match(markup, /app\.ts/);
  assert.match(markup, /new\.txt/);
  // Status drives the colored letter badge per file.
  assert.match(markup, /changes-panel__status--untracked/);
  assert.match(markup, /changes-panel__status--deleted/);
});

test("changes_panel_shows_clean_empty_state", () => {
  const markup = renderToStaticMarkup(
    <ChangesPanel
      branch="main"
      files={[]}
      loadDiff={() => Promise.resolve("")}
      onRefresh={() => {}}
      onClose={() => {}}
    />,
  );
  assert.match(markup, /No changes/);
  assert.match(markup, /Working tree clean/);
});
