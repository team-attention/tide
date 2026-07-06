import type { ProductShellViewModel } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { GitChangesView, ProductShellHandlers } from "../support/types.ts";
import type { ReactElement } from "react";
import { styled } from "styled-components";
import { Search, X } from "lucide-react";
import { fileIconFor } from "../../support/file-icons.ts";
import { WorkbenchBrowserPane } from "./browser-pane.tsx";
import { WorkbenchEditorPane } from "./editor-pane.tsx";
import { WorkbenchImagePane } from "./image-pane.tsx";
import { WorkbenchDiffPane } from "./diff-pane.tsx";
import { WorkbenchTerminalPane } from "./terminal-pane.tsx";
import { WorkbenchLauncherPane } from "./launcher-pane.tsx";
import { ChangesPanel } from "./changes-panel.tsx";
import { ReviewPanel } from "./review-panel.tsx";
import { ErrorBoundary } from "../support/error-boundary.tsx";
import { WorkbenchPaneKindLabel, WorkbenchPaneSurface } from "./workbench-pane.parts.tsx";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

// In-pane editor file picker: the Launcher pad becomes a searchable file list. The
// search input is autofocused; clicking a file opens it in the Editor (the backend
// consumes the launcher). Mirrors the preview the user approved.
export function createEditorPickerPane(
  editorPicker: NonNullable<ProductShellViewModel["editorPicker"]>,
  handlers: ProductShellHandlers,
): ReactElement {
  return (
    <EditorPickerPane data-pane-surface-kind="editor-picker" data-editor-picker="true">
      <EditorPickerToolbar>
        <EditorPickerSearch>
          <Search size={14} strokeWidth={1.9} aria-hidden />
          <EditorPickerInput
            data-editor-picker-input="true"
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
        </EditorPickerSearch>
        <EditorPickerCloseButton
          data-editor-picker-close="true"
          type="button"
          title="Close picker"
          aria-label="Close picker"
          onClick={handlers.onEditorPickerCancel}
        >
          <X size={14} strokeWidth={2.1} aria-hidden />
        </EditorPickerCloseButton>
      </EditorPickerToolbar>
      <EditorPickerList role="listbox" aria-label="Files">
        {editorPicker.files.length === 0 ? (
          <EditorPickerEmpty>
            {editorPicker.filter.trim().length === 0 ? "No files here." : "No matching files."}
          </EditorPickerEmpty>
        ) : (
          editorPicker.files.map((file) => {
            const Icon = fileIconFor(file.name);
            return (
              <EditorPickerFileButton
                key={file.relativePath}
                type="button"
                data-editor-picker-row="true"
                role="option"
                title={file.relativePath}
                onClick={() => handlers.onEditorPickerSelect(file.relativePath)}
              >
                <Icon size={14} strokeWidth={1.8} aria-hidden />
                <EditorPickerFileName data-editor-picker-name="true">{file.name}</EditorPickerFileName>
                <EditorPickerFilePath>{file.relativePath}</EditorPickerFilePath>
              </EditorPickerFileButton>
            );
          })
        )}
      </EditorPickerList>
    </EditorPickerPane>
  );
}

export function createWorkbenchPaneContent(
  pane: NonNullable<ProductShellViewModel["appChrome"]["activeWorkbenchPane"]>,
  handlers: ProductShellHandlers,
  editorDraft: ProductShellViewModel["editorDrafts"][string] | undefined,
  gitChanges: GitChangesView | null,
  threadId: string | null = null,
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
      <WorkbenchPaneContent
        pane={pane}
        handlers={handlers}
        editorDraft={editorDraft}
        gitChanges={gitChanges}
        threadId={threadId}
      />
    </ErrorBoundary>
  );
}

