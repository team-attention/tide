import type { ProductShellWorkbenchViewModel } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { ProductShellHandlers } from "../support/types.ts";
import type { ReactElement } from "react";
import { FileText, GitCompare, Globe, LayoutGrid, Terminal, X } from "lucide-react";
import { createColumnResizeHandle, createTrafficControls } from "../chrome/chrome.tsx";
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
  // Split mode shows every pane with its OWN header (title + close, the drag handle),
  // which IS the header band — so in Split we drop the workbench's global header row
  // entirely (no tab strip). The workbench's chrome controls (layout toggle /
  // fullscreen / new pane) live in the fixed top-right window cluster
  // (createWindowChromeToggles), not in this column, so neither mode carries a controls
  // row here. Stacked keeps the 52px tab-strip row.
  const splitActive =
    viewModel.editorPicker === null &&
    viewModel.workbenchLayoutMode === "split" &&
    viewModel.workbenchLayoutTree !== null &&
    viewModel.appChrome.visibleWorkbenchPanes.length > 1;
  // The pane at the workbench's top-right corner (row splits → right child, column
  // splits → top child). Only this pane's header reserves room for the fixed top-right
  // control cluster, and only when the workbench is the rightmost column (file tree
  // closed) — see split-view.css. With the tree open the cluster sits over the file
  // tree, so no pane needs to reserve it.
  const topRightPaneId = ((): string | null => {
    let node = viewModel.workbenchLayoutTree;
    while (node !== null && node.type !== "leaf") {
      node = node.dir === "row" ? node.b : node.a;
    }
    return node !== null && node.type === "leaf" ? node.paneId : null;
  })();
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
          topRightPaneId={topRightPaneId}
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
