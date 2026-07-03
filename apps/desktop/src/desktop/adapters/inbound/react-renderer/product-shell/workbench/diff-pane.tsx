import type { ProductShellViewModel } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { ReactElement } from "react";
import { styled } from "styled-components";
import { createWorkbenchPaneHeading, createWorkbenchPaneMeta, formatBeforeAfterBytes } from "./pane-chrome.tsx";
import { guessLanguage, highlightToHtml } from "../../support/code-highlight.ts";
import { WorkbenchPaneSurface } from "./workbench-pane.parts.tsx";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

export function WorkbenchDiffPane(props: {
  pane: NonNullable<ProductShellViewModel["appChrome"]["activeWorkbenchPane"]>;
}): ReactElement {
  return (
    <DiffPaneSurface data-pane-surface-kind="diff">
      {createWorkbenchPaneHeading("diff", props.pane.title, props.pane.truncated ? "truncated" : "bounded")}
      {createWorkbenchPaneMeta([
        ["Path", props.pane.relativePath ?? props.pane.filePath],
        ["Bytes", formatBeforeAfterBytes(props.pane.beforeByteLength, props.pane.afterByteLength)],
        ["Revision", props.pane.revision],
      ])}
      {props.pane.diffText ? createDiffView(props.pane.diffText) : null}
    </DiffPaneSurface>
  );
}

type DiffLineKind = "header" | "hunk" | "added" | "removed" | "context";

function classifyDiffLine(line: string): DiffLineKind {
  if (line.startsWith("+++") || line.startsWith("---")) {
    return "header";
  }
  if (line.startsWith("@@")) {
    return "hunk";
  }
  if (line.startsWith("+")) {
    return "added";
  }
  if (line.startsWith("-")) {
    return "removed";
  }
  return "context";
}

interface DiffRow {
  kind: DiffLineKind;
  oldNo?: number;
  newNo?: number;
  text: string;
}

// Parses a unified diff into rows carrying old/new line numbers (from the @@
// hunk ranges), so the view can render GitHub/VS Code-style line-number gutters.
function parseDiffRows(diffText: string): { rows: DiffRow[]; adds: number; dels: number } {
  const rows: DiffRow[] = [];
  let oldNo = 0;
  let newNo = 0;
  let adds = 0;
  let dels = 0;
  for (const line of diffText.split("\n")) {
    const kind = classifyDiffLine(line);
    if (kind === "header") {
      // The +++/--- file lines duplicate the pane's path breadcrumb — skip them.
      continue;
    }
    if (kind === "hunk") {
      const match = line.match(/@@\s*-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s*@@/);
      if (match) {
        oldNo = Number(match[1]);
        newNo = Number(match[2]);
      }
      rows.push({ kind, text: line });
      continue;
    }
    if (kind === "added") {
      adds += 1;
      rows.push({ kind, newNo, text: line.slice(1) });
      newNo += 1;
      continue;
    }
    if (kind === "removed") {
      dels += 1;
      rows.push({ kind, oldNo, text: line.slice(1) });
      oldNo += 1;
      continue;
    }
    const text = line.startsWith(" ") ? line.slice(1) : line;
    rows.push({ kind: "context", oldNo, newNo, text });
    oldNo += 1;
    newNo += 1;
  }
  return { rows, adds, dels };
}

