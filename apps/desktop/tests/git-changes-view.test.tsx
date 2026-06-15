// Spec: docs_v2/specs/git-changes-view.md (read-only Changes view).
import assert from "node:assert/strict";
import test from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { ChangesPanel } from "../src/desktop/adapters/inbound/react-renderer/product-shell/workbench/changes-panel.tsx";

test("changes_panel_lists_changed_files_with_status_and_branch", () => {
  const markup = renderToStaticMarkup(
    <ChangesPanel
      isGitRepo
      branch="feature-x"
      files={[
        { path: "src/app.ts", status: "modified", additions: 10, deletions: 3 },
        { path: "new.txt", status: "untracked", additions: 5, deletions: 0 },
        { path: "old.ts", status: "deleted", additions: 0, deletions: 8 },
      ]}
      loadDiff={() => Promise.resolve("")}
      onRefresh={() => {}}
    />,
  );
  assert.match(markup, /feature-x/);
  assert.match(markup, /3 files/);
  // Header total shown as +/- (additions 10+5, deletions 3+8), not a bare file count.
  assert.match(markup, /\+15/);
  assert.match(markup, /−11/);
  assert.match(markup, /app\.ts/);
  assert.match(markup, /new\.txt/);
  // Status drives the colored letter badge per file.
  assert.match(markup, /changes-panel__status--untracked/);
  assert.match(markup, /changes-panel__status--deleted/);
});

test("changes_panel_shows_clean_empty_state", () => {
  const markup = renderToStaticMarkup(
    <ChangesPanel
      isGitRepo
      branch="main"
      files={[]}
      loadDiff={() => Promise.resolve("")}
      onRefresh={() => {}}
    />,
  );
  assert.match(markup, /No changes/);
  assert.match(markup, /Working tree clean/);
});

test("changes_panel_shows_not_a_git_repo_state", () => {
  const markup = renderToStaticMarkup(
    <ChangesPanel
      isGitRepo={false}
      branch={null}
      files={[]}
      loadDiff={() => Promise.resolve("")}
      onRefresh={() => {}}
    />,
  );
  assert.match(markup, /Not a git repo/);
});
