// Spec: docs_v2/specs/worktree-start-experience.md
// Clicking "New worktree branch" in the composer Branch picker expands an inline
// name input in the dropdown. Confirming it only records the deferred
// new-worktree intent.

import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { act } from "react";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost/",
});

class TestResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const globals = globalThis as unknown as Record<string, unknown>;
globals.window = dom.window;
globals.Window = dom.window.Window;
globals.document = dom.window.document;
globals.ResizeObserver = TestResizeObserver;
globals.requestAnimationFrame = (cb: (t: number) => void) =>
  setTimeout(() => cb(Date.now()), 0) as unknown as number;
globals.cancelAnimationFrame = (id: number) => clearTimeout(id);
globals.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globals.IS_REACT_ACT_ENVIRONMENT = true;

const { createRoot } = await import("react-dom/client");
const {
  createProductShellState,
  setProductShellComposerActiveSurface,
  setProductShellGitContext,
  setProductShellRegisteredProjects,
  startNewProductShellThread,
} = await import("../src/desktop/application/domains/product-shell/product-shell.ts");
const { TideProductShell } = await import(
  "../src/desktop/adapters/inbound/react-renderer/product-shell/product-shell.tsx"
);

function seededBranchMenuState() {
  const registered = setProductShellRegisteredProjects(
    createProductShellState({ includeFixtureData: false }),
    [{ projectId: "repo", name: "repo", cwd: "/repo" }],
  );
  const scoped = startNewProductShellThread(registered, "repo");
  const withGit = setProductShellGitContext(scoped, {
    branches: [
      { name: "main", kind: "local", current: true },
      { name: "develop", kind: "local", current: false },
    ],
    worktrees: [{ path: "/repo", branch: "main", current: true }],
  });
  return setProductShellComposerActiveSurface(withGit, "branch_menu");
}

function seededWorktreeMenuState() {
  const registered = setProductShellRegisteredProjects(
    createProductShellState({ includeFixtureData: false }),
    [{ projectId: "repo", name: "repo", cwd: "/repo" }],
  );
  const scoped = startNewProductShellThread(registered, "repo");
  const withGit = setProductShellGitContext(scoped, {
    branches: [
      { name: "main", kind: "local", current: true },
      { name: "develop", kind: "local", current: false },
    ],
    worktrees: [{ path: "/repo", branch: "main", current: true }],
  });
  return setProductShellComposerActiveSurface(withGit, "worktree_menu");
}

test("composer_branch_menu_new_worktree_branch_expands_an_inline_name_input", async () => {
  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(<TideProductShell initialState={seededBranchMenuState()} />);
    });

    const newBranch = [...container.querySelectorAll("[data-choice-row]")].find(
      (button) => button.textContent?.includes("New worktree branch"),
    ) as HTMLButtonElement | undefined;
    assert.ok(newBranch, "Branch picker should render a New worktree branch row");

    await act(async () => {
      newBranch.click();
    });

    const input = container.querySelector("[data-choice-inline-input]") as HTMLInputElement | null;
    assert.ok(input, "New worktree branch should expand an inline name input in the dropdown");
    assert.equal(input.getAttribute("aria-label"), "New worktree branch name");
    assert.equal(dom.window.document.activeElement, input);
    assert.equal(container.querySelector("[data-worktree-dialog-input]"), null);
  } finally {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }
});

test("composer_worktree_menu_new_worktree_is_a_plain_deferred_option", async () => {
  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(<TideProductShell initialState={seededWorktreeMenuState()} />);
    });

    const newWorktree = [...container.querySelectorAll("[data-choice-row]")].find(
      (button) => button.textContent?.includes("New worktree"),
    ) as HTMLButtonElement | undefined;
    assert.ok(newWorktree, "Worktree picker should render a New worktree row");

    await act(async () => {
      newWorktree.click();
    });

    assert.equal(container.querySelector("[data-choice-inline-input]"), null);
  } finally {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }
});
