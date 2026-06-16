import type { ProductShellViewModel } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { ProductShellHandlers } from "../support/types.ts";
import type { ReactElement } from "react";
import { useState } from "react";
import { ExternalLink, FilePlus, FileText, FolderOpen, GitBranchPlus, Square, Terminal } from "lucide-react";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

// Default Launcher shown when the Workbench has no visible Pane yet. Mirrors the
// backend launcher action set so the empty Workbench is never a dead end.
export function emptyWorkbenchLauncherPane(): NonNullable<
  ProductShellViewModel["appChrome"]["activeWorkbenchPane"]
> {
  return {
    paneId: "workbench-launcher-empty",
    kind: "launcher",
    title: "Workbench launcher",
    revision: "workbench-launcher-empty",
    actions: [
      { actionId: "open_browser", label: "Browser", description: "Open a Browser Pane", enabled: true },
      { actionId: "open_editor", label: "Editor", description: "Pick a file from the FileTree to edit", enabled: true },
      { actionId: "open_terminal", label: "Terminal", description: "Open a visible Terminal Pane", enabled: true },
      { actionId: "open_diff", label: "Diff", description: "Available after a file edit or review target", enabled: false },
    ],
  } as NonNullable<ProductShellViewModel["appChrome"]["activeWorkbenchPane"]>;
}

export function WorkbenchLauncherPane(props: {
  pane: NonNullable<ProductShellViewModel["appChrome"]["activeWorkbenchPane"]>;
  handlers: ProductShellHandlers;
}): ReactElement {
  const actions = props.pane.actions ?? [];
  // New File is a renderer-handled launcher action (create + open a blank file under
  // the current folder), so it appears on every launcher — the empty Workbench default
  // and a backend launcher alike (spec: workbench-new-file.md). It toggles an inline
  // path input; Enter hands the path to onCreateFile, which opens it in an Editor Pane.
  const [newFileActive, setNewFileActive] = useState(false);
  const [newFileDraft, setNewFileDraft] = useState("");
  const closeNewFile = () => {
    setNewFileActive(false);
    setNewFileDraft("");
  };
  const submitNewFile = () => {
    const path = newFileDraft.trim();
    if (path.length > 0) {
      props.handlers.onCreateFile(path);
    }
    closeNewFile();
  };
  return (
    <div className="workbench-pane-content workbench-pane-content--launcher">
      <p className="workbench-launcher-hint">Open a pane</p>
      <div className="workbench-launcher-actions" aria-label="Workbench Launcher Actions">
        {actions.map((action) => (
          <button
            key={action.actionId}
            className="workbench-launcher-action"
            type="button"
            disabled={!action.enabled}
            data-launcher-action={action.actionId}
            onClick={() => props.handlers.onLauncherAction(action.actionId)}
          >
            <span className="workbench-launcher-action__icon" aria-hidden>
              {launcherActionIcon(action.actionId)}
            </span>
            <span className="workbench-launcher-action__copy">
              <span className="workbench-launcher-action__label">{action.label}</span>
              <span className="workbench-launcher-action__description">{action.description}</span>
            </span>
          </button>
        ))}
        <button
          className="workbench-launcher-action"
          type="button"
          data-launcher-action="new_file"
          onClick={() => setNewFileActive(true)}
        >
          <span className="workbench-launcher-action__icon" aria-hidden>
            <FilePlus size={15} strokeWidth={1.9} />
          </span>
          <span className="workbench-launcher-action__copy">
            <span className="workbench-launcher-action__label">New file</span>
            <span className="workbench-launcher-action__description">Create a new file in the current folder</span>
          </span>
        </button>
      </div>
      {newFileActive ? (
        <input
          className="workbench-launcher-new-file-input"
          autoFocus
          spellCheck={false}
          placeholder="new-file.txt — Enter to create"
          aria-label="New file path"
          value={newFileDraft}
          onChange={(event) => setNewFileDraft(event.currentTarget.value)}
          onBlur={closeNewFile}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submitNewFile();
            } else if (event.key === "Escape") {
              event.preventDefault();
              closeNewFile();
            }
          }}
        />
      ) : null}
    </div>
  );
}

function launcherActionIcon(actionId: string): ReactElement {
  switch (actionId) {
    case "open_browser":
      return <ExternalLink size={15} strokeWidth={1.9} />;
    case "open_editor":
      return <FileText size={15} strokeWidth={1.9} />;
    case "open_terminal":
      return <Terminal size={15} strokeWidth={1.9} />;
    case "open_diff":
      return <GitBranchPlus size={15} strokeWidth={1.9} />;
    case "open_file_tree":
      return <FolderOpen size={15} strokeWidth={1.9} />;
    default:
      return <Square size={15} strokeWidth={1.9} />;
  }
}
