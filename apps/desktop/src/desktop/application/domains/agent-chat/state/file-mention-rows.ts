import type { AgentChatChoiceSurfaceRowView, AgentChatShellState } from "./types.ts";
import { row } from "./choice-row.ts";

export function fileMentionRows(
  state: AgentChatShellState,
  query: string,
): AgentChatChoiceSurfaceRowView[] {
  const seen = new Set<string>();
  const matches = (state.availableFileMentions ?? [])
    .filter((file) => {
      const relativePath = file.relativePath.toLowerCase();
      const name = file.name.toLowerCase();
      return query.length === 0 || relativePath.includes(query) || name.includes(query);
    })
    .filter((file) => {
      const key = file.relativePath.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((a, b) => fileMentionRank(a, query) - fileMentionRank(b, query) || a.relativePath.localeCompare(b.relativePath))
    .slice(0, 60);

  if (matches.length === 0) {
    return [row("no-files", "No files found", "for this directory", undefined, "file", false, false, true)];
  }

  return matches.map((file) =>
    row(`file:${file.relativePath}`, file.name, file.relativePath, undefined, "file"),
  );
}

function fileMentionRank(
  file: { name: string; relativePath: string },
  query: string,
): number {
  if (query.length === 0) {
    return file.relativePath.split("/").length;
  }
  const name = file.name.toLowerCase();
  const relativePath = file.relativePath.toLowerCase();
  if (name === query || relativePath === query) {
    return 0;
  }
  if (name.startsWith(query)) {
    return 1;
  }
  if (relativePath.startsWith(query)) {
    return 2;
  }
  return 3 + file.relativePath.split("/").length;
}
