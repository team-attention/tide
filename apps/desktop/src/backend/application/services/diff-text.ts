// Pure text/diff utilities for rendering file changes. Extracted from
// thread-runtime-service.ts to keep the service focused on behavior.

export function unifiedContentDiff(
  relativePath: string,
  beforeContent: string,
  afterContent: string,
): string {
  const oldLines = linesForDiff(beforeContent);
  const newLines = linesForDiff(afterContent);
  const changedLines =
    oldLines.length === newLines.length
      ? oldLines.flatMap((line, index) =>
          line === newLines[index] ? [` ${line}`] : [`-${line}`, `+${newLines[index]}`],
        )
      : [
          ...oldLines.map((line) => `-${line}`),
          ...newLines.map((line) => `+${line}`),
        ];
  return [`--- ${relativePath}`, `+++ ${relativePath}`, ...changedLines].join("\n");
}

export function linesForDiff(value: string): string[] {
  const lines = value.split(/\r?\n/);
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines.length === 0 ? [""] : lines;
}

export function boundedDiffText(value: string, byteLimit: number): string {
  if (value.length <= byteLimit) {
    return value;
  }
  return `${value.slice(0, byteLimit)}\n[diff truncated]`;
}
