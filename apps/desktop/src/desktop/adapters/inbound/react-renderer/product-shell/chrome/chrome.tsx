import type { ProductShellViewModel } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { MenuAnchorRect, ProductShellHandlers } from "../support/types.ts";
import type { ReactElement, ReactNode } from "react";
import { Columns2, FolderOpen, Maximize2, Minimize2, MoreHorizontal, PanelRightClose, PanelRightOpen, Plus, Square } from "lucide-react";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

// Fixed top-right window controls. The right group is the window-level Workbench/FileTree
// open-close toggles (stable position regardless of which panels are open). When the
// Workbench is open AND there's room (showWorkbenchControls — the size cap), the left
// group adds the workbench's own chrome: a single Stacked⇄Split toggle, fullscreen, and
// New Pane — docked next to the panel toggles, in EVERY layout, so they read as native
// chrome (not a floating element) and never cover a column's tabs. Below the size cap the
// group is dropped so narrow windows keep their tabs. See workbench-dock-parity.md.
export function createWindowChromeToggles(
  viewModel: ProductShellViewModel,
  handlers: ProductShellHandlers,
  showWorkbenchControls: boolean,
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
  const isSplit = viewModel.workbenchLayoutMode === "split";
  return (
    <div className="tide-window-toggles" aria-label="Window panels">
      {showWorkbenchControls ? (
        <>
          {/* The workbench controls collapse into one trigger; hover (or keyboard focus)
              reveals the layout toggle, fullscreen, and New Pane in a popover — so a
              single ~28px button always fits the top-right and never crowds a column's
              tabs, at any size. */}
          <div className="workbench-controls-menu">
            <button
              className="top-row-button window-toggle"
              type="button"
              aria-haspopup="true"
              aria-label="Workbench controls"
              title="Workbench controls"
            >
              <MoreHorizontal size={15} strokeWidth={1.9} />
            </button>
            <div className="workbench-controls-menu__popover" role="group" aria-label="Workbench controls">
              {toggle(
                isSplit ? "Switch to Stacked" : "Switch to Split",
                isSplit ? <Columns2 size={15} strokeWidth={1.9} /> : <Square size={15} strokeWidth={1.9} />,
                false,
                () => handlers.onWorkbenchSetLayout(isSplit ? "stacked" : "split"),
              )}
              {toggle(
                viewModel.workbenchFullscreen ? "Exit fullscreen" : "Fullscreen pane",
                viewModel.workbenchFullscreen ? (
                  <Minimize2 size={15} strokeWidth={1.9} />
                ) : (
                  <Maximize2 size={15} strokeWidth={1.9} />
                ),
                viewModel.workbenchFullscreen,
                handlers.onWorkbenchFullscreenToggle,
              )}
              {toggle("New Pane", <Plus size={16} strokeWidth={1.9} />, false, handlers.onNewWorkbenchPane)}
            </div>
          </div>
          <span className="tide-window-toggles__divider" aria-hidden />
        </>
      ) : null}
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
