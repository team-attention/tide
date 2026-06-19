import type {
  AgentChatChoiceSurfaceRowView,
  AgentChatShellState,
  AgentChatWorktreeOption,
} from "./types.ts";
import { row } from "./choice-row.ts";
import { launchOptionsForState } from "./launch-options.ts";
import { basenameOf } from "./path-labels.ts";

// Execution environment options for a selected branch. Keep this menu to the three
// start modes users can act on: local folder, create a new worktree branch, or use
// the existing worktree bound to the selected branch when one exists.
export function worktreeMenuRows(state: AgentChatShellState): AgentChatChoiceSurfaceRowView[] {
  const selected = String(launchOptionsForState(state)?.worktree ?? "current folder");
  const worktrees = state.availableWorktrees ?? [];
  const selectedBranch = String(
    launchOptionsForState(state)?.branch ??
      defaultBranchName(state.availableBranches ?? [], "main"),
  );
  const currentWorktree = worktrees.find((entry) => entry.current);
  const currentSelected = selected === "current folder" || selected === currentWorktree?.path || worktrees.length === 0;
  const existing = worktreeForBranch(worktrees, selectedBranch);
  const existingIsLocal = existing !== undefined && (existing.current || existing.path === currentWorktree?.path);
  const existingRow = existing !== undefined && !existingIsLocal
    ? row(
        `worktree:${existing.path}`,
        "Existing worktree",
        existing.branch ?? basenameOf(existing.path),
        undefined,
        "folder",
        selected === existing.path,
      )
    : row(
        "worktree:existing-unavailable",
        "Existing worktree",
        `No directory for ${selectedBranch}`,
        undefined,
        "folder",
        false,
        false,
        true,
      );
  return [
    row(
      "worktree:current",
      "Local",
      "current folder",
      undefined,
      "folder",
      currentSelected,
    ),
    row(
      "new-worktree",
      "New worktree",
      `from ${selectedBranch}`,
      undefined,
      "plus",
      selected === "new",
    ),
    existingRow,
  ];
}

// Real git branches with the creation affordance and the default branch pinned at
// the top. Safe local branches also get a trailing delete affordance, mirroring
// the worktree picker.
export function branchMenuRows(state: AgentChatShellState): AgentChatChoiceSurfaceRowView[] {
  const selected = String(launchOptionsForState(state)?.branch ?? "main");
  const branches = state.availableBranches ?? [];
  const worktrees = state.availableWorktrees ?? [];
  const defaultBranch = defaultBranchName(branches, selected);
  const defaultBranchOption = branches.find((branch) => branch.name === defaultBranch);
  const rows: AgentChatChoiceSurfaceRowView[] = [
    row(
      "create-branch",
      "New branch",
      `from ${selected}`,
      undefined,
      "plus",
      launchOptionsForState(state)?.worktree === "new",
    ),
    withBranchDeleteAction(
      row(
        `branch:${defaultBranch}`,
        "Home",
        defaultBranch,
        undefined,
        selected === defaultBranch ? "check" : "branch",
        selected === defaultBranch,
      ),
      defaultBranchOption,
      worktrees,
    ),
  ];
  const ordered = branchRowsAfterPinned(branches, selected, defaultBranch);
  if (!branches.some((branch) => branch.name === selected) && selected !== defaultBranch) {
    rows.push(row(`branch:${selected}`, selected, undefined, undefined, "check", true));
  }
  for (const branch of ordered) {
    const isSelected = branch.name === selected;
    rows.push(
      withBranchDeleteAction(
        row(
          `branch:${branch.name}`,
          branch.name,
          undefined,
          undefined,
          isSelected ? "check" : "branch",
          isSelected,
        ),
        branch,
        worktrees,
      ),
    );
  }
  return rows;
}

export function defaultBranchName(
  branches: Array<{ name: string; kind: "local" | "remote"; current: boolean }>,
  fallback: string,
): string {
  for (const candidate of ["main", "master", "trunk"]) {
    if (branches.some((branch) => branch.name === candidate)) {
      return candidate;
    }
  }
  const current = branches.find((branch) => branch.current && branch.kind === "local");
  return current?.name ?? fallback;
}

function branchRowsAfterPinned(
  branches: Array<{ name: string; kind: "local" | "remote"; current: boolean }>,
  selected: string,
  defaultBranch: string,
): Array<{ name: string; kind: "local" | "remote"; current: boolean }> {
  return [...branches]
    .filter((branch) => branch.name !== defaultBranch)
    .sort((a, b) => {
      if (a.name === selected) return -1;
      if (b.name === selected) return 1;
      const kind = Number(a.kind === "remote") - Number(b.kind === "remote");
      return kind !== 0 ? kind : a.name.localeCompare(b.name);
    });
}

export function worktreeForBranch(
  worktrees: AgentChatWorktreeOption[],
  branch: string,
): AgentChatWorktreeOption | undefined {
  return worktrees.find((entry) => entry.branch === branch);
}

export function branchDeletableFromPicker(
  branch: { name: string; kind: "local" | "remote"; current: boolean } | undefined,
  worktrees: AgentChatWorktreeOption[],
): boolean {
  return branch !== undefined &&
    branch.kind === "local" &&
    !branch.current &&
    !worktrees.some((worktree) => worktree.branch === branch.name);
}

function withBranchDeleteAction(
  branchRow: AgentChatChoiceSurfaceRowView,
  branch: { name: string; kind: "local" | "remote"; current: boolean } | undefined,
  worktrees: AgentChatWorktreeOption[],
): AgentChatChoiceSurfaceRowView {
  if (!branchDeletableFromPicker(branch, worktrees)) {
    return branchRow;
  }
  return {
    ...branchRow,
    action: {
      rowId: `delete-branch:${branch.name}`,
      label: `Delete branch ${branch.name}`,
      icon: "trash",
    },
  };
}
