// Spec: docs_v2/specs/git-changes-view.md — the read-only git Changes pane self-fetches
// its file list + diffs from its cwd, so this mounts it for real (jsdom + react-dom) and
// lets the fetch promise resolve before asserting.
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act } from "react";

import { ChangesPanel } from "../src/desktop/adapters/inbound/react-renderer/product-shell/workbench/changes-panel.tsx";
import type { GitChangesViewResult } from "../src/desktop/adapters/inbound/react-renderer/product-shell/support/types.ts";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
(globalThis as unknown as { window: unknown }).window = dom.window;
(globalThis as unknown as { document: unknown }).document = dom.window.document;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function renderPane(changes: GitChangesViewResult): Promise<string> {
  const { createRoot } = await import("react-dom/client");
  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <ChangesPanel
        cwd="/repo"
        onGitChanges={() => Promise.resolve(changes)}
        onGitFileDiff={() => Promise.resolve("")}
      />,
    );
  });
  // Flush the fetch + selection + diff-load promise chain.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  const html = container.innerHTML;
  await act(async () => {
    root.unmount();
  });
  return html;
}

test("changes_pane_lists_files_with_status_branch_and_plus_minus_totals", async () => {
  const html = await renderPane({
    isGitRepo: true,
    branch: "feature-x",
    files: [
      { path: "src/app.ts", status: "modified", additions: 10, deletions: 3 },
      { path: "new.txt", status: "untracked", additions: 5, deletions: 0 },
      { path: "old.ts", status: "deleted", additions: 0, deletions: 8 },
    ],
  });
  assert.match(html, /feature-x/);
  assert.match(html, /3 files/);
  // Totals shown as +/- (additions 10+5, deletions 3+8).
  assert.match(html, /\+15/);
  assert.match(html, /−11/);
  assert.match(html, /app\.ts/);
  assert.match(html, /changes-panel__status--untracked/);
  assert.match(html, /changes-panel__status--deleted/);
});

test("changes_pane_shows_not_a_git_repo_state", async () => {
  const html = await renderPane({ isGitRepo: false, branch: null, files: [] });
  assert.match(html, /Not a git repo/);
});
