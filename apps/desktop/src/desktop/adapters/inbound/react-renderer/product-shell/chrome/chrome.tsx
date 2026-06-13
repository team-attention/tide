import type { ProductShellViewModel } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { MenuAnchorRect, ProductShellHandlers } from "../support/types.ts";
import type { ReactElement, ReactNode } from "react";
import { FolderOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

// Fixed top-right window controls: open/close the Workbench and the FileTree. These are
// window-level affordances, not column content, so their position is stable regardless
// of which panels are open. (The workbench's own controls — layout toggle / fullscreen /
// New Pane — live in the workbench header, not here. See workbench-dock-parity.md.)
export function createWindowChromeToggles(
  viewModel: ProductShellViewModel,
  handlers: ProductShellHandlers,
): ReactElement {
  const toggle = (
    label: string,
    icon: ReactElement,
    active: boolean,
    onClick: () => void,
  ): ReactElement => (
    <button
      className={["top-row-button", "window-toggle", active ? "window-toggle--active" : ""]
        .filter(Boolean)
        .join(" ")}
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
    >
      {icon}
    </button>
  );
  return (
    <div className="tide-window-toggles" aria-label="Window panels">
      {toggle(
        viewModel.workbenchOpen ? "Close Workbench" : "Open Workbench",
        viewModel.workbenchOpen ? (
          <PanelRightClose size={15} strokeWidth={1.9} />
        ) : (
          <PanelRightOpen size={15} strokeWidth={1.9} />
        ),
        viewModel.workbenchOpen,
        handlers.onWorkbenchToggle,
      )}
      {toggle(
        viewModel.fileTreeOpen ? "Close FileTree" : "Open FileTree",
        <FolderOpen size={15} strokeWidth={1.9} />,
        viewModel.fileTreeOpen,
        handlers.onFileTreeToggle,
      )}
    </div>
  );
}

export function createColumnResizeHandle(
  edge: "left" | "workbench" | "fileTree",
  side: "left" | "right",
  handlers: ProductShellHandlers,
): ReactElement {
  return (
    <div
      className={`column-resize-handle column-resize-handle--${side}`}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize column"
      data-resize-edge={edge}
      onPointerDown={(event: { clientX: number; preventDefault: () => void }) =>
        handlers.onResizeStart(edge, event)
      }
    />
  );
}

// The window is frameless (titleBarStyle: "hidden") and the macOS traffic lights
// are positioned by Electron inside this top row. Reserve their footprint with a
// drag-region spacer instead of drawing our own dots (which would double them).
export function createTrafficControls(): ReactElement {
  return <div className="traffic-controls" aria-hidden="true" />;
}

export function menuAnchorFromEvent(event: { currentTarget: HTMLElement }): MenuAnchorRect {
  const rect = event.currentTarget.getBoundingClientRect();
  return { left: rect.left, top: rect.top, bottom: rect.bottom, right: rect.right };
}

export function createIconButton(
  label: string,
  icon: ReactNode,
  onClick?: (event: { currentTarget: HTMLElement }) => void,
  className = "icon-button",
): ReactElement {
  return (
    <button className={className} type="button" title={label} aria-label={label} onClick={onClick}>
      {icon}
    </button>
  );
}
