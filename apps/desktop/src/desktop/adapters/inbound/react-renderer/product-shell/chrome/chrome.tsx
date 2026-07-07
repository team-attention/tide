import type { ProductShellViewModel } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { MenuAnchorRect, ProductShellHandlers } from "../support/types.ts";
import { useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { styled } from "styled-components";
import { Columns2, FolderOpen, Maximize2, Minimize2, MoreHorizontal, PanelRightClose, PanelRightOpen, Plus, Square } from "lucide-react";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

// Fixed top-right window controls. The right group is the window-level Workbench/FileTree
// open-close toggles (stable position regardless of which panels are open) — always
// visible, since they carry panel open/closed state. When the Workbench is open the left
// group adds the workbench's own chrome: a single Stacked⇄Split toggle, fullscreen, and
// New Pane — docked next to the panel toggles so they read as native chrome. That trio
// renders inline only when there's room (inlineControls); it collapses into one "…"
// hover-menu when the column/pane it floats over is too narrow (Stacked) or in Split (it
// floats over the narrow top-right pane), so a cramped header keeps its tabs. See
// workbench-dock-parity.md.
export function createWindowChromeToggles(
  viewModel: ProductShellViewModel,
  handlers: ProductShellHandlers,
  showWorkbenchControls: boolean,
  inlineControls: boolean,
  collapseAll: boolean,
): ReactElement {
  const toggle = (
    label: string,
    icon: ReactElement,
    active: boolean,
    onClick: () => void,
  ): ReactElement => (
    <WindowToggleButton
      $active={active}
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      data-window-toggle-button="true"
    >
      {icon}
    </WindowToggleButton>
  );
  const isSplit = viewModel.workbenchLayoutMode === "split";
  // Narrow split (collapseAll): the cluster floats over a ~140px pane, too tight for
  // separate buttons, so EVERYTHING — the chrome trio AND the panel toggles — folds into
  // one "…". The corner pane then only reserves ~one button's width.
  if (collapseAll) {
    return (
      <WindowToggleCluster aria-label="Window panels" data-window-toggle-cluster="true">
        <WorkbenchControlsMenu isSplit={isSplit} handlers={handlers} viewModel={viewModel} includePanels />
      </WindowToggleCluster>
    );
  }
  return (
    <WindowToggleCluster aria-label="Window panels" data-window-toggle-cluster="true">
      {showWorkbenchControls ? (
        <>
          {/* Inline by default (every control one click away); collapse into one "…"
              hover-menu only when the rightmost column is too narrow to host them
              (inlineControls=false) so a cramped column keeps its tabs. */}
          {viewModel.workbenchFullscreen ? (
            // In fullscreen the workbench covers the window, so surface Exit DIRECTLY
            // — an obvious one-click way back out.
            toggle(
              "Exit fullscreen",
              <Minimize2 size={15} strokeWidth={1.9} />,
              true,
              handlers.onWorkbenchFullscreenToggle,
            )
          ) : inlineControls ? (
            <>
              {toggle(
                isSplit ? "Switch to Stacked" : "Switch to Split",
                isSplit ? <Columns2 size={15} strokeWidth={1.9} /> : <Square size={15} strokeWidth={1.9} />,
                false,
                () => handlers.onWorkbenchSetLayout(isSplit ? "stacked" : "split"),
              )}
              {toggle("Fullscreen pane", <Maximize2 size={15} strokeWidth={1.9} />, false, handlers.onWorkbenchFullscreenToggle)}
              {toggle("New Pane", <Plus size={16} strokeWidth={1.9} />, false, handlers.onNewWorkbenchPane)}
            </>
          ) : (
            <WorkbenchControlsMenu isSplit={isSplit} handlers={handlers} />
          )}
          <WindowToggleDivider aria-hidden />
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
    </WindowToggleCluster>
  );
}

// The top-right workbench controls: one trigger whose popover (CSS hover /
// focus-within) reveals the layout toggle, fullscreen, and New Pane. Pressing an
// action collapses the popover like a menu that closes on selection — `collapsed`
// overrides the hover/focus reveal, and is cleared when the
// pointer leaves so a fresh hover re-opens it.
function WorkbenchControlsMenu(props: {
  isSplit: boolean;
  handlers: ProductShellHandlers;
  viewModel?: ProductShellViewModel;
  includePanels?: boolean;
}): ReactElement {
  const { isSplit, handlers, viewModel, includePanels } = props;
  const [collapsed, setCollapsed] = useState(false);
  const action = (label: string, icon: ReactElement, onClick: () => void): ReactElement => (
    <WindowToggleButton
      $active={false}
      type="button"
      aria-label={label}
      aria-pressed={false}
      title={label}
      onClick={(event: { currentTarget: HTMLElement }) => {
        onClick();
        // Drop focus so :focus-within doesn't keep the popover open once collapsed.
        event.currentTarget.blur();
        setCollapsed(true);
      }}
      data-window-toggle-button="true"
    >
      {icon}
    </WindowToggleButton>
  );
  return (
    <WorkbenchControlsMenuFrame
      data-workbench-controls-menu="true"
      data-collapsed={collapsed ? "true" : undefined}
      onMouseLeave={() => setCollapsed(false)}
    >
      <WindowToggleButton
        $active={false}
        type="button"
        aria-haspopup="true"
        aria-label="Workbench controls"
        title="Workbench controls"
        data-window-toggle-button="true"
      >
        <MoreHorizontal size={15} strokeWidth={1.9} />
      </WindowToggleButton>
      <WorkbenchControlsPopover role="group" aria-label="Workbench controls">
        {action(
          isSplit ? "Switch to Stacked" : "Switch to Split",
          isSplit ? <Columns2 size={15} strokeWidth={1.9} /> : <Square size={15} strokeWidth={1.9} />,
          () => handlers.onWorkbenchSetLayout(isSplit ? "stacked" : "split"),
        )}
        {action("Fullscreen pane", <Maximize2 size={15} strokeWidth={1.9} />, handlers.onWorkbenchFullscreenToggle)}
        {action("New Pane", <Plus size={16} strokeWidth={1.9} />, handlers.onNewWorkbenchPane)}
        {includePanels && viewModel !== undefined ? (
          <>
            {/* In the fully-collapsed (narrow split) cluster the panel toggles live here
                too, so closing the Workbench / toggling the FileTree stays reachable. */}
            <WorkbenchControlsSeparator aria-hidden />
            {action(
              viewModel.workbenchOpen ? "Close Workbench" : "Open Workbench",
              viewModel.workbenchOpen ? (
                <PanelRightClose size={15} strokeWidth={1.9} />
              ) : (
                <PanelRightOpen size={15} strokeWidth={1.9} />
              ),
              handlers.onWorkbenchToggle,
            )}
            {action(
              viewModel.fileTreeOpen ? "Close FileTree" : "Open FileTree",
              <FolderOpen size={15} strokeWidth={1.9} />,
              handlers.onFileTreeToggle,
            )}
          </>
        ) : null}
      </WorkbenchControlsPopover>
    </WorkbenchControlsMenuFrame>
  );
}

export function createColumnResizeHandle(
  edge: "left" | "workbench" | "fileTree",
  side: "left" | "right",
  handlers: ProductShellHandlers,
): ReactElement {
  return (
    <ColumnResizeHandle
      $side={side}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize column"
      data-resize-edge={edge}
      data-column-resize-handle="true"
      onPointerDown={(event: {
        clientX: number;
        pointerId: number;
        currentTarget: HTMLElement;
        preventDefault: () => void;
      }) => {
        // Capture the pointer on the handle so the drag keeps receiving move/up even
        // when the cursor crosses a <webview> pane (which would otherwise swallow the
        // events, so the release never registers and the column "sticks" to the cursor).
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Ignore: setPointerCapture can throw if the pointer is already gone.
        }
        handlers.onResizeStart(edge, event);
      }}
    />
  );
}

// The window is frameless (titleBarStyle: "hidden") and the macOS traffic lights
// are positioned by Electron inside this top row. Reserve their footprint with a
// drag-region spacer instead of drawing our own dots (which would double them).
export function createTrafficControls(): ReactElement {
  return <TrafficControls aria-hidden="true" data-traffic-controls="true" />;
}

export function menuAnchorFromEvent(event: { currentTarget: HTMLElement }): MenuAnchorRect {
  const rect = event.currentTarget.getBoundingClientRect();
  return { left: rect.left, top: rect.top, bottom: rect.bottom, right: rect.right };
}

export function createIconButton(
  label: string,
  icon: ReactNode,
  onClick?: (event: { currentTarget: HTMLElement }) => void,
): ReactElement {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick}>
      {icon}
    </button>
  );
}

