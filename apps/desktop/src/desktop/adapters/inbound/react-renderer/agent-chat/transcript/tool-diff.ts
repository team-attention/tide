import { pickStringField } from "./file-chip.ts";
// Extracted from agent-chat-shell.ts (spec: navigable-source-structure).

interface DiffLine {
  kind: "add" | "del" | "ctx";
  text: string;
}

// Builds a +/- diff for an edit tool from its JSON args, so edits render like a
// real diff instead of a wall of new text. Returns null for non-edit tools or
// args too large to diff cheaply.
export function editDiffLines(toolName: string, body: string): DiffLine[] | null {
  const trimmed = body.trim();
  // codex apply_patch: the body is (or contains) a unified-ish patch already.
  if ((/patch/i.test(toolName) || trimmed.includes("*** ")) && trimmed.includes("\n")) {
    return parsePatchLines(trimmed);
  }
  if (!trimmed.startsWith("{")) {
    return null;
  }
  let record: Record<string, unknown>;
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== "object" || parsed === null) return null;
    record = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const patch = pickStringField(record, ["patch", "diff"]);
  if (patch !== undefined) {
    return parsePatchLines(patch);
  }
  const oldText = pickStringField(record, ["old_string", "oldString", "old"]);
  const newText = pickStringField(record, ["new_string", "newString", "new"]);
  if (oldText !== undefined && newText !== undefined) {
    return lineDiff(oldText, newText);
  }
  // Write/create: all-additions.
  const content = pickStringField(record, ["content", "file_text", "contents"]);
  if (content !== undefined && pickStringField(record, ["file_path", "filePath", "path"]) !== undefined) {
    return content.split("\n").map((text) => ({ kind: "add" as const, text }));
  }
  return null;
}

function parsePatchLines(patch: string): DiffLine[] {
  const lines: DiffLine[] = [];
  for (const raw of patch.split("\n")) {
    if (raw.startsWith("+++") || raw.startsWith("---") || raw.startsWith("@@") || raw.startsWith("*** ")) {
      continue;
    }
    if (raw.startsWith("+")) lines.push({ kind: "add", text: raw.slice(1) });
    else if (raw.startsWith("-")) lines.push({ kind: "del", text: raw.slice(1) });
    else lines.push({ kind: "ctx", text: raw.startsWith(" ") ? raw.slice(1) : raw });
  }
  return lines;
}

// LCS line diff. Bounded: very large inputs fall back to null (plain render).
function lineDiff(oldText: string, newText: string): DiffLine[] | null {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  if (a.length > 600 || b.length > 600) {
    return null;
  }
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ kind: "ctx", text: a[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: "del", text: a[i] });
      i += 1;
    } else {
      out.push({ kind: "add", text: b[j] });
      j += 1;
    }
  }
  while (i < m) out.push({ kind: "del", text: a[i++] });
  while (j < n) out.push({ kind: "add", text: b[j++] });
  return out;
}
