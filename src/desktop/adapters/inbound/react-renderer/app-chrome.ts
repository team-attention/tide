import { createElement, type ReactElement } from "react";

import type {
  AppChromeStatusBarView,
  AppChromeViewModel,
  ChromeActionView,
  WorkbenchTabView,
} from "../../../application/domains/app-chrome/app-chrome-state.ts";

export interface AppChromeProps {
  viewModel: AppChromeViewModel;
}

export function AppChrome(props: AppChromeProps): ReactElement {
  const viewModel = props.viewModel;

  return createElement(
    "aside",
    { className: "app-chrome", "aria-label": "App Chrome" },
    createStatusBar(viewModel.statusBar),
    viewModel.workbenchTabStrip.visible
      ? createWorkbenchTabStrip(viewModel.workbenchTabStrip.visibleTabs)
      : null,
    viewModel.workbenchTabStrip.overflowTabs.length > 0
      ? createWorkbenchOverflow(viewModel.workbenchTabStrip.overflowTabs)
      : null,
    viewModel.errorMessage
      ? createElement("p", { role: "alert" }, viewModel.errorMessage)
      : null,
  );
}

function createStatusBar(statusBar: AppChromeStatusBarView): ReactElement {
  return createElement(
    "section",
    {
      className: "status-bar",
      "aria-label": "Status Bar",
      "data-backend-connection-state": statusBar.backendConnectionState,
      "data-runtime-state": statusBar.runtimeState,
    },
    createElement("span", null, `Backend: ${statusBar.backendConnectionState}`),
    createElement("span", null, `Runtime: ${statusBar.runtimeState}`),
    statusBar.agentLabel
      ? createElement("span", null, `Agent: ${statusBar.agentLabel}`)
      : null,
    statusBar.providerReadinessNeedsAttention
      ? createElement("span", { "data-attention": "provider-readiness" }, "Provider")
      : null,
    statusBar.promptNeedsAttention
      ? createElement("span", { "data-attention": "prompt" }, "Prompt")
      : null,
  );
}

function createWorkbenchTabStrip(tabs: WorkbenchTabView[]): ReactElement {
  return createElement(
    "nav",
    {
      className: "workbench-tab-strip",
      "aria-label": "Workbench Tab Strip",
    },
    tabs.map(createWorkbenchTab),
  );
}

function createWorkbenchTab(tab: WorkbenchTabView): ReactElement {
  return createElement(
    "div",
    {
      key: tab.paneId,
      className: "workbench-tab",
      "data-pane-id": tab.paneId,
      "data-pane-kind": tab.kind,
      "data-active": String(tab.active),
      "data-loading": String(tab.loading),
    },
    createChromeButton(tab.focusAction, tab.title),
    createChromeButton(tab.closeAction),
  );
}

function createWorkbenchOverflow(tabs: WorkbenchTabView[]): ReactElement {
  return createElement(
    "section",
    {
      className: "workbench-tab-overflow",
      "aria-label": "Workbench Tab Overflow",
    },
    tabs.map((tab) =>
      createElement(
        "button",
        {
          key: `overflow:${tab.paneId}`,
          type: "button",
          title: tab.focusAction.tooltip,
          "aria-label": tab.focusAction.accessibleLabel,
          disabled: tab.focusAction.disabled,
        },
        tab.title,
      ),
    ),
  );
}

function createChromeButton(
  action: ChromeActionView,
  label?: string,
): ReactElement {
  return createElement(
    "button",
    {
      type: "button",
      title: action.tooltip,
      "aria-label": action.accessibleLabel,
      "data-action-id": action.id,
      "data-action-state": action.state,
      disabled: action.disabled,
    },
    label ?? action.icon,
  );
}
