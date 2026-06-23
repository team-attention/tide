import type { ProductShellViewModel } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { GitChangeStatus, GitChangesView } from "../support/types.ts";

type FileTreeEntryView = ProductShellViewModel["fileTree"]["entries"][number];

export type FileTreeRenderEntry = FileTreeEntryView & {
  gitStatus?: GitChangeStatus;
  gitDescendantCount?: number;
  syntheticDeleted?: boolean;
};

export function gitStatusLabel(status: GitChangeStatus): string {
  switch (status) {
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "untracked":
      return "U";
    case "modified":
    default:
      return "M";
  }
}

export function gitStatusTitle(status: GitChangeStatus): string {
  switch (status) {
    case "added":
      return "Added";
    case "deleted":
      return "Deleted";
    case "renamed":
      return "Renamed";
    case "untracked":
      return "Untracked";
    case "modified":
    default:
      return "Modified";
  }
}

function parentPathOf(relativePath: string): string {
  const index = relativePath.lastIndexOf("/");
  return index === -1 ? "" : relativePath.slice(0, index);
}

function fileNameOf(relativePath: string): string {
  const parts = relativePath.split("/").filter(Boolean);
  return parts.at(-1) ?? relativePath;
}

function depthOf(relativePath: string): number {
  return Math.max(0, relativePath.split("/").filter(Boolean).length - 1);
}

function hasCollapsedExistingAncestor(
  relativePath: string,
  entriesByPath: ReadonlyMap<string, FileTreeEntryView>,
): boolean {
  const parts = relativePath.split("/").filter(Boolean);
  for (let index = 1; index < parts.length; index += 1) {
    const ancestor = parts.slice(0, index).join("/");
    const entry = entriesByPath.get(ancestor);
    if (entry?.kind === "folder" && entry.expanded === false) {
      return true;
    }
  }
  return false;
}

function changedDescendantCount(relativePath: string, changedPaths: string[]): number {
  const prefix = `${relativePath}/`;
  return changedPaths.filter((path) => path.startsWith(prefix)).length;
}

function createDeletedSyntheticEntries(
  files: GitChangesView["files"],
  entriesByPath: ReadonlyMap<string, FileTreeEntryView>,
  changedPaths: string[],
): FileTreeRenderEntry[] {
  const syntheticByPath = new Map<string, FileTreeRenderEntry>();
  const ensureSyntheticFolder = (relativePath: string) => {
    if (relativePath.length === 0 || entriesByPath.has(relativePath) || syntheticByPath.has(relativePath)) {
      return;
    }
    ensureSyntheticFolder(parentPathOf(relativePath));
    syntheticByPath.set(relativePath, {
      id: `git-deleted-folder:${relativePath}`,
      name: fileNameOf(relativePath),
      relativePath,
      depth: depthOf(relativePath),
      kind: "folder",
      expanded: true,
      gitStatus: "deleted",
      gitDescendantCount: changedDescendantCount(relativePath, changedPaths),
      syntheticDeleted: true,
    });
  };

  for (const file of files) {
    if (
      file.status !== "deleted" ||
      entriesByPath.has(file.path) ||
      syntheticByPath.has(file.path) ||
      hasCollapsedExistingAncestor(file.path, entriesByPath)
    ) {
      continue;
    }
    ensureSyntheticFolder(parentPathOf(file.path));
    syntheticByPath.set(file.path, {
      id: `git-deleted:${file.path}`,
      name: fileNameOf(file.path),
      relativePath: file.path,
      depth: depthOf(file.path),
      kind: "file",
      gitStatus: "deleted",
      syntheticDeleted: true,
    });
  }

  return [...syntheticByPath.values()];
}

function flattenTreeEntries(entries: FileTreeRenderEntry[]): FileTreeRenderEntry[] {
  const entriesByPath = new Map(entries.map((entry) => [entry.relativePath, entry]));
  const childrenByParent = new Map<string, FileTreeRenderEntry[]>();
  for (const entry of entries) {
    const parent = parentPathOf(entry.relativePath);
    const parentKey = parent.length > 0 && entriesByPath.has(parent) ? parent : "";
    const siblings = childrenByParent.get(parentKey) ?? [];
    siblings.push(entry);
    childrenByParent.set(parentKey, siblings);
  }

  const flattened: FileTreeRenderEntry[] = [];
  const visited = new Set<string>();
  const appendChildren = (parent: string) => {
    for (const entry of childrenByParent.get(parent) ?? []) {
      if (visited.has(entry.relativePath)) {
        continue;
      }
      visited.add(entry.relativePath);
      flattened.push(entry);
      if (entry.kind === "folder" && entry.expanded !== false) {
        appendChildren(entry.relativePath);
      }
    }
  };
  appendChildren("");
  return flattened;
}

export function createGitAwareEntries(
  entries: FileTreeEntryView[],
  root: string | undefined,
  gitChanges: GitChangesView | null,
): FileTreeRenderEntry[] {
  if (root === undefined || gitChanges === null || gitChanges.cwd !== root) {
    return entries;
  }

  const files = gitChanges.files;
  const statusByPath = new Map(files.map((file) => [file.path, file.status]));
  const changedPaths = files.map((file) => file.path);
  const entriesByPath = new Map(entries.map((entry) => [entry.relativePath, entry]));
  const rendered: FileTreeRenderEntry[] = entries.map((entry) => {
    if (entry.kind === "file") {
      const gitStatus = statusByPath.get(entry.relativePath);
      return gitStatus === undefined ? entry : { ...entry, gitStatus };
    }
    const gitDescendantCount = changedDescendantCount(entry.relativePath, changedPaths);
    return gitDescendantCount === 0 ? entry : { ...entry, gitDescendantCount };
  });
  const synthetic = createDeletedSyntheticEntries(files, entriesByPath, changedPaths);
  return flattenTreeEntries([...rendered, ...synthetic]);
}
