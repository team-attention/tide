import type { ProductShellViewModel } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { ProductShellHandlers } from "../support/types.ts";
import type { ReactElement } from "react";
import { Search, X } from "lucide-react";
import { fileIconFor } from "../../support/file-icons.ts";
import { WorkbenchBrowserPane } from "./browser-pane.tsx";
import { WorkbenchEditorPane } from "./editor-pane.tsx";
import { WorkbenchImagePane } from "./image-pane.tsx";
import { WorkbenchDiffPane } from "./diff-pane.tsx";
import { WorkbenchTerminalPane } from "./terminal-pane.tsx";
import { WorkbenchLauncherPane } from "./launcher-pane.tsx";
import { ChangesPanel } from "./changes-panel.tsx";
import { ErrorBoundary } from "../support/error-boundary.tsx";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

// In-pane editor file picker: the Launcher pad becomes a searchable file list. The
// search input is autofocused; clicking a file opens it in the Editor (the backend
// consumes the launcher). Mirrors the preview the user approved.
export function createEditorPickerPane(
  editorPicker: NonNullable<ProductShellViewModel["editorPicker"]>,
  handlers: ProductShellHandlers,
): ReactElement {
  return (
    <div className="workbench-pane-content editor-picker">
      <div className="editor-picker__toolbar">
        <label className="editor-picker__search">
          <Search size={14} strokeWidth={1.9} aria-hidden />
          <input
            className="editor-picker__input"
            type="search"
            aria-label="Filter files to open"
            placeholder="Filter files…"
            autoFocus
            spellCheck={false}
            value={editorPicker.filter}
            onChange={(event: { currentTarget: { value: string } }) =>
              handlers.onEditorPickerFilter(event.currentTarget.value)
            }
          />
        </label>
        <button
          className="editor-picker__close"
          type="button"
          title="Close picker"
          aria-label="Close picker"
          onClick={handlers.onEditorPickerCancel}
        >
          <X size={14} strokeWidth={2.1} aria-hidden />
        </button>
      </div>
      <div className="editor-picker__list" role="listbox" aria-label="Files">
        {editorPicker.files.length === 0 ? (
          <p className="editor-picker__empty">
            {editorPicker.filter.trim().length === 0 ? "No files here." : "No matching files."}
          </p>
        ) : (
          editorPicker.files.map((file) => {
            const Icon = fileIconFor(file.name);
            return (
              <button
                key={file.relativePath}
                type="button"
                className="editor-picker__row"
                role="option"
                title={file.relativePath}
                onClick={() => handlers.onEditorPickerSelect(file.relativePath)}
              >
                <Icon size={14} strokeWidth={1.8} aria-hidden />
                <span className="editor-picker__name">{file.name}</span>
                <span className="editor-picker__path">{file.relativePath}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

export function createWorkbenchPaneContent(
  pane: NonNullable<ProductShellViewModel["appChrome"]["activeWorkbenchPane"]>,
  handlers: ProductShellHandlers,
  editorDraft: ProductShellViewModel["editorDrafts"][string] | undefined,
): ReactElement {
  // Isolate each pane behind an error boundary: a throw in one pane's render/effect (e.g. a
  // <webview> guest method called before dom-ready) shows an inline fallback for THAT pane
  // instead of unmounting the whole app. resetKey=paneId so switching/reopening a pane
  // retries automatically. This is the single chokepoint for both Stacked and Split layouts.
  // The content MUST be a child COMPONENT (<WorkbenchPaneContent/>), not the result of a
  // function call passed as children — a boundary only catches throws from rendering its
  // descendants, so a thrown function-call result would escape past it to the parent.
  return (
    <ErrorBoundary resetKey={pane.paneId} label={`the ${pane.kind} pane`}>
      <WorkbenchPaneContent pane={pane} handlers={handlers} editorDraft={editorDraft} />
    </ErrorBoundary>
  );
}

function WorkbenchPaneContent(props: {
  pane: NonNullable<ProductShellViewModel["appChrome"]["activeWorkbenchPane"]>;
  handlers: ProductShellHandlers;
  editorDraft: ProductShellViewModel["editorDrafts"][string] | undefined;
}): ReactElement {
  const { pane, handlers, editorDraft } = props;
  switch (pane.kind) {
    case "browser":
      // Key by paneId so a different/new browser pane fully remounts (fresh
      // webview + initial src) instead of reusing the prior pane's webview,
      // which left the old page showing after close-and-reopen.
      return <WorkbenchBrowserPane key={pane.paneId} pane={pane} handlers={handlers} />;
    case "editor":
      return <WorkbenchEditorPane pane={pane} draft={editorDraft} handlers={handlers} />;
    case "image":
      return <WorkbenchImagePane pane={pane} handlers={handlers} />;
    case "diff":
      return <WorkbenchDiffPane pane={pane} />;
    case "terminal":
      return <WorkbenchTerminalPane pane={pane} handlers={handlers} />;
    case "launcher":
      return <WorkbenchLauncherPane pane={pane} handlers={handlers} />;
    case "changes":
      // Key by cwd so switching threads/projects fully resets the panel (selected file +
      // loaded diff) instead of showing stale state.
      return (
        <ChangesPanel
          key={pane.cwd ?? ""}
          cwd={pane.cwd ?? ""}
          onGitChanges={handlers.onGitChanges}
          onGitFileDiff={handlers.onGitFileDiff}
        />
      );
    default:
      return (
        <div className="workbench-pane-content workbench-pane-content--generic">
          <div className="workbench-column__kind">{pane.kind}</div>
          <h2>{pane.title}</h2>
        </div>
      );
  }
}
