import type { ProductShellWorkbenchViewModel } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { ProductShellHandlers } from "../support/types.ts";
import type { ReactElement } from "react";
import { Columns2, FileText, GitCompare, Globe, LayoutGrid, Maximize2, Minimize2, Plus, Square, Terminal, X } from "lucide-react";
import { createColumnResizeHandle, createIconButton, createTrafficControls } from "../chrome/chrome.tsx";
import { createEditorPickerPane, createWorkbenchPaneContent } from "./pane-content.tsx";
import { WorkbenchSplitView } from "./split-view.tsx";
import { WorkbenchLauncherPane, emptyWorkbenchLauncherPane } from "./launcher-pane.tsx";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

export function createWorkbenchColumn(
  viewModel: ProductShellWorkbenchViewModel,
  handlers: ProductShellHandlers,
): ReactElement {
  const tabs = viewModel.appChrome.workbenchTabStrip.visibleTabs;
  const activeTab = tabs.find((tab) => tab.active) ?? tabs[0];
  const activePane = viewModel.appChrome.activeWorkbenchPane;
  // Split mode shows every pane with its OWN header (title + close, the drag
  // handle), so the global top tab strip would be a redundant second header
  // layer. When split is active we drop the strip (the per-pane headers are the
  // tabs) but keep the top row's global actions + traffic-light reserve.
  const splitActive =
    viewModel.editorPicker === null &&
    viewModel.workbenchLayoutMode === "split" &&
    viewModel.workbenchLayoutTree !== null &&
    viewModel.appChrome.visibleWorkbenchPanes.length > 1;
  const tabIconSize = 13;
  const workbenchTabIcon = (kind: string): ReactElement => {
    switch (kind) {
      case "browser":
        return <Globe size={tabIconSize} strokeWidth={1.85} />;
      case "terminal":
        return <Terminal size={tabIconSize} strokeWidth={1.85} />;
      case "diff":
        return <GitCompare size={tabIconSize} strokeWidth={1.85} />;
      case "launcher":
        return <LayoutGrid size={tabIconSize} strokeWidth={1.85} />;
      default:
        return <FileText size={tabIconSize} strokeWidth={1.85} />;
    }
  };

  return (
    <aside
      className="workbench-column"
      aria-label="Workbench"
      data-column="workbench"
      data-fullscreen={viewModel.workbenchFullscreen ? "true" : "false"}
    >
      {createColumnResizeHandle("workbench", "left", handlers)}
      <header className="workbench-column__top-row column-top-row" aria-label="Workbench Top Row">
        {/* When fullscreen, the workbench is the top-left window element, so its
            header must reserve the macOS traffic-light zone (collapses to 0 in
            native fullscreen) — otherwise the first tab sits under the lights. */}
        {viewModel.workbenchFullscreen ? createTrafficControls() : null}
        {splitActive ? (
          // Split owns per-pane headers, so the top row carries no tab strip — just
          // an empty spacer that keeps the controls right-aligned (no dead label).
          <div className="workbench-tabs workbench-tabs--spacer" aria-hidden />
        ) : (
          <div className="workbench-tabs" role="tablist" aria-label="Workbench Tab Strip">
            {tabs.length === 0 ? (
              <span className="workbench-tabs__empty">Workbench</span>
            ) : (
              tabs.map((tab) => (
                <div
                  key={tab.paneId}
                  className="workbench-tab"
                  data-active={tab.active}
                  data-kind={tab.kind}
                  role="tab"
                  aria-selected={tab.active}
                  // Keep the active tab (with its close button) fully in view when
                  // the strip overflows.
                  ref={
                    tab.active
                      ? (el: HTMLElement | null) => {
                          if (typeof el?.scrollIntoView === "function") {
                            el.scrollIntoView({ inline: "nearest", block: "nearest" });
                          }
                        }
                      : undefined
                  }
                >
                  <button
                    className="workbench-tab__label"
                    type="button"
                    onClick={() => handlers.onFocusWorkbenchPane(tab.paneId)}
                  >
                    <span className="workbench-tab__icon" aria-hidden>
                      {workbenchTabIcon(tab.kind)}
                    </span>
                    <span className="workbench-tab__title">{tab.title}</span>
                  </button>
                  {/* Every tab carries a close button (revealed on hover; always shown
                      on the active tab) so closing a pane is always one obvious click. */}
                  <button
                    className="workbench-tab__close"
                    type="button"
                    title="Close Pane"
                    aria-label="Close Pane"
                    onClick={() => handlers.onCloseWorkbenchPane(tab.paneId)}
                  >
                    <X size={14} strokeWidth={2.2} aria-hidden />
                  </button>
                </div>
              ))
            )}
          </div>
        )}
        {/* The + (New Pane) opens a Launcher tab to pick what to open; it always lives
            in the Workbench header. Open/close is handled by the fixed window toggles. */}
        <div className="column-top-row__trailing">
          {/* A labelled segmented control with both presentations visible (Stacked =
              one pane + tabs, Split = tiled panes) and the active one marked — replaces
              the old single mystery-toggle so the choice is obvious. */}
          <div className="workbench-layout-toggle" role="group" aria-label="Workbench layout">
            <button
              type="button"
              className="workbench-layout-toggle__option"
              data-active={viewModel.workbenchLayoutMode === "stacked"}
              aria-pressed={viewModel.workbenchLayoutMode === "stacked"}
              title="Stacked — one pane with a tab strip"
              onClick={() => handlers.onWorkbenchSetLayout("stacked")}
            >
              <Square size={13} strokeWidth={1.9} aria-hidden />
              <span>Stacked</span>
            </button>
            <button
              type="button"
              className="workbench-layout-toggle__option"
              data-active={viewModel.workbenchLayoutMode === "split"}
              aria-pressed={viewModel.workbenchLayoutMode === "split"}
              title="Split — tiled panes you can drag to arrange"
              onClick={() => handlers.onWorkbenchSetLayout("split")}
            >
              <Columns2 size={13} strokeWidth={1.9} aria-hidden />
              <span>Split</span>
            </button>
          </div>
          {createIconButton(
            viewModel.workbenchFullscreen ? "Exit fullscreen" : "Fullscreen pane",
            viewModel.workbenchFullscreen ? (
              <Minimize2 size={15} strokeWidth={1.9} />
            ) : (
              <Maximize2 size={15} strokeWidth={1.9} />
            ),
            handlers.onWorkbenchFullscreenToggle,
            "top-row-button",
          )}
          {createIconButton("New Pane", <Plus size={16} strokeWidth={1.9} />, handlers.onNewWorkbenchPane, "top-row-button")}
        </div>
      </header>
      {viewModel.editorPicker !== null ? (
        <section className="workbench-column__pane" data-pane-kind="editor-picker">
          {createEditorPickerPane(viewModel.editorPicker, handlers)}
        </section>
      ) : splitActive && viewModel.workbenchLayoutTree !== null ? (
        <WorkbenchSplitView
          tree={viewModel.workbenchLayoutTree}
          viewModel={viewModel}
          handlers={handlers}
          paneIcon={workbenchTabIcon}
        />
      ) : activeTab && activePane ? (
        <section
          className="workbench-column__pane"
          data-pane-id={activeTab.paneId}
          data-pane-kind={activeTab.kind}
        >
          {createWorkbenchPaneContent(activePane, handlers, viewModel.editorDrafts[activePane.paneId])}
        </section>
      ) : (
        <section className="workbench-column__pane" data-pane-kind="launcher">
          {/* An empty Workbench presents the Launcher rather than a dead empty
              state, so there is always a way to open a Pane. */}
          <WorkbenchLauncherPane pane={emptyWorkbenchLauncherPane()} handlers={handlers} />
        </section>
      )}
    </aside>
  );
}
