import type { ProductShellWorkbenchViewModel } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { ProductShellHandlers } from "../support/types.ts";
import { createElement } from "react";
import type { ReactElement } from "react";
import { Columns2, FileText, GitCompare, Globe, LayoutGrid, Maximize2, Minimize2, Plus, Rows2, Terminal, X } from "lucide-react";
import { createColumnResizeHandle, createIconButton, createTrafficControls } from "../chrome/chrome.ts";
import { createEditorPickerPane, createWorkbenchPaneContent } from "./pane-content.ts";
import { WorkbenchSplitView } from "./split-view.ts";
import { WorkbenchLauncherPane, emptyWorkbenchLauncherPane } from "./launcher-pane.ts";
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
        return createElement(Globe, { size: tabIconSize, strokeWidth: 1.85 });
      case "terminal":
        return createElement(Terminal, { size: tabIconSize, strokeWidth: 1.85 });
      case "diff":
        return createElement(GitCompare, { size: tabIconSize, strokeWidth: 1.85 });
      case "launcher":
        return createElement(LayoutGrid, { size: tabIconSize, strokeWidth: 1.85 });
      default:
        return createElement(FileText, { size: tabIconSize, strokeWidth: 1.85 });
    }
  };

  return createElement(
    "aside",
    {
      className: "workbench-column",
      "aria-label": "Workbench",
      "data-column": "workbench",
      "data-fullscreen": viewModel.workbenchFullscreen ? "true" : "false",
    },
    createColumnResizeHandle("workbench", "left", handlers),
    createElement(
      "header",
      { className: "workbench-column__top-row column-top-row", "aria-label": "Workbench Top Row" },
      // When fullscreen, the workbench is the top-left window element, so its
      // header must reserve the macOS traffic-light zone (collapses to 0 in
      // native fullscreen) — otherwise the first tab sits under the lights.
      viewModel.workbenchFullscreen ? createTrafficControls() : null,
      splitActive
        ? createElement("span", { className: "workbench-tabs__empty workbench-tabs__empty--split" }, "Split view")
        : createElement(
        "div",
        { className: "workbench-tabs", role: "tablist", "aria-label": "Workbench Tab Strip" },
        tabs.length === 0
          ? createElement("span", { className: "workbench-tabs__empty" }, "Workbench")
          : tabs.map((tab) =>
              createElement(
                "div",
                {
                  key: tab.paneId,
                  className: "workbench-tab",
                  "data-active": tab.active,
                  "data-kind": tab.kind,
                  role: "tab",
                  "aria-selected": tab.active,
                  // Keep the active tab (with its close button) fully in view when
                  // the strip overflows.
                  ref: tab.active
                    ? (el: HTMLElement | null) => {
                        if (typeof el?.scrollIntoView === "function") {
                          el.scrollIntoView({ inline: "nearest", block: "nearest" });
                        }
                      }
                    : undefined,
                },
                createElement(
                  "button",
                  {
                    className: "workbench-tab__label",
                    type: "button",
                    onClick: () => handlers.onFocusWorkbenchPane(tab.paneId),
                  },
                  createElement(
                    "span",
                    { className: "workbench-tab__icon", "aria-hidden": true },
                    workbenchTabIcon(tab.kind),
                  ),
                  createElement("span", { className: "workbench-tab__title" }, tab.title),
                ),
                // Every tab carries a close button (revealed on hover; always shown
                // on the active tab) so closing a pane is always one obvious click.
                createElement(
                  "button",
                  {
                    className: "workbench-tab__close",
                    type: "button",
                    title: "Close Pane",
                    "aria-label": "Close Pane",
                    onClick: () => handlers.onCloseWorkbenchPane(tab.paneId),
                  },
                  createElement(X, { size: 14, strokeWidth: 2.2, "aria-hidden": true }),
                ),
              ),
            ),
      ),
      // The + (New Pane) opens a Launcher tab to pick what to open; it always lives
      // in the Workbench header. Open/close is handled by the fixed window toggles.
      createElement(
        "div",
        { className: "column-top-row__trailing" },
        // Only meaningful with 2+ panes; the toggle still shows so the affordance
        // is discoverable.
        createIconButton(
          viewModel.workbenchLayoutMode === "split" ? "Tab group" : "Split panes",
          createElement(viewModel.workbenchLayoutMode === "split" ? Rows2 : Columns2, { size: 15, strokeWidth: 1.9 }),
          handlers.onWorkbenchLayoutModeToggle,
          "top-row-button",
        ),
        createIconButton(
          viewModel.workbenchFullscreen ? "Exit fullscreen" : "Fullscreen pane",
          createElement(viewModel.workbenchFullscreen ? Minimize2 : Maximize2, { size: 15, strokeWidth: 1.9 }),
          handlers.onWorkbenchFullscreenToggle,
          "top-row-button",
        ),
        createIconButton("New Pane", createElement(Plus, { size: 16, strokeWidth: 1.9 }), handlers.onNewWorkbenchPane, "top-row-button"),
      ),
    ),
    viewModel.editorPicker !== null
      ? createElement(
          "section",
          { className: "workbench-column__pane", "data-pane-kind": "editor-picker" },
          createEditorPickerPane(viewModel.editorPicker, handlers),
        )
      : splitActive && viewModel.workbenchLayoutTree !== null
      ? createElement(WorkbenchSplitView, {
          tree: viewModel.workbenchLayoutTree,
          viewModel,
          handlers,
          paneIcon: workbenchTabIcon,
        })
      : activeTab && activePane
      ? createElement(
          "section",
          {
            className: "workbench-column__pane",
            "data-pane-id": activeTab.paneId,
            "data-pane-kind": activeTab.kind,
          },
          createWorkbenchPaneContent(
            activePane,
            handlers,
            viewModel.editorDrafts[activePane.paneId],
          ),
        )
      : createElement(
          "section",
          { className: "workbench-column__pane", "data-pane-kind": "launcher" },
          // An empty Workbench presents the Launcher rather than a dead empty
          // state, so there is always a way to open a Pane.
          createElement(WorkbenchLauncherPane, {
            pane: emptyWorkbenchLauncherPane(),
            handlers,
          }),
        ),
  );
}
