import type { FileTreeRenderEntry } from "./git-status.ts";

export function filterFileTreeEntries(
  entries: FileTreeRenderEntry[],
  filterDraft: string,
): FileTreeRenderEntry[] {
  const normalizedFilter = filterDraft.trim().toLowerCase();
  if (normalizedFilter.length === 0) {
    return entries;
  }
  const visiblePaths = new Set<string>();
  for (const entry of entries) {
    const relativePath = entry?.relativePath;
    if (typeof relativePath !== "string" || relativePath.length === 0) {
      continue;
    }
    if (!relativePath.toLowerCase().includes(normalizedFilter)) {
      continue;
    }
    const parts = relativePath.split("/");
    for (let index = 1; index <= parts.length; index++) {
      visiblePaths.add(parts.slice(0, index).join("/"));
    }
  }
  return entries.filter((entry) => {
    const relativePath = entry?.relativePath;
    return typeof relativePath === "string" && visiblePaths.has(relativePath);
  });
}
