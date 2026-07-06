import type { ProductShellWorkbenchViewModel } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { WorkbenchTabView } from "../../../../../application/domains/app-chrome/app-chrome-state.ts";
import type { GitChangesView, ProductShellHandlers } from "../support/types.ts";
import type { ReactElement } from "react";
import { useEffect, useRef } from "react";
import { styled } from "styled-components";
import { ClipboardCheck, FileText, GitCompare, Globe, Image as ImageIcon, LayoutGrid, Terminal, X } from "lucide-react";
import { createColumnResizeHandle, createTrafficControls } from "../chrome/chrome.tsx";
import { createEditorPickerPane, createWorkbenchPaneContent } from "./pane-content.tsx";
import { WorkbenchSplitView } from "./split-view.tsx";
import { WorkbenchLauncherPane, emptyWorkbenchLauncherPane } from "./launcher-pane.tsx";
import { ColumnTopRow } from "../support/column-top-row.parts.tsx";
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
  // and that pane reserves room for it through ProductShellBody's padding rule. See
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
      case "review":
        return <ClipboardCheck size={tabIconSize} strokeWidth={1.85} />;
      case "launcher":
        return <LayoutGrid size={tabIconSize} strokeWidth={1.85} />;
      case "image":
        return <ImageIcon size={tabIconSize} strokeWidth={1.85} />;
      default:
        return <FileText size={tabIconSize} strokeWidth={1.85} />;
    }
  };

  return (
    <WorkbenchColumnFrame
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
        <WorkbenchTopRow aria-label="Workbench Top Row">
          {/* When fullscreen, the workbench is the top-left window element, so its
              header must reserve the macOS traffic-light zone (collapses to 0 in
              native fullscreen) — otherwise the first tab sits under the lights. */}
          {viewModel.workbenchFullscreen ? createTrafficControls() : null}
          <WorkbenchStackedTabs tabs={tabs} handlers={handlers} tabIcon={workbenchTabIcon} />
        </WorkbenchTopRow>
      )}
      {viewModel.editorPicker !== null ? (
        <WorkbenchPaneSection data-pane-kind="editor-picker">
          {createEditorPickerPane(viewModel.editorPicker, handlers)}
        </WorkbenchPaneSection>
      ) : splitActive && viewModel.workbenchLayoutTree !== null ? (
        <WorkbenchSplitView
          tree={viewModel.workbenchLayoutTree}
          viewModel={viewModel}
          handlers={handlers}
          paneIcon={workbenchTabIcon}
          gitChanges={gitChanges}
        />
      ) : activeTab && activePane ? (
        <WorkbenchPaneSection
          data-pane-id={activeTab.paneId}
          data-pane-kind={activeTab.kind}
        >
          {createWorkbenchPaneContent(
            activePane,
            handlers,
            viewModel.editorDrafts[activePane.paneId],
            gitChanges,
            viewModel.activeThreadId,
          )}
        </WorkbenchPaneSection>
      ) : (
        <WorkbenchPaneSection data-pane-kind="launcher">
          {/* An empty Workbench presents the Launcher rather than a dead empty
              state, so there is always a way to open a Pane. */}
          <WorkbenchLauncherPane pane={emptyWorkbenchLauncherPane()} handlers={handlers} />
        </WorkbenchPaneSection>
      )}
    </WorkbenchColumnFrame>
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
    <WorkbenchTabsStrip
      data-workbench-tabs="true"
      role="tablist"
      aria-label="Workbench Tab Strip"
      ref={stripRef}
    >
      {tabs.length === 0 ? (
        <WorkbenchTabsEmpty>Workbench</WorkbenchTabsEmpty>
      ) : (
        tabs.map((tab) => (
          <WorkbenchTabChip
            key={tab.paneId}
            data-pane-id={tab.paneId}
            data-active={tab.active}
            data-kind={tab.kind}
            data-workbench-tab="true"
            role="tab"
            aria-selected={tab.active}
            ref={tab.active ? activeTabRef : undefined}
          >
            <WorkbenchTabLabelButton
              type="button"
              data-workbench-tab-label="true"
              title={tab.title}
              onClick={() => handlers.onFocusWorkbenchPane(tab.paneId)}
            >
              <WorkbenchTabIcon aria-hidden>
                {tabIcon(tab.kind)}
              </WorkbenchTabIcon>
              <WorkbenchTabTitle data-workbench-tab-title="true">{tab.title}</WorkbenchTabTitle>
            </WorkbenchTabLabelButton>
            {/* Every tab carries a close button (revealed on hover; always shown on the
                active tab) so closing a pane is always one obvious click. */}
            <WorkbenchTabCloseButton
              type="button"
              data-workbench-tab-close="true"
              title="Close Pane"
              aria-label="Close Pane"
              onClick={() => handlers.onCloseWorkbenchPane(tab.paneId)}
            >
              <X size={15} strokeWidth={2.2} aria-hidden />
            </WorkbenchTabCloseButton>
          </WorkbenchTabChip>
        ))
      )}
    </WorkbenchTabsStrip>
  );
}

