// Spec: docs_v2/specs/git-changes-view.md — the read-only git Changes pane self-fetches
// its file list + diffs from its cwd, so this mounts it for real (jsdom + react-dom) and
// lets the fetch promise resolve before asserting.
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, useEffect, useState } from "react";
import type { ReactElement } from "react";

import { ChangesPanel } from "../src/desktop/adapters/inbound/react-renderer/product-shell/workbench/changes-panel.tsx";
import { GIT_STATE_REFRESH_MS, useGitState } from "../src/desktop/adapters/inbound/react-renderer/product-shell/support/use-shell-effects.ts";
import type { GitChangesViewResult, ProjectRegistryBridge } from "../src/desktop/adapters/inbound/react-renderer/product-shell/support/types.ts";
import { createProductShellState } from "../src/desktop/application/domains/product-shell/state/create.ts";
import { openProductShellDraftChanges } from "../src/desktop/application/domains/product-shell/state/workbench.ts";
import { selectWorkbenchViewModel } from "../src/desktop/application/domains/product-shell/state/view-model.ts";
import type { ProductShellState } from "../src/desktop/application/domains/product-shell/product-shell.ts";

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

test("changes_pane_renders_a_resizable_collapsible_file_list", async () => {
  const html = await renderPane({
    isGitRepo: true,
    branch: "main",
    files: [{ path: "src/a.ts", status: "modified", additions: 1, deletions: 0 }],
  });
  // GitHub-style file tree controls: a collapse toggle + a resize divider.
  assert.match(html, /Hide file list/);
  assert.match(html, /Resize file list/);
});

test("git_badge_refreshes_after_working_tree_becomes_clean", async () => {
  const { createRoot } = await import("react-dom/client");
  const originalSetInterval = dom.window.setInterval;
  const originalClearInterval = dom.window.clearInterval;
  let refresh: (() => void) | null = null;
  dom.window.setInterval = ((handler: TimerHandler, timeout?: number) => {
    assert.equal(timeout, GIT_STATE_REFRESH_MS);
    refresh = typeof handler === "function" ? () => handler() : null;
    return 1;
  }) as typeof dom.window.setInterval;
  dom.window.clearInterval = (() => undefined) as typeof dom.window.clearInterval;

  let clean = false;
  let latestBadge:
    | { branch: string | null; additions: number; deletions: number; fileCount: number; cwd: string }
    | null = null;
  const bridge = {
    gitContext: () =>
      Promise.resolve({
        isGitRepo: true,
        currentBranch: "tide/wt-0217f",
        branches: [],
        worktrees: [],
      }),
    gitChanges: () =>
      Promise.resolve({
        isGitRepo: true,
        files: clean
          ? []
          : [{ path: "README.md", status: "modified" as const, additions: 11, deletions: 9 }],
      }),
  } as Partial<ProjectRegistryBridge> as ProjectRegistryBridge;

  function Harness(): ReactElement {
    const [, setShellState] = useState<ProductShellState>(() =>
      createProductShellState({ includeFixtureData: false }),
    );
    const { gitBadge } = useGitState(bridge, "/repo", setShellState);
    useEffect(() => {
      latestBadge = gitBadge;
    }, [gitBadge]);
    return <div>{gitBadge?.branch ?? ""}</div>;
  }

  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(<Harness />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    assert.equal(latestBadge?.additions, 11);
    assert.equal(latestBadge?.deletions, 9);

    clean = true;
    assert.notEqual(refresh, null);
    await act(async () => {
      refresh?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    assert.equal(latestBadge?.fileCount, 0);
    assert.equal(latestBadge?.additions, 0);
    assert.equal(latestBadge?.deletions, 0);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.setInterval = originalSetInterval;
    dom.window.clearInterval = originalClearInterval;
  }
});

// --- Composer (pre-thread) draft Changes pane. Spec: git-changes-view (Composer
// pre-thread Changes). The badge opens the Changes view on the New Thread page too,
// where there is no thread to own a backend pane. ---

test("composer_badge_opens_a_singleton_draft_changes_pane", () => {
  const state0 = createProductShellState({ includeFixtureData: false });
  assert.equal(state0.activeThreadId, null); // the New Thread / composer page
  const state1 = openProductShellDraftChanges(state0, "/repo");
  const changes1 = state1.draftWorkbenchPanes.filter((pane) => pane.kind === "changes");
  assert.equal(changes1.length, 1);
  assert.equal(changes1[0]?.cwd, "/repo");
  assert.equal(state1.workbenchOpen, true);
  assert.equal(state1.draftActiveWorkbenchPaneId, changes1[0]?.paneId);
  // Singleton: clicking the badge again reveals the same pane, never a second one.
  const state2 = openProductShellDraftChanges(state1, "/repo");
  assert.equal(state2.draftWorkbenchPanes.filter((pane) => pane.kind === "changes").length, 1);
  assert.equal(state2.draftActiveWorkbenchPaneId, changes1[0]?.paneId);
});

test("composer_draft_changes_pane_renders_as_a_changes_pane_carrying_its_cwd", () => {
  const state = openProductShellDraftChanges(
    createProductShellState({ includeFixtureData: false }),
    "/repo",
  );
  const workbench = selectWorkbenchViewModel(state);
  const pane = workbench.appChrome.openWorkbenchPanes.find((candidate) => candidate.kind === "changes");
  assert.ok(pane, "expected a changes pane in the composer workbench view-model");
  assert.equal(pane?.cwd, "/repo");
  // It's the active pane (the badge click reveals it).
  assert.equal(workbench.appChrome.activeWorkbenchPane?.kind, "changes");
});
