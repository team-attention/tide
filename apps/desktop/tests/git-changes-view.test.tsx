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
import { extractGitDiffHunks } from "../src/desktop/adapters/inbound/react-renderer/product-shell/workbench/git-diff-hunks.ts";
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

async function renderPane(changes: GitChangesViewResult, diff = ""): Promise<string> {
  const { createRoot } = await import("react-dom/client");
  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <ChangesPanel
        cwd="/repo"
        onGitChanges={() => Promise.resolve(changes)}
        onGitFileDiff={() => Promise.resolve(diff)}
        onOpenReview={() => undefined}
        onGitStageFile={() => Promise.resolve({ ok: true, message: "staged" })}
        onGitUnstageFile={() => Promise.resolve({ ok: true, message: "unstaged" })}
        onGitDiscardFile={() => Promise.resolve({ ok: true, message: "discarded" })}
        onGitApplyHunk={() => Promise.resolve({ ok: true, message: "hunk applied" })}
        onGitGenerateCommitMessage={() => Promise.resolve({ ok: true, message: "Update app.ts", source: "staged", files: ["src/app.ts"] })}
        onGitCommit={() => Promise.resolve({ ok: true, message: "committed" })}
        onGitPushTarget={() => Promise.resolve({ ok: true, currentBranch: "main", remote: "origin", branch: "main", upstream: "origin/main", label: "origin/main" })}
        onGitPush={() => Promise.resolve({ ok: true, message: "pushed" })}
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
  assert.match(html, /data-status="untracked"/);
  assert.match(html, /data-status="deleted"/);
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

test("extract_git_diff_hunks_builds_single_hunk_patches_with_headers", () => {
  const hunks = extractGitDiffHunks(
    [
      "diff --git a/src/app.ts b/src/app.ts",
      "index 111..222 100644",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1,2 +1,2 @@",
      " const a = 1;",
      "-old",
      "+new",
      "@@ -10,1 +10,2 @@",
      " keep",
      "+more",
    ].join("\n"),
  );

  assert.equal(hunks.length, 2);
  assert.equal(hunks[0].title, "@@ -1,2 +1,2 @@");
  assert.match(hunks[0].patch, /diff --git a\/src\/app\.ts b\/src\/app\.ts/);
  assert.match(hunks[0].patch, /@@ -1,2 \+1,2 @@/);
  assert.doesNotMatch(hunks[0].patch, /@@ -10,1 \+10,2 @@/);
  assert.equal(hunks[0].additions, 1);
  assert.equal(hunks[0].deletions, 1);
});

test("changes_pane_stage_hunk_sends_selected_hunk_patch", async () => {
  const { createRoot } = await import("react-dom/client");
  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  let applied: { path: string; patch: string; action: string } | null = null;
  await act(async () => {
    root.render(
      <ChangesPanel
        cwd="/repo"
        onGitChanges={() => Promise.resolve({
          isGitRepo: true,
          branch: "main",
          files: [{ path: "src/app.ts", status: "modified", additions: 1, deletions: 1 }],
        })}
        onGitFileDiff={() => Promise.resolve([
          "diff --git a/src/app.ts b/src/app.ts",
          "index 111..222 100644",
          "--- a/src/app.ts",
          "+++ b/src/app.ts",
          "@@ -1,1 +1,1 @@",
          "-old",
          "+new",
        ].join("\n"))}
        onOpenReview={() => undefined}
        onGitStageFile={() => Promise.resolve({ ok: true, message: "staged" })}
        onGitUnstageFile={() => Promise.resolve({ ok: true, message: "unstaged" })}
        onGitDiscardFile={() => Promise.resolve({ ok: true, message: "discarded" })}
        onGitApplyHunk={(_cwd, path, patch, action) => {
          applied = { path, patch, action };
          return Promise.resolve({ ok: true, message: "hunk staged" });
        }}
        onGitGenerateCommitMessage={() => Promise.resolve({ ok: true, message: "Update app.ts", source: "staged", files: ["src/app.ts"] })}
        onGitCommit={() => Promise.resolve({ ok: true, message: "committed" })}
        onGitPushTarget={() => Promise.resolve({ ok: true, currentBranch: "main", remote: "origin", branch: "main", upstream: "origin/main", label: "origin/main" })}
        onGitPush={() => Promise.resolve({ ok: true, message: "pushed" })}
      />,
    );
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  const button = container.querySelector('button[aria-label="Stage hunk 1"]') as HTMLButtonElement | null;
  assert.notEqual(button, null);

  await act(async () => {
    button?.click();
  });
  await act(async () => {
    root.unmount();
  });

  assert.equal(applied?.path, "src/app.ts");
  assert.equal(applied?.action, "stage");
  assert.match(applied?.patch ?? "", /@@ -1,1 \+1,1 @@/);
});

test("changes_pane_generate_commit_message_populates_input", async () => {
  const { createRoot } = await import("react-dom/client");
  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <ChangesPanel
        cwd="/repo"
        onGitChanges={() => Promise.resolve({
          isGitRepo: true,
          branch: "main",
          files: [{ path: "src/app.ts", status: "modified", additions: 1, deletions: 0 }],
        })}
        onGitFileDiff={() => Promise.resolve("")}
        onOpenReview={() => undefined}
        onGitStageFile={() => Promise.resolve({ ok: true, message: "staged" })}
        onGitUnstageFile={() => Promise.resolve({ ok: true, message: "unstaged" })}
        onGitDiscardFile={() => Promise.resolve({ ok: true, message: "discarded" })}
        onGitApplyHunk={() => Promise.resolve({ ok: true, message: "hunk applied" })}
        onGitGenerateCommitMessage={() => Promise.resolve({
          ok: true,
          message: "Update src/app.ts",
          source: "staged",
          files: ["src/app.ts"],
        })}
        onGitCommit={() => Promise.resolve({ ok: true, message: "committed" })}
        onGitPushTarget={() => Promise.resolve({
          ok: true,
          currentBranch: "main",
          remote: "origin",
          branch: "main",
          upstream: "origin/main",
          label: "origin/main",
        })}
        onGitPush={() => Promise.resolve({ ok: true, message: "pushed" })}
      />,
    );
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  const generateButton = Array.from(container.querySelectorAll("button")).find((button) =>
    button.textContent?.includes("Generate"),
  ) as HTMLButtonElement | undefined;
  assert.notEqual(generateButton, undefined);
  await act(async () => {
    generateButton?.click();
  });

  const input = container.querySelector('input[aria-label="Commit message"]') as HTMLInputElement | null;
  assert.equal(input?.value, "Update src/app.ts");
  assert.match(container.innerHTML, /Generated commit message from staged changes/);
  await act(async () => {
    root.unmount();
  });
});

test("changes_pane_push_uses_resolved_remote_branch_target", async () => {
  const { createRoot } = await import("react-dom/client");
  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  const originalConfirm = dom.window.confirm;
  let confirmMessage = "";
  let pushed: { cwd: string; remote: string; branch: string } | null = null;
  dom.window.confirm = ((message?: string) => {
    confirmMessage = String(message ?? "");
    return true;
  }) as typeof dom.window.confirm;

  try {
    await act(async () => {
      root.render(
        <ChangesPanel
          cwd="/repo"
          onGitChanges={() => Promise.resolve({
            isGitRepo: true,
            branch: "feature-x",
            files: [{ path: "src/app.ts", status: "modified", additions: 1, deletions: 0 }],
          })}
          onGitFileDiff={() => Promise.resolve("")}
          onOpenReview={() => undefined}
          onGitStageFile={() => Promise.resolve({ ok: true, message: "staged" })}
          onGitUnstageFile={() => Promise.resolve({ ok: true, message: "unstaged" })}
          onGitDiscardFile={() => Promise.resolve({ ok: true, message: "discarded" })}
          onGitApplyHunk={() => Promise.resolve({ ok: true, message: "hunk applied" })}
          onGitGenerateCommitMessage={() => Promise.resolve({
            ok: true,
            message: "Update src/app.ts",
            source: "staged",
            files: ["src/app.ts"],
          })}
          onGitCommit={() => Promise.resolve({ ok: true, message: "committed" })}
          onGitPushTarget={() => Promise.resolve({
            ok: true,
            currentBranch: "feature-x",
            remote: "origin",
            branch: "feature-x",
            upstream: null,
            label: "origin/feature-x",
          })}
          onGitPush={(cwd, remote, branch) => {
            pushed = { cwd, remote, branch };
            return Promise.resolve({ ok: true, message: "pushed" });
          }}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const pushButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Push"),
    ) as HTMLButtonElement | undefined;
    assert.notEqual(pushButton, undefined);
    await act(async () => {
      pushButton?.click();
    });

    assert.match(confirmMessage, /Push feature-x to origin\/feature-x/);
    assert.deepEqual(pushed, { cwd: "/repo", remote: "origin", branch: "feature-x" });
  } finally {
    dom.window.confirm = originalConfirm;
    await act(async () => {
      root.unmount();
    });
  }
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

  // Status is conveyed by COLOR (tinted name + a colored dot), not letter/number badges.
  assert.match(html, /data-git-status="modified"/);
  assert.match(html, /data-git-status="modified"[\s\S]*?role="img"/);
  assert.match(html, /data-git-status="untracked"/);
  assert.match(html, /data-git-status="untracked"[\s\S]*?role="img"/);
  assert.match(html, /src\/deleted\.ts/);
  assert.match(html, /data-synthetic-deleted="true"/);
  assert.match(html, /data-git-status="deleted"[\s\S]*?role="img"/);
  // No more number/letter badges in the tree.
  assert.doesNotMatch(html, /file-tree-row__git-count/);
  // The descendant count survives only as the folder dot's hover hint.
  assert.match(html, /title="2 changed files"/);
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
