import type { ProductShellViewModel } from "../../../../../application/domains/product-shell/product-shell-state.ts";
import type { ProductShellHandlers } from "../types.ts";
import { createElement } from "react";
import type { ReactElement } from "react";
import { Search } from "lucide-react";
import { fileIconFor } from "../../file-icons.ts";
import { WorkbenchBrowserPane } from "./browser-pane.ts";
import { WorkbenchEditorPane } from "./editor-pane.ts";
import { WorkbenchDiffPane } from "./diff-pane.ts";
import { WorkbenchTerminalPane } from "./terminal-pane.ts";
import { WorkbenchLauncherPane } from "./launcher-pane.ts";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

// In-pane editor file picker: the Launcher pad becomes a searchable file list. The
// search input is autofocused; clicking a file opens it in the Editor (the backend
// consumes the launcher). Mirrors the preview the user approved.
export function createEditorPickerPane(
  editorPicker: NonNullable<ProductShellViewModel["editorPicker"]>,
  handlers: ProductShellHandlers,
): ReactElement {
  return createElement(
    "div",
    { className: "workbench-pane-content editor-picker" },
    createElement(
      "label",
      { className: "editor-picker__search" },
      createElement(Search, { size: 14, strokeWidth: 1.9, "aria-hidden": true }),
      createElement("input", {
        className: "editor-picker__input",
        type: "search",
        "aria-label": "Filter files to open",
        placeholder: "Filter files…",
        autoFocus: true,
        spellCheck: false,
        value: editorPicker.filter,
        onChange: (event: { currentTarget: { value: string } }) =>
          handlers.onEditorPickerFilter(event.currentTarget.value),
      }),
    ),
    createElement(
      "div",
      { className: "editor-picker__list", role: "listbox", "aria-label": "Files" },
      editorPicker.files.length === 0
        ? createElement(
            "p",
            { className: "editor-picker__empty" },
            editorPicker.filter.trim().length === 0 ? "No files here." : "No matching files.",
          )
        : editorPicker.files.map((file) =>
            createElement(
              "button",
              {
                key: file.relativePath,
                type: "button",
                className: "editor-picker__row",
                role: "option",
                title: file.relativePath,
                onClick: () => handlers.onEditorPickerSelect(file.relativePath),
              },
              createElement(fileIconFor(file.name), { size: 14, strokeWidth: 1.8, "aria-hidden": true }),
              createElement("span", { className: "editor-picker__name" }, file.name),
              createElement("span", { className: "editor-picker__path" }, file.relativePath),
            ),
          ),
    ),
  );
}

export function createWorkbenchPaneContent(
  pane: NonNullable<ProductShellViewModel["appChrome"]["activeWorkbenchPane"]>,
  handlers: ProductShellHandlers,
  editorDraft: ProductShellViewModel["editorDrafts"][string] | undefined,
): ReactElement {
  switch (pane.kind) {
    case "browser":
      // Key by paneId so a different/new browser pane fully remounts (fresh
      // webview + initial src) instead of reusing the prior pane's webview,
      // which left the old page showing after close-and-reopen.
      return createElement(WorkbenchBrowserPane, { key: pane.paneId, pane, handlers });
    case "editor":
      return createElement(WorkbenchEditorPane, { pane, draft: editorDraft, handlers });
    case "diff":
      return createElement(WorkbenchDiffPane, { pane });
    case "terminal":
      return createElement(WorkbenchTerminalPane, { pane, handlers });
    case "launcher":
      return createElement(WorkbenchLauncherPane, { pane, handlers });
    default:
      return createElement(
        "div",
        { className: "workbench-pane-content workbench-pane-content--generic" },
        createElement("div", { className: "workbench-column__kind" }, pane.kind),
        createElement("h2", null, pane.title),
      );
  }
}
