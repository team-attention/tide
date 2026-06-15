import type { ProductShellViewModel } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { ProductShellHandlers } from "../support/types.ts";
import type { ReactElement } from "react";
import { ExternalLink, FileText, FolderOpen, GitBranchPlus, Square, Terminal } from "lucide-react";
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
