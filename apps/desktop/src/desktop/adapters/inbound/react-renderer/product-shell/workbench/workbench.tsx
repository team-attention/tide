import type { ProductShellWorkbenchViewModel } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { WorkbenchTabView } from "../../../../../application/domains/app-chrome/app-chrome-state.ts";
import type { GitChangesView, ProductShellHandlers } from "../support/types.ts";
import type { ReactElement } from "react";
import { useEffect, useRef } from "react";
import { FileText, GitCompare, Globe, Image as ImageIcon, LayoutGrid, Terminal, X } from "lucide-react";
import { createColumnResizeHandle, createTrafficControls } from "../chrome/chrome.tsx";
import { createEditorPickerPane, createWorkbenchPaneContent } from "./pane-content.tsx";
import { WorkbenchSplitView } from "./split-view.tsx";
import { WorkbenchLauncherPane, emptyWorkbenchLauncherPane } from "./launcher-pane.tsx";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

export function createWorkbenchColumn(
  viewModel: ProductShellWorkbenchViewModel,
  handlers: ProductShellHandlers,
  gitChanges: GitChangesView | null,
): ReactElement {
  const tabs = viewModel.appChrome.workbenchTabStrip.visibleTabs;
  const activeTab = tabs.find((tab) => tab.active) ?? tabs[0];
  const activePane = viewModel.appChrome.activeWorkbenchPane;
  // Split shows every pane with its OWN header (title + close + drag handle) — that IS
  // the header band, so there is NO global tab bar in Split (Stacked keeps the 52px tab
  // strip). The workbench chrome controls (layout toggle / fullscreen / New Pane) live
  // in the fixed top-right window cluster next to the panel toggles
  // (createWindowChromeToggles) — consistent position in every layout. In Split that
  // cluster floats over the top-right pane's header, so it collapses to the "…" menu
  // and that pane reserves room for it (corner-pane padding, product-shell.css). See
  // docs_v2/specs/workbench-dock-parity.md.
  const splitActive =
    viewModel.editorPicker === null &&
    viewModel.workbenchLayoutMode === "split" &&
    viewModel.workbenchLayoutTree !== null &&
    viewModel.appChrome.openWorkbenchPanes.length > 1;
  const tabIconSize = 13;
  const workbenchTabIcon = (kind: string): ReactElement => {
    switch (kind) {
      case "browser":
        return <Globe size={tabIconSize} strokeWidth={1.85} />;
      case "terminal":
        return <Terminal size={tabIconSize} strokeWidth={1.85} />;
      case "diff":
        return <GitCompare size={tabIconSize} strokeWidth={1.85} />;
      case "changes":
        return <GitCompare size={tabIconSize} strokeWidth={1.85} />;
      case "launcher":
        return <LayoutGrid size={tabIconSize} strokeWidth={1.85} />;
      case "image":
        return <ImageIcon size={tabIconSize} strokeWidth={1.85} />;
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
          <WorkbenchStackedTabs tabs={tabs} handlers={handlers} tabIcon={workbenchTabIcon} />
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
          gitChanges={gitChanges}
        />
      ) : activeTab && activePane ? (
        <section
          className="workbench-column__pane"
          data-pane-id={activeTab.paneId}
          data-pane-kind={activeTab.kind}
        >
          {createWorkbenchPaneContent(activePane, handlers, viewModel.editorDrafts[activePane.paneId], gitChanges)}
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

// The Stacked tab strip: one tab per open pane, scrollable horizontally so every pane
// stays reachable AND readable however many are open (Split shows per-pane headers
// instead). The strip is overflow-x:auto: a vertical mouse wheel is translated to
// horizontal scroll (trackpads already pan sideways), and the active tab is followed
// into view whenever it changes — but NOT on every render, so streaming output from
// another pane can't yank the strip back while you scroll through it.
function WorkbenchStackedTabs(props: {
  tabs: WorkbenchTabView[];
  handlers: ProductShellHandlers;
  tabIcon: (kind: string) => ReactElement;
}): ReactElement {
  const { tabs, handlers, tabIcon } = props;
  const stripRef = useRef<HTMLDivElement | null>(null);
  const activeTabRef = useRef<HTMLDivElement | null>(null);
  const activePaneId = tabs.find((tab) => tab.active)?.paneId ?? null;

  useEffect(() => {
    const tab = activeTabRef.current;
    // jsdom (unit tests) doesn't implement scrollIntoView — guard before calling.
    if (typeof tab?.scrollIntoView === "function") {
      tab.scrollIntoView({ inline: "nearest", block: "nearest" });
    }
  }, [activePaneId]);

  // Translate a vertical mouse wheel into horizontal scroll so a plain mouse reaches
  // off-screen tabs. This MUST be a native, NON-passive listener: React's synthetic
  // onWheel is passive, so preventDefault() there is a no-op — and without it the
  // vertical delta still bubbles to the window (unwanted page scroll / macOS overscroll
  // bounce). We consume the wheel ONLY when the strip actually overflows and the gesture
  // is vertical-dominant (a real horizontal gesture already pans natively).
  useEffect(() => {
    const strip = stripRef.current;
    if (strip === null) {
      return;
    }
    const onWheel = (event: WheelEvent): void => {
      if (strip.scrollWidth <= strip.clientWidth) {
        return;
      }
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
        return;
      }
      event.preventDefault();
      strip.scrollLeft += event.deltaY;
    };
    strip.addEventListener("wheel", onWheel, { passive: false });
    return () => strip.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div
      className="workbench-tabs"
      role="tablist"
      aria-label="Workbench Tab Strip"
      ref={stripRef}
    >
      {tabs.length === 0 ? (
        <span className="workbench-tabs__empty">Workbench</span>
      ) : (
        tabs.map((tab) => (
          <div
            key={tab.paneId}
            className="workbench-tab"
            data-pane-id={tab.paneId}
            data-active={tab.active}
            data-kind={tab.kind}
            role="tab"
            aria-selected={tab.active}
            ref={tab.active ? activeTabRef : undefined}
          >
            <button
              className="workbench-tab__label"
              type="button"
              title={tab.title}
              onClick={() => handlers.onFocusWorkbenchPane(tab.paneId)}
            >
              <span className="workbench-tab__icon" aria-hidden>
                {tabIcon(tab.kind)}
              </span>
              <span className="workbench-tab__title">{tab.title}</span>
            </button>
            {/* Every tab carries a close button (revealed on hover; always shown on the
                active tab) so closing a pane is always one obvious click. */}
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
  );
}
