export interface GitDiffHunk {
  hunkId: string;
  title: string;
  patch: string;
  additions: number;
  deletions: number;
}

export function extractGitDiffHunks(diffText: string): GitDiffHunk[] {
  const lines = diffText.split("\n");
  const header: string[] = [];
  const hunks: GitDiffHunk[] = [];
  let current: string[] | null = null;
  let currentTitle = "";

  function finishCurrent(): void {
    if (current === null || current.length === 0) {
      return;
    }
    const additions = current.filter((line) => line.startsWith("+") && !line.startsWith("+++")).length;
    const deletions = current.filter((line) => line.startsWith("-") && !line.startsWith("---")).length;
    hunks.push({
      hunkId: `hunk-${hunks.length + 1}`,
      title: currentTitle,
      patch: `${[...header, ...current].join("\n").replace(/\n+$/, "")}\n`,
      additions,
      deletions,
    });
  }

  for (const line of lines) {
    if (line.startsWith("@@ ")) {
      finishCurrent();
      current = [line];
      currentTitle = line;
      continue;
    }
    if (current === null) {
      if (line.length > 0) {
        header.push(line);
      }
    } else {
      current.push(line);
    }
  }
  finishCurrent();
  return hunks;
}
