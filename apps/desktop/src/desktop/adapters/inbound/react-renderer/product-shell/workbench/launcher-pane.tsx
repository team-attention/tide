import { EMPTY_WORKBENCH_LAUNCHER_PANE_ID, type ProductShellViewModel } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { ProductShellHandlers } from "../support/types.ts";
import type { ReactElement } from "react";
import { ExternalLink, FilePlus, FileText, FolderOpen, GitBranchPlus, Square, Terminal } from "lucide-react";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

// Default Launcher shown when the Workbench has no open Pane yet. Mirrors the
// backend launcher action set so the empty Workbench is never a dead end.
export function emptyWorkbenchLauncherPane(): NonNullable<
  ProductShellViewModel["appChrome"]["activeWorkbenchPane"]
> {
  return {
    paneId: EMPTY_WORKBENCH_LAUNCHER_PANE_ID,
    kind: "launcher",
    title: "Workbench launcher",
    revision: EMPTY_WORKBENCH_LAUNCHER_PANE_ID,
    actions: [
      { actionId: "open_browser", label: "Browser", description: "Open a Browser Pane", enabled: true },
      { actionId: "open_editor", label: "Editor", description: "Pick a file from the FileTree to edit", enabled: true },
      { actionId: "open_terminal", label: "Terminal", description: "Open a Terminal Pane", enabled: true },
      { actionId: "open_diff", label: "Diff", description: "Available after a file edit or review target", enabled: false },
    ],
  } as NonNullable<ProductShellViewModel["appChrome"]["activeWorkbenchPane"]>;
}

export function WorkbenchLauncherPane(props: {
  pane: NonNullable<ProductShellViewModel["appChrome"]["activeWorkbenchPane"]>;
  handlers: ProductShellHandlers;
}): ReactElement {
  const actions = props.pane.actions ?? [];
  // New File is a renderer-handled launcher action, so it appears on every launcher —
  // the empty Workbench default and a backend launcher alike. It opens a blank untitled
  // editor (named on save, VSCode-style), the same as the FileTree's New File (spec:
  // workbench-filetree-file-operations).
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
            onClick={() => props.handlers.onLauncherAction(action.actionId, props.pane.paneId)}
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
          onClick={() => props.handlers.onNewUntitledFile()}
        >
          <span className="workbench-launcher-action__icon" aria-hidden>
            <FilePlus size={15} strokeWidth={1.9} />
          </span>
          <span className="workbench-launcher-action__copy">
            <span className="workbench-launcher-action__label">New file</span>
            <span className="workbench-launcher-action__description">Open a blank file (name it when you save)</span>
          </span>
        </button>
      </div>
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
