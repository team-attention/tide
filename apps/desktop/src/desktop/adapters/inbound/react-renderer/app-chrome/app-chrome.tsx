import type { ReactElement } from "react";
import { styled } from "styled-components";

import type {
  AppChromeStatusBarView,
  AppChromeViewModel,
  ChromeActionView,
  WorkbenchTabView,
} from "../../../../application/domains/app-chrome/app-chrome-state.ts";

export interface AppChromeProps {
  viewModel: AppChromeViewModel;
  onFocusWorkbenchPane?: (paneId: string) => void;
  onCloseWorkbenchPane?: (paneId: string) => void;
}

export function AppChrome(props: AppChromeProps): ReactElement {
  const viewModel = props.viewModel;

  return (
    <AppChromeShell aria-label="App Chrome" data-app-chrome="true">
      {createStatusBar(viewModel.statusBar)}
      {viewModel.workbenchTabStrip.visible
        ? createWorkbenchTabStrip(viewModel.workbenchTabStrip.visibleTabs, props)
        : null}
      {viewModel.workbenchTabStrip.overflowTabs.length > 0
        ? createWorkbenchOverflow(viewModel.workbenchTabStrip.overflowTabs)
        : null}
      {viewModel.errorMessage ? <p role="alert">{viewModel.errorMessage}</p> : null}
    </AppChromeShell>
  );
}

function createStatusBar(statusBar: AppChromeStatusBarView): ReactElement {
  return (
    <StatusBarSection
      aria-label="Status Bar"
      data-status-bar="true"
      data-backend-connection-state={statusBar.backendConnectionState}
      data-runtime-state={statusBar.runtimeState}
    >
      <span>{`Backend: ${statusBar.backendConnectionState}`}</span>
      <span>{`Runtime: ${statusBar.runtimeState}`}</span>
      {statusBar.agentLabel ? <span>{`Agent: ${statusBar.agentLabel}`}</span> : null}
      {statusBar.providerReadinessNeedsAttention ? (
        <span data-attention="provider-readiness">Provider</span>
      ) : null}
      {statusBar.promptNeedsAttention ? <span data-attention="prompt">Prompt</span> : null}
    </StatusBarSection>
  );
}

function createWorkbenchTabStrip(
  tabs: WorkbenchTabView[],
  handlers: Pick<AppChromeProps, "onFocusWorkbenchPane" | "onCloseWorkbenchPane">,
): ReactElement {
  return (
    <WorkbenchTabStripNav aria-label="Workbench Tab Strip" data-workbench-tab-strip="true">
      {tabs.map((tab) => createWorkbenchTab(tab, handlers))}
    </WorkbenchTabStripNav>
  );
}

function createWorkbenchTab(
  tab: WorkbenchTabView,
  handlers: Pick<AppChromeProps, "onFocusWorkbenchPane" | "onCloseWorkbenchPane">,
): ReactElement {
  return (
    <AppChromeWorkbenchTab
      key={tab.paneId}
      data-pane-id={tab.paneId}
      data-pane-kind={tab.kind}
      data-active={String(tab.active)}
      data-loading={String(tab.loading)}
    >
      {createChromeButton(tab.focusAction, tab.title, () => handlers.onFocusWorkbenchPane?.(tab.paneId))}
      {createChromeButton(tab.closeAction, undefined, () => handlers.onCloseWorkbenchPane?.(tab.paneId))}
    </AppChromeWorkbenchTab>
  );
}

function createWorkbenchOverflow(tabs: WorkbenchTabView[]): ReactElement {
  return (
    <WorkbenchTabOverflowSection aria-label="Workbench Tab Overflow" data-workbench-tab-overflow="true">
      {tabs.map((tab) => (
        <button
          key={`overflow:${tab.paneId}`}
          type="button"
          title={tab.focusAction.tooltip}
          aria-label={tab.focusAction.accessibleLabel}
          disabled={tab.focusAction.disabled}
        >
          {tab.title}
        </button>
      ))}
    </WorkbenchTabOverflowSection>
  );
}

function createChromeButton(
  action: ChromeActionView,
  label?: string,
  onClick?: () => void,
): ReactElement {
  return (
    <button
      type="button"
      title={action.tooltip}
      aria-label={action.accessibleLabel}
      data-action-id={action.id}
      data-action-state={action.state}
      disabled={action.disabled}
      onClick={onClick}
    >
      {label ?? action.icon}
    </button>
  );
}

const AppChromeShell = styled.aside``;

const StatusBarSection = styled.section``;

const WorkbenchTabStripNav = styled.nav``;

const AppChromeWorkbenchTab = styled.div``;

const WorkbenchTabOverflowSection = styled.section``;
