import { createElement } from "react";
import type { ReactElement } from "react";
import { fileIconFor } from "../../support/file-icons.ts";
// Extracted from agent-chat-shell.ts (spec: navigable-source-structure).

// The file path a read/view tool targets (e.g. {"file_path":"…"} or DirectoryPath).
export function readToolFilePath(body: string): string | undefined {
  const trimmed = body.trim();
  if (!trimmed.startsWith("{")) {
    return undefined;
  }
  try {
    const record = JSON.parse(trimmed) as Record<string, unknown>;
    return pickStringField(record, [
      "file_path", "filePath", "path", "AbsolutePath", "TargetFile", "DirectoryPath", "abs_path",
    ]);
  } catch {
    return undefined;
  }
}

// A compact file reference chip: filetype icon + filename + directory.
export function renderFileChip(path: string): ReactElement {
  const slash = path.lastIndexOf("/");
  const name = slash === -1 ? path : path.slice(slash + 1);
  const dir = slash === -1 ? "" : path.slice(0, slash);
  return createElement(
    "button",
    {
      type: "button",
      className: "agent-session-turn__file-chip",
      "data-open-file": path,
      title: `Open ${name} in the Workbench`,
    },
    createElement(fileIconFor(name), { size: 14, strokeWidth: 1.85, "aria-hidden": true }),
    createElement("span", { className: "agent-session-turn__file-chip-name" }, name),
    dir.length > 0
      ? createElement("span", { className: "agent-session-turn__file-chip-dir" }, dir)
      : null,
  );
}

export function pickStringField(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}
