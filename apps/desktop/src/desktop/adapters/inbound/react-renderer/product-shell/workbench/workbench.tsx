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
  // Split shows every pane with its OWN header (title + close + drag handle) — that IS
  // the header band, so there is NO global tab bar in Split (Stacked keeps the 52px tab
  // strip). The workbench controls (single layout toggle / fullscreen / New Pane) live
  // in the workbench's first header: the tab strip's trailing in Stacked, and the
  // top-LEFT pane's header in Split (so they're never a separate row, and never float
  // over a pane). See docs_v2/specs/workbench-dock-parity.md.
  const splitActive =
    viewModel.editorPicker === null &&
    viewModel.workbenchLayoutMode === "split" &&
    viewModel.workbenchLayoutTree !== null &&
    viewModel.appChrome.visibleWorkbenchPanes.length > 1;
  // The top-LEFT ("first") pane — always the a-child down the split tree. In Split its
  // header hosts the workbench controls at its right.
  const firstPaneId = ((): string | null => {
    let node = viewModel.workbenchLayoutTree;
    while (node !== null && node.type !== "leaf") {
      node = node.a;
    }
    return node !== null && node.type === "leaf" ? node.paneId : null;
  })();
  // The first pane reaches the workbench's RIGHT edge only when every split down to it
  // is a column split (a full-width top pane). Then — when the workbench is the
  // rightmost column — its docked controls must clear the fixed window toggles. In a
  // row split the first pane is on the left, so no clearance is needed.
  const firstPaneFullWidth = ((): boolean => {
    let node = viewModel.workbenchLayoutTree;
    while (node !== null && node.type !== "leaf") {
      if (node.dir !== "col") {
        return false;
      }
      node = node.a;
    }
    return node !== null && node.type === "leaf";
  })();
  // Single layout toggle (icon = current mode, click flips) + fullscreen + New Pane.
  const workbenchControls = (
    <>
      {createIconButton(
        viewModel.workbenchLayoutMode === "split" ? "Switch to Stacked" : "Switch to Split",
        viewModel.workbenchLayoutMode === "split" ? (
          <Columns2 size={15} strokeWidth={1.9} />
        ) : (
          <Square size={15} strokeWidth={1.9} />
        ),
        () => handlers.onWorkbenchSetLayout(viewModel.workbenchLayoutMode === "split" ? "stacked" : "split"),
        "top-row-button",
      )}
      {createIconButton(
        viewModel.workbenchFullscreen ? "Exit fullscreen" : "Fullscreen pane",
        viewModel.workbenchFullscreen ? <Minimize2 size={15} strokeWidth={1.9} /> : <Maximize2 size={15} strokeWidth={1.9} />,
        handlers.onWorkbenchFullscreenToggle,
        "top-row-button",
      )}
      {createIconButton("New Pane", <Plus size={16} strokeWidth={1.9} />, handlers.onNewWorkbenchPane, "top-row-button")}
    </>
  );
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
      data-layout={splitActive ? "split" : "stacked"}
      data-fullscreen={viewModel.workbenchFullscreen ? "true" : "false"}
    >
      {createColumnResizeHandle("workbench", "left", handlers)}
      {/* Split: no header row at all — the panes own their headers, and the workbench
          chrome controls live in the top-right window cluster. Stacked keeps the
          52px tab strip. */}
      {splitActive ? null : (
        <header className="workbench-column__top-row column-top-row" aria-label="Workbench Top Row">
          {/* When fullscreen, the workbench is the top-left window element, so its
              header must reserve the macOS traffic-light zone (collapses to 0 in
              native fullscreen) — otherwise the first tab sits under the lights. */}
          {viewModel.workbenchFullscreen ? createTrafficControls() : null}
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
                    title={tab.title}
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
                    <X size={15} strokeWidth={2.2} aria-hidden />
                  </button>
                </div>
              ))
            )}
          </div>
          <div className="column-top-row__trailing">{workbenchControls}</div>
        </header>
      )}
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
          controls={workbenchControls}
          controlsPaneId={firstPaneId}
          controlsReserveRight={firstPaneFullWidth}
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
