import type { AgentChatBlockView } from "../../../../../application/domains/agent-chat/agent-chat.ts";
import { useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { styled } from "styled-components";
import { pickStringField, readToolFilePath, renderFileChip } from "./file-chip.tsx";
import { editDiffLines } from "./tool-diff.ts";
import { guessLanguage, highlightToHtml } from "../../support/code-highlight.ts";
import { ChevronDown, Wrench } from "lucide-react";
import { fileIconFor } from "../../support/file-icons.ts";
import {
  DiffBody,
  DiffLine,
  DiffLineSign,
  DiffLineText,
  DiffStat,
  DiffStatValue,
  ToolBody,
  ToolName,
  TranscriptTurn,
  TurnDiff,
} from "./transcript.parts.tsx";
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
    <TranscriptTurn
      key={block.blockId}
      $role="tool"
      $toolResult={isResult}
      data-transcript-turn="true"
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
      {isResult ? null : <ToolName>{block.title}</ToolName>}
      {body}
    </TranscriptTurn>
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
      <TurnDiff>
        <DiffStat>
          {adds > 0 ? <DiffStatValue $kind="add">{`+${adds}`}</DiffStatValue> : null}
          {dels > 0 ? <DiffStatValue $kind="del">{`-${dels}`}</DiffStatValue> : null}
        </DiffStat>
        <DiffBody>
          {diff.map((line, index) => (
            <DiffLine key={index} $kind={line.kind}>
              <DiffLineSign $kind={line.kind} aria-hidden>
                {line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}
              </DiffLineSign>
              <DiffLineText
                dangerouslySetInnerHTML={{ __html: highlightToHtml(line.text, diffLang) }}
              />
            </DiffLine>
          ))}
        </DiffBody>
      </TurnDiff>
    );
  }
  return (
    <ToolBody
      data-tool-body="true"
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
    <ToolActivityFrame
      data-block-role="tool"
      data-tool-count={blocks.length}
      data-tool-activity="true"
    >
      <ToolActivitySummaryButton
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <Wrench size={14} aria-hidden />
        <ToolActivitySummaryText data-tool-activity-summary="true">{summary}</ToolActivitySummaryText>
        <ToolActivityChevron $expanded={expanded} size={13} aria-hidden />
      </ToolActivitySummaryButton>
      {createFilesChangedList(blocks)}
      {expanded ? (
        <ToolActivityDetail>{blocks.map(createToolLogTurn)}</ToolActivityDetail>
      ) : null}
    </ToolActivityFrame>
  );
}

// Codex-style "files changed" list: the distinct files edited by this tool group.
function createFilesChangedList(blocks: AgentChatBlockView[]): ReactElement | null {
  const paths = distinctEditedPaths(blocks);
  if (paths.length === 0) {
    return null;
  }
  return (
    <ToolActivityFiles data-tool-activity-files="true">
      {paths.map((path) => {
        const slash = path.lastIndexOf("/");
        const name = slash === -1 ? path : path.slice(slash + 1);
        const dir = slash === -1 ? "" : path.slice(0, slash);
        const Icon = fileIconFor(name);
        return (
          <ToolActivityFileButton
            key={path}
            type="button"
            data-open-file={path}
            title={`Open ${name} in the Workbench`}
          >
            <Icon size={13} aria-hidden />
            <ToolActivityFileName>{name}</ToolActivityFileName>
            {dir.length > 0 ? <ToolActivityFileDir>{dir}</ToolActivityFileDir> : null}
          </ToolActivityFileButton>
        );
      })}
    </ToolActivityFiles>
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

const ToolActivityFrame = styled.article`
  width: min(760px, calc(100% - 32px));
  align-self: center;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const ToolActivitySummaryButton = styled.button`
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 2px;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--tide-muted);
  font-size: 13.5px;
  line-height: 20px;
  cursor: pointer;
  transition: color 0.12s ease;

  &:hover {
    color: var(--tide-text);
  }

  > svg:first-child {
    flex-shrink: 0;
    color: var(--tide-muted);
    opacity: 0.8;
  }
`;

const ToolActivitySummaryText = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ToolActivityChevron = styled(ChevronDown)<{ $expanded: boolean }>`
  flex-shrink: 0;
  opacity: 0.7;
  transform: ${({ $expanded }) => ($expanded ? "rotate(180deg)" : "none")};
  transition: transform 0.14s ease;
`;

const ToolActivityDetail = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-left: 4px;
`;

const ToolActivityFiles = styled.div`
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 4px 0;
  border: 1px solid var(--tide-line);
  border-radius: 10px;
  background: var(--tide-bg);
  overflow: hidden;
`;

const ToolActivityFileButton = styled.button`
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 13.5px;
  line-height: 18px;
  text-align: left;
  cursor: pointer;

  &:hover {
    background: var(--tide-selection);
  }

  > svg {
    flex-shrink: 0;
    color: var(--tide-muted);
  }
`;

const ToolActivityFileName = styled.span`
  flex: 0 0 auto;
  color: var(--tide-text);
  font-weight: 500;
  white-space: nowrap;
`;

const ToolActivityFileDir = styled.span`
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  color: var(--tide-muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
`;