const WindowToggleCluster = styled.div`
  position: fixed;
  top: 0;
  right: 0;
  height: 52px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding-right: 14px;
  z-index: 60;
  pointer-events: none;
`;

const WindowToggleButton = styled.button<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 7px;
  background: ${({ $active }) => ($active ? "var(--tide-selection)" : "transparent")};
  color: ${({ $active }) => ($active ? "var(--tide-action)" : "var(--tide-muted)")};
  cursor: pointer;
  pointer-events: auto;
  -webkit-app-region: no-drag;
  transition: background-color 0.12s ease, color 0.12s ease, opacity 0.12s ease;

  &:hover {
    background: var(--tide-selection);
    color: var(--tide-action);
  }
`;

const WindowToggleDivider = styled.span`
  width: 1px;
  height: 22px;
  margin: 0 3px;
  background: var(--tide-line);
  pointer-events: none;
`;

const WorkbenchControlsPopover = styled.div`
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  background: var(--tide-bg);
  border: 1px solid var(--tide-line);
  border-radius: 9px;
  box-shadow: 0 6px 18px rgba(52, 48, 56, 0.16);
  opacity: 0;
  pointer-events: none;
  transform: translateY(-2px);
  transition: opacity 0.12s ease, transform 0.12s ease;
  z-index: 30;

  &::before {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    bottom: 100%;
    height: 6px;
  }
