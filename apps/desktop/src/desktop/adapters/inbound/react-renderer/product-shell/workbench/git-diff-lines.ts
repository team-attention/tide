import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

export type GitDiffLineKind = "added" | "deleted" | "changed";

export interface GitDiffLineMarker {
  line: number;
  kind: GitDiffLineKind;
}

const hunkPattern = /^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/;

export function parseUnifiedDiffLineMarkers(diffText: string): GitDiffLineMarker[] {
  const added = new Set<number>();
  const deletedAnchors = new Set<number>();
  let newLine = 1;
  let insideHunk = false;
  let pendingDeleted = false;

  const anchorDeleted = () => {
    deletedAnchors.add(Math.max(1, newLine));
    pendingDeleted = false;
  };

  for (const line of diffText.split(/\r?\n/)) {
    const hunk = hunkPattern.exec(line);
    if (hunk !== null) {
      if (pendingDeleted) {
        anchorDeleted();
      }
      newLine = Math.max(1, Number.parseInt(hunk[1] ?? "1", 10));
      insideHunk = true;
      continue;
    }
    if (!insideHunk || line.startsWith("--- ") || line.startsWith("+++ ") || line.startsWith("\\ ")) {
      continue;
    }
    if (line.startsWith("+")) {
      added.add(newLine);
      if (pendingDeleted) {
        deletedAnchors.add(newLine);
        pendingDeleted = false;
      }
      newLine += 1;
      continue;
    }
    if (line.startsWith("-")) {
      pendingDeleted = true;
      continue;
    }
    if (pendingDeleted) {
      anchorDeleted();
    }
    newLine += 1;
  }
  if (pendingDeleted) {
    deletedAnchors.add(Math.max(1, newLine - 1));
  }

  const lines = new Set([...added, ...deletedAnchors]);
  return [...lines]
    .sort((a, b) => a - b)
    .map((line) => ({
      line,
      kind:
        added.has(line) && deletedAnchors.has(line)
          ? "changed"
          : added.has(line)
            ? "added"
            : "deleted",
    }));
}

export function createGitDiffLineDecorations(markers: GitDiffLineMarker[]): Extension {
  if (markers.length === 0) {
    return [];
  }
  const normalized = markers
    .filter((marker) => Number.isInteger(marker.line) && marker.line > 0)
    .map((marker) => ({
      line: marker.line,
      decoration: Decoration.line({
        class: `cm-tide-git-line cm-tide-git-line--${marker.kind}`,
      }),
    }));
  if (normalized.length === 0) {
    return [];
  }
  return EditorView.decorations.of((view): DecorationSet => {
    const builder = new RangeSetBuilder<Decoration>();
    for (const marker of normalized) {
      if (marker.line > view.state.doc.lines) {
        continue;
      }
      const lineStart = view.state.doc.line(marker.line).from;
      builder.add(lineStart, lineStart, marker.decoration);
    }
    return builder.finish();
  });
}