// Renders the bounded unified diff GitHub/VS Code-style: a stat header, then
// rows with old/new line-number gutters, a change marker, and syntax-highlighted
// code. Added/removed lines read distinctly; hunk headers act as separators.
// Exported so the Changes view reuses the exact same diff rendering.
export function createDiffView(diffText: string): ReactElement {
  const { rows, adds, dels } = parseDiffRows(diffText);
  const lang = guessLanguage(
    rows
      .filter((row) => row.kind === "added" || row.kind === "removed" || row.kind === "context")
      .map((row) => row.text)
      .join("\n"),
  );
  return (
    <DiffViewFrame aria-label="Diff view" role="group" data-diff-view="true">
      <DiffStatBar data-diff-stat="true">
        {adds > 0 ? <DiffStatAdd>{`+${adds}`}</DiffStatAdd> : null}
        {dels > 0 ? <DiffStatDel>{`−${dels}`}</DiffStatDel> : null}
        <DiffStatLabel>
          {adds + dels === 1 ? "1 change" : `${adds + dels} changes`}
        </DiffStatLabel>
      </DiffStatBar>
      <DiffBody data-diff-body="true">
        {rows.map((row, index) => {
          if (row.kind === "hunk") {
            return (
              <DiffHunkRow key={index} data-diff-row="hunk">
                <DiffLineText data-diff-line-text="true">{row.text}</DiffLineText>
              </DiffHunkRow>
            );
          }
          const marker = row.kind === "added" ? "+" : row.kind === "removed" ? "−" : "";
          return (
            <DiffLineRow key={index} data-diff-row={row.kind}>
              <DiffLineGutter aria-hidden="true" data-diff-gutter="true">{row.oldNo ?? ""}</DiffLineGutter>
              <DiffLineGutter aria-hidden="true" data-diff-gutter="true">{row.newNo ?? ""}</DiffLineGutter>
              <DiffLineMarker aria-hidden="true">{marker}</DiffLineMarker>
              <DiffLineText
                data-diff-line-text="true"
                dangerouslySetInnerHTML={{ __html: highlightToHtml(row.text, lang) }}
              />
            </DiffLineRow>
          );
        })}
      </DiffBody>
    </DiffViewFrame>
  );
}

const DiffPaneSurface = styled(WorkbenchPaneSurface)``;

const DiffViewFrame = styled.div`
  min-height: 168px;
  max-height: 420px;
  overflow: auto;
  border: 1px solid var(--tide-line);
  border-radius: 10px;
  background: var(--tide-bg);
  font: 12px/1.6 "Roboto Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
`;

const DiffStatBar = styled.div`
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--tide-line);
  background: var(--tide-surface);
  font-family: var(--tide-sans, Inter, system-ui, sans-serif);
  font-size: 12px;
  font-weight: 500;
`;

const DiffStatAdd = styled.span`
  color: var(--tide-diff-add);
  font-variant-numeric: tabular-nums;
`;

const DiffStatDel = styled.span`
  color: var(--tide-diff-del);
  font-variant-numeric: tabular-nums;
`;

const DiffStatLabel = styled.span`
  color: var(--tide-muted);
  font-weight: 400;
`;

const DiffBody = styled.div``;

const DiffLineRow = styled.div`
  min-height: 19px;
  display: flex;
  align-items: baseline;
  overflow-wrap: normal;
  white-space: pre;

  &[data-diff-row="added"] {
    background: color-mix(in srgb, var(--tide-diff-add) 11%, transparent);
    box-shadow: inset 2px 0 0 color-mix(in srgb, var(--tide-diff-add) 55%, transparent);
  }

  &[data-diff-row="removed"] {
    background: color-mix(in srgb, var(--tide-danger) 10%, transparent);
    box-shadow: inset 2px 0 0 color-mix(in srgb, var(--tide-danger) 55%, transparent);
  }
`;

const DiffLineGutter = styled.span`
  width: 40px;
  flex: 0 0 auto;
  padding: 0 8px 0 0;
  color: var(--tide-muted);
  font-variant-numeric: tabular-nums;
  opacity: 0.65;
  text-align: right;
  user-select: none;
`;

const DiffLineMarker = styled.span`
  width: 1.4ch;
  flex: 0 0 auto;
  color: var(--tide-muted);
  text-align: center;
  user-select: none;

  ${DiffLineRow}[data-diff-row="added"] & {
    color: var(--tide-diff-add);
  }

  ${DiffLineRow}[data-diff-row="removed"] & {
    color: var(--tide-danger);
  }
`;

const DiffLineText = styled.span`
  min-width: 0;
  flex: 1 1 auto;
  padding-right: 12px;
  white-space: pre-wrap;
  word-break: break-word;
`;

const DiffHunkRow = styled.div`
  display: flex;
  align-items: baseline;
  min-height: 19px;
  margin: 2px 0;
  padding: 2px 12px;
  border-block: 1px solid var(--tide-line);
  background: color-mix(in srgb, var(--tide-action) 8%, transparent);
  color: color-mix(in srgb, var(--tide-action) 80%, var(--tide-muted));
  overflow-wrap: normal;
  white-space: pre;
`;
