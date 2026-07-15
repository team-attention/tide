import { EMPTY_WORKBENCH_LAUNCHER_PANE_ID, type ProductShellViewModel } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { ProductShellHandlers } from "../support/types.ts";
import type { ReactElement } from "react";
import { styled } from "styled-components";
import { ExternalLink, FilePlus, FileText, FolderOpen, GitBranchPlus, Square, Terminal } from "lucide-react";
import { WorkbenchPaneSurface } from "./workbench-pane.parts.tsx";
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
      { actionId: "open_diff", label: "Diff", description: "View working-tree changes (git)", enabled: true },
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
    <WorkbenchLauncherSurface data-pane-surface-kind="launcher">
      <WorkbenchLauncherHint>Open a pane</WorkbenchLauncherHint>
      <WorkbenchLauncherActions aria-label="Workbench Launcher Actions">
        {actions.map((action) => (
          <WorkbenchLauncherActionButton
            key={action.actionId}
            type="button"
            disabled={!action.enabled}
            data-launcher-action={action.actionId}
            onClick={() => props.handlers.onLauncherAction(action.actionId, props.pane.paneId)}
          >
            <WorkbenchLauncherActionIcon aria-hidden>
              {launcherActionIcon(action.actionId)}
            </WorkbenchLauncherActionIcon>
            <WorkbenchLauncherActionCopy>
              <WorkbenchLauncherActionLabel>{action.label}</WorkbenchLauncherActionLabel>
              <WorkbenchLauncherActionDescription>{action.description}</WorkbenchLauncherActionDescription>
            </WorkbenchLauncherActionCopy>
          </WorkbenchLauncherActionButton>
        ))}
        <WorkbenchLauncherActionButton
          type="button"
          data-launcher-action="new_file"
          onClick={() => props.handlers.onNewUntitledFile()}
        >
          <WorkbenchLauncherActionIcon aria-hidden>
            <FilePlus size={15} strokeWidth={1.9} />
          </WorkbenchLauncherActionIcon>
          <WorkbenchLauncherActionCopy>
            <WorkbenchLauncherActionLabel>New file</WorkbenchLauncherActionLabel>
            <WorkbenchLauncherActionDescription>Open a blank file (name it when you save)</WorkbenchLauncherActionDescription>
          </WorkbenchLauncherActionCopy>
        </WorkbenchLauncherActionButton>
      </WorkbenchLauncherActions>
    </WorkbenchLauncherSurface>
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

const WorkbenchLauncherSurface = styled(WorkbenchPaneSurface)``;

const WorkbenchLauncherHint = styled.p`
  margin: 0;
  color: var(--tide-muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
`;

const WorkbenchLauncherActions = styled.div`
  min-width: 0;
  display: grid;
  gap: 6px;
`;

const WorkbenchLauncherActionButton = styled.button`
  min-width: 0;
  min-height: 40px;
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border: 1px solid var(--tide-line);
  border-radius: 8px;
  background: var(--tide-bg);
  color: var(--tide-text);
  cursor: pointer;
  font: inherit;
  text-align: left;
  transition: background-color 0.12s ease, border-color 0.12s ease;

  &:hover:not(:disabled) {
    border-color: var(--tide-line-strong);
    background: var(--tide-hover);
  }

  &:disabled {
    cursor: default;
    opacity: 0.48;
  }
`;

const WorkbenchLauncherActionIcon = styled.span`
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--tide-muted);
`;

const WorkbenchLauncherActionCopy = styled.span`
  min-width: 0;
  display: grid;
  gap: 2px;
`;

const WorkbenchLauncherActionLabel = styled.span`
  min-width: 0;
  overflow: hidden;
  font-size: 13px;
  font-weight: 580;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const WorkbenchLauncherActionDescription = styled.span`
  min-width: 0;
  overflow: hidden;
  color: var(--tide-muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
`;
