// Spec: docs_v2/specs/project-open-folder-registry.md D6 / Inv-5
import assert from "node:assert/strict";
import test from "node:test";

import {
  agentChatWithProjects,
  createProductShellState,
  type ProductShellState,
} from "../src/desktop/application/domains/product-shell/product-shell.ts";

function stateWithProjects(
  registeredProjects: ProductShellState["registeredProjects"],
  overrides: Partial<ProductShellState> = {},
): ProductShellState {
  const base = createProductShellState({ includeFixtureData: false });
  return { ...base, registeredProjects, ...overrides };
}

test("composer_project_list_excludes_worktree_directories", () => {
  // D6: a worktree registers as a Project (so the Left Rail can group it), but it
  // must not be offered as a start-here target in the composer's project menu.
  const state = stateWithProjects([
    { projectId: "repo", name: "repo", cwd: "/repo" },
    { projectId: "wt", name: "feature", cwd: "/repo.worktree/feature" },
  ]);

  const cwds = (agentChatWithProjects(state).availableProjects ?? []).map((p) => p.cwd);

  assert.deepEqual(cwds, ["/repo"]);
});

test("composer_project_list_also_drops_thread_derived_worktrees", () => {
  // Worktrees leak through both sources (registry AND thread-derived projects); the
  // filter runs on the merged displayedProjects so neither path leaks.
  const state = stateWithProjects(
    [{ projectId: "repo", name: "repo", cwd: "/repo" }],
    {
      projects: [{ projectId: "wt", name: "feature", cwd: "/repo.worktree/feature" }],
    },
  );

  const cwds = (agentChatWithProjects(state).availableProjects ?? []).map((p) => p.cwd);

  assert.deepEqual(cwds, ["/repo"]);
});

test("composer_project_list_drops_malformed_projects_without_a_cwd", () => {
  // Defense-in-depth: persisted/backend data could carry a project with no cwd. The
  // filter must drop it (it can't scope a Thread) rather than crash the string check.
  const state = stateWithProjects([
    { projectId: "repo", name: "repo", cwd: "/repo" },
    { projectId: "bad", name: "bad" } as ProductShellState["registeredProjects"][number],
  ]);

  const cwds = (agentChatWithProjects(state).availableProjects ?? []).map((p) => p.cwd);

  assert.deepEqual(cwds, ["/repo"]);
});

test("composer_project_list_keeps_real_projects", () => {
  // Non-worktree projects are untouched by the filter.
  const state = stateWithProjects([
    { projectId: "repo", name: "repo", cwd: "/repo" },
    { projectId: "other", name: "other", cwd: "/other" },
  ]);

  const cwds = (agentChatWithProjects(state).availableProjects ?? []).map((p) => p.cwd);

  assert.deepEqual(cwds.sort(), ["/other", "/repo"]);
});
