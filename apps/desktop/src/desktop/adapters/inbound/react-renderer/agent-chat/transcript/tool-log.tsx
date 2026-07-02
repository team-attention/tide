import type { AgentChatBlockView } from "../../../../../application/domains/agent-chat/agent-chat.ts";
import { useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { pickStringField, readToolFilePath, renderFileChip } from "./file-chip.tsx";
import { editDiffLines } from "./tool-diff.ts";
import { guessLanguage, highlightToHtml } from "../../support/code-highlight.ts";
import { ChevronDown, Wrench } from "lucide-react";
import { fileIconFor } from "../../support/file-icons.ts";
// Extracted from agent-chat-shell.ts (spec: navigable-source-structure).

// A provider tool call/result renders as a compact log entry: a small header
// with the result/call marker and provider-native tool name, then the bounded
// args/output in a monospace body — visually distinct from message turns.
export function createToolLogTurn(block: AgentChatBlockView): ReactElement | null {
  const isResult = block.kind === "tool_result";
  const body = renderToolBody(block);
  // Drop empty tool entries (e.g. a "← Read" result with no captured output) —
  // a lone header marker is noise.
  if (body === null) {
    return null;
  }
  return (
    <article
      key={block.blockId}
      className={`agent-session-turn agent-session-turn--tool agent-session-turn--tool-${
        isResult ? "result" : "call"
      }`}
      data-block-id={block.blockId}
      data-parent-block-id={block.parentBlockId}
      data-block-kind={block.kind}
      data-block-status={block.status}
      data-block-role="tool"
      data-native-evidence={block.nativeEvidenceLabel}
      data-native-evidence-count={block.nativeEvidence?.length}
    >
      {/* A call shows a quiet tool-name label; a result drops the (repeated) label
          and just shows its output flowing under the call. No arrow markers. */}
      {isResult ? null : <span className="agent-session-turn__tool-name">{block.title}</span>}
      {body}
    </article>
  );
}

function renderToolBody(block: AgentChatBlockView): ReactNode {
  if (block.body.length === 0) {
    return null;
  }
  // Read/view file calls render as a file chip (icon + name + dir), not raw
  // file_path/offset/limit args.
  if (block.kind === "tool_call" && categorizeTool(block.title) === "read") {
    const path = readToolFilePath(block.body);
    if (path !== undefined) {
      return renderFileChip(path);
    }
  }
  // Edits render as a +/- diff (Codex/Claude-app style) when we can derive one.
  const diff = block.kind === "tool_call" ? editDiffLines(block.title, block.body) : null;
  if (diff !== null && diff.length > 0) {
    const adds = diff.filter((line) => line.kind === "add").length;
    const dels = diff.filter((line) => line.kind === "del").length;
    // One language for the whole diff so every line (incl. continuations) is
    // highlighted consistently.
    const diffLang = guessLanguage(diff.map((line) => line.text).join("\n"));
    return (
      <div className="agent-session-turn__diff">
        <div className="agent-session-turn__diff-stat">
          {adds > 0 ? <span className="diff-stat--add">{`+${adds}`}</span> : null}
          {dels > 0 ? <span className="diff-stat--del">{`-${dels}`}</span> : null}
        </div>
        <div className="agent-session-turn__diff-body">
          {diff.map((line, index) => (
            <div key={index} className={`diff-line diff-line--${line.kind}`}>
              <span className="diff-line__sign" aria-hidden>
                {line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}
              </span>
              <span
                className="diff-line__text"
                dangerouslySetInnerHTML={{ __html: highlightToHtml(line.text, diffLang) }}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <pre
      className="agent-session-turn__tool-body"
      dangerouslySetInnerHTML={{ __html: highlightToHtml(toolBodyText(block.title, block.body)) }}
    />
  );
}

// Tool args arrive as a JSON string (e.g. {"command":"cd …\npkill …"}), which
// renders with ugly escaped \n / \". Extract the meaningful payload: the shell
// command for run tools, otherwise pretty-print the args object.
export function toolBodyText(toolName: string, body: string): string {
  const trimmed = body.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return body;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // Bounded args may be truncated past valid JSON; show as-is.
    return body;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return body;
  }
  const record = parsed as Record<string, unknown>;
  const command = record.command ?? record.cmd ?? record.CommandLine;
  if (typeof command === "string") {
    return command;
  }
  if (Array.isArray(command)) {
    return command.map((part) => String(part)).join(" ");
  }
  // Edit/write/patch tools carry the file content as a string field. Show it with
  // REAL newlines (optionally headed by the path) instead of an escaped blob —
  // JSON.stringify would re-escape \n/\" inside those string values.
  const path = pickStringField(record, ["file_path", "filePath", "path", "AbsolutePath", "TargetFile"]);
  const content = pickStringField(record, [
    "new_string", "newString", "content", "file_text", "contents", "text", "code", "patch", "diff", "body",
  ]);
  if (content !== undefined) {
    return path !== undefined ? `${path}\n\n${content}` : content;
  }
  // Otherwise render key: value lines (multiline values kept raw, not escaped).
  const entries = Object.entries(record);
  if (entries.length === 0) {
    return body;
  }
  return entries
    .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join("\n");
}

// A run of tool calls/results renders as ONE muted Codex-style summary line
// ("Edited 1 file, ran 2 commands"), expandable to the individual tool entries.
export function ToolActivityGroup({ blocks }: { blocks: AgentChatBlockView[] }): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const summary = summarizeToolActivity(blocks);
  return (
    <article
      className={`agent-session-tools${expanded ? " agent-session-tools--expanded" : ""}`}
      data-block-role="tool"
      data-tool-count={blocks.length}
    >
      <button
        type="button"
        className="agent-session-tools__summary"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <Wrench className="agent-session-tools__icon" size={14} aria-hidden />
        <span className="agent-session-tools__summary-text">{summary}</span>
        <ChevronDown className="agent-session-tools__chevron" size={13} aria-hidden />
      </button>
      {createFilesChangedList(blocks)}
      {expanded ? (
        <div className="agent-session-tools__detail">{blocks.map(createToolLogTurn)}</div>
      ) : null}
    </article>
  );
}

// Codex-style "files changed" list: the distinct files edited by this tool group.
function createFilesChangedList(blocks: AgentChatBlockView[]): ReactElement | null {
  const paths = distinctEditedPaths(blocks);
  if (paths.length === 0) {
    return null;
  }
  return (
    <div className="agent-session-tools__files">
      {paths.map((path) => {
        const slash = path.lastIndexOf("/");
        const name = slash === -1 ? path : path.slice(slash + 1);
        const dir = slash === -1 ? "" : path.slice(0, slash);
        const Icon = fileIconFor(name);
        return (
          <button
            key={path}
            type="button"
            className="agent-session-tools__file"
            data-open-file={path}
            title={`Open ${name} in the Workbench`}
          >
            <Icon className="agent-session-tools__file-icon" size={13} aria-hidden />
            <span className="agent-session-tools__file-name">{name}</span>
            {dir.length > 0 ? <span className="agent-session-tools__file-dir">{dir}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

function distinctEditedPaths(blocks: AgentChatBlockView[]): string[] {
  const seen = new Set<string>();
  for (const block of blocks) {
    if (block.kind !== "tool_call" || categorizeTool(block.title) !== "edit") continue;
    for (const path of editedPathsFromArgs(block.title, block.body)) {
      seen.add(path);
    }
  }
  return [...seen];
}

// Best-effort extraction of edited file paths from a tool call's bounded args.
function editedPathsFromArgs(toolName: string, body: string): string[] {
  // codex apply_patch carries `*** Update/Add/Delete File: <path>` headers.
  if (/patch/i.test(toolName) || body.includes("*** ")) {
    const paths: string[] = [];
    const re = /\*\*\* (?:Update|Add|Delete) File: (.+)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(body)) !== null) {
      paths.push(match[1].trim());
    }
    if (paths.length > 0) return paths;
  }
  // claude edit tools carry a JSON args object with a path field.
  const trimmed = body.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const path =
        firstString(parsed.file_path) ??
        firstString(parsed.filePath) ??
        firstString(parsed.AbsolutePath) ??
        firstString(parsed.path) ??
        firstString(parsed.TargetFile);
      if (path !== undefined) return [path];
    } catch {
      // Bounded args may be truncated past valid JSON; skip rather than guess.
    }
  }
  return [];
}

function firstString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

type ToolCategory = "edit" | "run" | "search" | "read" | "other";

function categorizeTool(name: string): ToolCategory {
  const lower = name.toLowerCase();
  if (/patch|edit|write|apply|create|str_replace/.test(lower)) return "edit";
  if (/grep|glob|search|find|ripgrep/.test(lower)) return "search";
  if (/exec|run|bash|shell|command/.test(lower)) return "run";
  if (/view|read|list|cat|dir|\bls\b/.test(lower)) return "read";
  return "other";
}

// Aggregates the group's tool_call blocks into a Codex-style summary phrase.
function summarizeToolActivity(blocks: AgentChatBlockView[]): string {
  const counts: Record<ToolCategory, number> = { edit: 0, read: 0, search: 0, run: 0, other: 0 };
  let calls = 0;
  for (const block of blocks) {
    if (block.kind !== "tool_call") continue;
    calls += 1;
    counts[categorizeTool(block.title)] += 1;
  }
  // If a group somehow carries only results, fall back to counting them.
  if (calls === 0) {
    counts.other = blocks.length;
  }
  const parts: string[] = [];
  const plural = (n: number, singular: string) => `${n} ${singular}${n === 1 ? "" : "s"}`;
  if (counts.edit > 0) parts.push(`edited ${plural(counts.edit, "file")}`);
  if (counts.read > 0) parts.push(`read ${plural(counts.read, "file")}`);
  if (counts.search > 0) parts.push(plural(counts.search, "search").replace("searchs", "searches"));
  if (counts.run > 0) parts.push(`ran ${plural(counts.run, "command")}`);
  if (counts.other > 0) parts.push(plural(counts.other, "tool call"));
  const joined = parts.join(", ");
  return joined.length === 0 ? "Tool activity" : joined.charAt(0).toUpperCase() + joined.slice(1);
}