`;

const WorkbenchControlsMenuFrame = styled.div`
  position: relative;
  display: inline-flex;
  pointer-events: auto;

  &:hover ${WorkbenchControlsPopover},
  &:focus-within ${WorkbenchControlsPopover} {
    opacity: 1;
    pointer-events: auto;
    transform: translateY(0);
  }

  &[data-collapsed="true"] ${WorkbenchControlsPopover} {
    opacity: 0;
    pointer-events: none;
    transform: translateY(-2px);
  }
`;

const WorkbenchControlsSeparator = styled.span`
  width: 1px;
  height: 20px;
  margin: 0 3px;
  background: var(--tide-line);
  flex: 0 0 auto;
`;

const ColumnResizeHandle = styled.div<{ $side: "left" | "right" }>`
  position: absolute;
  top: 0;
  bottom: 0;
  ${({ $side }) => $side}: -4px;
  width: 9px;
  z-index: 6;
  cursor: col-resize;
  touch-action: none;

  &::after {
    content: "";
    position: absolute;
    inset: 0 auto 0 50%;
    width: 2px;
    transform: translateX(-50%);
    background: transparent;
    transition: background 0.12s ease;
  }

  &:hover::after {
    background: var(--tide-action);
  }
`;

const TrafficControls = styled.div`
  flex: 0 0 auto;
  width: 54px;
  height: 100%;

  [data-agent-chat-top-row] & {
    width: 65px;
  }

  .tide-fullscreen & {
    display: none;
  }
`;