function WorkbenchPaneContent(props: {
  pane: NonNullable<ProductShellViewModel["appChrome"]["activeWorkbenchPane"]>;
  handlers: ProductShellHandlers;
  editorDraft: ProductShellViewModel["editorDrafts"][string] | undefined;
  gitChanges: GitChangesView | null;
  threadId: string | null;
}): ReactElement {
  const { pane, handlers, editorDraft, gitChanges, threadId } = props;
  switch (pane.kind) {
    case "browser":
      // Key by paneId so a different/new browser pane fully remounts (fresh
      // webview + initial src) instead of reusing the prior pane's webview,
      // which left the old page showing after close-and-reopen.
      return <WorkbenchBrowserPane key={pane.paneId} pane={pane} handlers={handlers} threadId={threadId} />;
    case "editor":
      return (
        <WorkbenchEditorPane
          pane={pane}
          draft={editorDraft}
          handlers={handlers}
          gitDiffTarget={gitDiffTargetForPane(pane, gitChanges)}
        />
      );
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
          onOpenReview={handlers.onOpenReview}
          onGitStageFile={handlers.onGitStageFile}
          onGitUnstageFile={handlers.onGitUnstageFile}
          onGitDiscardFile={handlers.onGitDiscardFile}
          onGitApplyHunk={handlers.onGitApplyHunk}
          onGitGenerateCommitMessage={handlers.onGitGenerateCommitMessage}
          onGitCommit={handlers.onGitCommit}
          onGitPushTarget={handlers.onGitPushTarget}
          onGitPush={handlers.onGitPush}
        />
      );
    case "review":
      return (
        <ReviewPanel
          key={pane.cwd ?? ""}
          cwd={pane.cwd ?? ""}
          agentId={pane.agentId}
          handlers={handlers}
        />
      );
    default:
      return (
        <WorkbenchPaneSurface data-pane-surface-kind="generic">
          <WorkbenchPaneKindLabel>{pane.kind}</WorkbenchPaneKindLabel>
          <h2>{pane.title}</h2>
        </WorkbenchPaneSurface>
      );
  }
}

function gitDiffTargetForPane(
  pane: NonNullable<ProductShellViewModel["appChrome"]["activeWorkbenchPane"]>,
  gitChanges: GitChangesView | null,
): { cwd: string; relativePath: string; changeKey: string } | undefined {
  if (pane.kind !== "editor" || gitChanges === null || typeof pane.relativePath !== "string") {
    return undefined;
  }
  if (pane.root !== undefined && pane.root !== gitChanges.cwd) {
    return undefined;
  }
  const change = gitChanges.files.find((file) => file.path === pane.relativePath);
  if (change === undefined || change.status === "deleted") {
    return undefined;
  }
  return {
    cwd: gitChanges.cwd,
    relativePath: pane.relativePath,
    changeKey: [
      gitChanges.revision,
      gitChanges.cwd,
      pane.relativePath,
      change.status,
      change.additions ?? 0,
      change.deletions ?? 0,
    ].join(":"),
  };
}

const EditorPickerPane = styled(WorkbenchPaneSurface)`
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 8px 8px;
`;

const EditorPickerToolbar = styled.div`
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
`;

const EditorPickerSearch = styled.label`
  height: 34px;
  min-width: 0;
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border: 1px solid var(--tide-line);
  border-radius: 9px;
  background: var(--tide-surface);
  color: var(--tide-muted);
`;

const EditorPickerInput = styled.input`
  min-width: 0;
  flex: 1 1 auto;
  border: 0;
  background: transparent;
  color: var(--tide-text);
  font-size: 13px;
  outline: none;
`;

const EditorPickerCloseButton = styled.button`
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--tide-line);
  border-radius: 9px;
  background: var(--tide-surface);
  color: var(--tide-muted);
  cursor: pointer;

  &:hover {
    background: var(--tide-selection);
    color: var(--tide-text);
  }
`;

const EditorPickerList = styled.div`
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 1px;
`;

const EditorPickerEmpty = styled.p`
  margin: 14px 6px;
  color: var(--tide-muted);
  font-size: 13px;
`;

const EditorPickerFileButton = styled.button`
  width: 100%;
  height: 30px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--tide-text);
  cursor: pointer;
  text-align: left;

  &:hover {
    background: var(--tide-selection);
  }

  svg {
    flex: 0 0 auto;
    color: var(--tide-muted);
  }
`;

const EditorPickerFileName = styled.span`
  flex: 0 0 auto;
  font-size: 13px;
  white-space: nowrap;
`;

const EditorPickerFilePath = styled.span`
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  color: var(--tide-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
`;
