import type { ProductShellViewModel } from "../../../../../application/domains/product-shell/product-shell.ts";
import { createElement } from "react";
import type { ReactElement } from "react";
import { createWorkbenchPaneHeading, createWorkbenchPaneMeta, formatBeforeAfterBytes } from "./pane-chrome.ts";
import { guessLanguage, highlightToHtml } from "../../support/code-highlight.ts";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

export function WorkbenchDiffPane(props: {
  pane: NonNullable<ProductShellViewModel["appChrome"]["activeWorkbenchPane"]>;
}): ReactElement {
  return createElement(
    "div",
    { className: "workbench-pane-content workbench-pane-content--diff" },
    createWorkbenchPaneHeading("diff", props.pane.title, props.pane.truncated ? "truncated" : "bounded"),
    createWorkbenchPaneMeta([
      ["Path", props.pane.relativePath ?? props.pane.filePath],
      ["Bytes", formatBeforeAfterBytes(props.pane.beforeByteLength, props.pane.afterByteLength)],
      ["Revision", props.pane.revision],
    ]),
    props.pane.diffText ? createDiffView(props.pane.diffText) : null,
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
function createDiffView(diffText: string): ReactElement {
  const { rows, adds, dels } = parseDiffRows(diffText);
  const lang = guessLanguage(
    rows
      .filter((row) => row.kind === "added" || row.kind === "removed" || row.kind === "context")
      .map((row) => row.text)
      .join("\n"),
  );
  return createElement(
    "div",
    { className: "workbench-diff", "aria-label": "Diff view", role: "group" },
    createElement(
      "div",
      { className: "workbench-diff__stat" },
      adds > 0 ? createElement("span", { className: "workbench-diff__stat-add" }, `+${adds}`) : null,
      dels > 0 ? createElement("span", { className: "workbench-diff__stat-del" }, `−${dels}`) : null,
      createElement("span", { className: "workbench-diff__stat-label" }, adds + dels === 1 ? "1 change" : `${adds + dels} changes`),
    ),
    createElement(
      "div",
      { className: "workbench-diff__body" },
      rows.map((row, index) => {
        if (row.kind === "hunk") {
          return createElement(
            "div",
            { key: index, className: "workbench-diff-row workbench-diff-row--hunk" },
            createElement("span", { className: "workbench-diff-row__text" }, row.text),
          );
        }
        const marker = row.kind === "added" ? "+" : row.kind === "removed" ? "−" : "";
        return createElement(
          "div",
          { key: index, className: `workbench-diff-row workbench-diff-row--${row.kind}` },
          createElement("span", { className: "workbench-diff-row__gutter", "aria-hidden": "true" }, row.oldNo ?? ""),
          createElement("span", { className: "workbench-diff-row__gutter", "aria-hidden": "true" }, row.newNo ?? ""),
          createElement("span", { className: "workbench-diff-row__marker", "aria-hidden": "true" }, marker),
          createElement("span", {
            className: "workbench-diff-row__text",
            dangerouslySetInnerHTML: { __html: highlightToHtml(row.text, lang) },
          }),
        );
      }),
    ),
  );
}
