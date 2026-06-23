// Spec: docs_v2/specs/git-changes-view.md — the read-only git Changes pane self-fetches
// its file list + diffs from its cwd, so this mounts it for real (jsdom + react-dom) and
// lets the fetch promise resolve before asserting.
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ChangesPanel } from "../src/desktop/adapters/inbound/react-renderer/product-shell/workbench/changes-panel.tsx";
import { GIT_STATE_REFRESH_MS, useGitState } from "../src/desktop/adapters/inbound/react-renderer/product-shell/support/use-shell-effects.ts";
import type { GitChangesView, GitChangesViewResult, ProjectRegistryBridge } from "../src/desktop/adapters/inbound/react-renderer/product-shell/support/types.ts";
import { createFileTreeColumn } from "../src/desktop/adapters/inbound/react-renderer/product-shell/file-tree/file-tree.tsx";
import { createGitAwareEntries } from "../src/desktop/adapters/inbound/react-renderer/product-shell/file-tree/git-status.ts";
import { createProductShellState } from "../src/desktop/application/domains/product-shell/state/create.ts";
import type { ProductShellState } from "../src/desktop/application/domains/product-shell/product-shell.ts";
import type { ProductShellHandlers } from "../src/desktop/adapters/inbound/react-renderer/product-shell/support/types.ts";

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

test("file_tree_renders_git_status_badges_and_deleted_rows", () => {
  const handlers = {
    onNewUntitledFile: () => undefined,
    onFileTreeNewFolder: () => undefined,
    onFileTreeEntryOpen: () => undefined,
    onFileTreeMenuOpen: () => undefined,
    onFileTreeMove: () => undefined,
    onOpenChanges: () => undefined,
  } as Partial<ProductShellHandlers> as ProductShellHandlers;
  const html = renderToStaticMarkup(
    createFileTreeColumn(
      {
        fileTree: {
          root: "/repo",
          cwdLabel: "repo",
          entries: [
            { id: "src", name: "src", relativePath: "src", depth: 0, kind: "folder", expanded: true },
            { id: "src/app.ts", name: "app.ts", relativePath: "src/app.ts", depth: 1, kind: "file" },
            { id: "README.md", name: "README.md", relativePath: "README.md", depth: 0, kind: "file" },
          ],
        },
        fileTreeEdit: null,
        fileTreeMenu: null,
        fileTreeNotice: null,
        gitChanges: {
          cwd: "/repo",
          branch: "main",
          revision: 1,
          files: [
            { path: "src/app.ts", status: "modified", additions: 3, deletions: 1 },
            { path: "src/deleted.ts", status: "deleted", additions: 0, deletions: 5 },
            { path: "README.md", status: "untracked", additions: 4, deletions: 0 },
          ],
        },
      },
      handlers,
    ),
  );

  assert.match(html, /data-git-status="modified"/);
  assert.match(html, /file-tree-row__git-status--modified[\s\S]*?>M</);
  assert.match(html, /data-git-status="untracked"/);
  assert.match(html, /file-tree-row__git-status--untracked[\s\S]*?>U</);
  assert.match(html, /src\/deleted\.ts/);
  assert.match(html, /file-tree-row--git-deleted/);
  assert.match(html, /file-tree-row__git-status--deleted[\s\S]*?>D</);
  assert.match(html, /2 changed files/);
});

test("file_tree_git_entries_preserve_tree_order_and_missing_deleted_folders", () => {
  const entries = [
    { id: "src", name: "src", relativePath: "src", depth: 0, kind: "folder" as const, expanded: true },
    { id: "src/app.ts", name: "app.ts", relativePath: "src/app.ts", depth: 1, kind: "file" as const },
    { id: "README.md", name: "README.md", relativePath: "README.md", depth: 0, kind: "file" as const },
  ];
  const gitChanges: GitChangesView = {
    cwd: "/repo",
    branch: "main",
    revision: 1,
    files: [
      { path: "src/app.ts", status: "modified", additions: 2, deletions: 1 },
      { path: "src/deleted.ts", status: "deleted", additions: 0, deletions: 1 },
      { path: "gone/removed.ts", status: "deleted", additions: 0, deletions: 1 },
    ],
  };

  const aware = createGitAwareEntries(entries, "/repo", gitChanges);

  assert.deepEqual(
    aware.map((entry) => entry.relativePath),
    ["src", "src/app.ts", "src/deleted.ts", "README.md", "gone", "gone/removed.ts"],
  );
  assert.equal(aware.find((entry) => entry.relativePath === "gone")?.kind, "folder");
  assert.equal(aware.find((entry) => entry.relativePath === "gone/removed.ts")?.syntheticDeleted, true);
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
  let latestChanges: GitChangesView | null = null;
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
    const { gitBadge, gitChanges } = useGitState(bridge, "/repo", setShellState);
    useEffect(() => {
      latestBadge = gitBadge;
      latestChanges = gitChanges;
    }, [gitBadge, gitChanges]);
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
    assert.equal(latestChanges?.revision, 1);

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
    assert.equal(latestChanges?.revision, 2);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.setInterval = originalSetInterval;
    dom.window.clearInterval = originalClearInterval;
  }
});