const WorkbenchColumnFrame = styled.aside`
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: 52px minmax(0, 1fr);
  border-left: 1px solid var(--tide-line);
  background: var(--tide-bg);

  &[data-fullscreen="true"] {
    position: fixed;
    inset: 0;
    z-index: 50;
    border-left: 0;
  }

  &[data-layout="split"] {
    grid-template-rows: minmax(0, 1fr);
  }
`;

const WorkbenchTopRow = styled(ColumnTopRow)`
  padding: 0 12px;
`;

const WorkbenchPaneSection = styled.section`
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--tide-bg);

  h2 {
    margin: 0;
    color: var(--tide-text);
    font-size: 16px;
    line-height: 1.2;
  }

  p {
    margin: 0;
    color: var(--tide-muted);
    font-size: 14px;
    line-height: 1.5;
  }
`;

const WorkbenchTabsStrip = styled.div`
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
`;

const WorkbenchTabsEmpty = styled.span`
  color: var(--tide-muted);
  font-size: 14px;
`;

const WorkbenchTabChip = styled.div`
  max-width: 220px;
  height: 32px;
  flex: 0 0 auto;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 0 8px;
  border-radius: 7px;
  color: var(--tide-muted);
  transition: background 0.12s ease, box-shadow 0.12s ease, color 0.12s ease;

  &:not([data-active="true"]):hover {
    background: color-mix(in srgb, var(--tide-selection) 58%, transparent);
    color: var(--tide-text);
  }

  &[data-active="true"] {
    background: color-mix(in srgb, var(--tide-selection) 78%, transparent);
    color: var(--tide-text);
  }
`;

const WorkbenchTabLabelButton = styled.button`
  min-width: 0;
  height: 100%;
  display: inline-flex;
  align-items: center;
  align-self: center;
  gap: 6px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: 520;

  ${WorkbenchTabChip}[data-active="true"] & {
    font-weight: 590;
  }
`;

const WorkbenchTabIcon = styled.span`
  flex: 0 0 auto;
  display: inline-flex;
  color: var(--tide-muted);

  ${WorkbenchTabChip}[data-active="true"] & {
    color: var(--tide-text);
  }
`;

const WorkbenchTabTitle = styled.span`
  min-width: 0;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const WorkbenchTabCloseButton = styled.button`
  width: 0;
  height: 22px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--tide-muted);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.12s ease, width 0.12s ease, background 0.12s ease, color 0.12s ease;

  ${WorkbenchTabChip}:hover &,
  ${WorkbenchTabChip}[data-active="true"] &,
  &:focus-visible {
    width: 22px;
    opacity: 1;
  }

  &:hover {
    background: var(--tide-selection);
    color: var(--tide-text);
  }
`;
