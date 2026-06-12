import type { ThreadRecord } from "../../domains/thread/thread.ts";
import type {
  BrowserPaneActionRequest,
  BrowserPaneState,
} from "../../domains/workbench/workbench.ts";
import { failure, type ServiceResult } from "../support/service-result.ts";
import {
  browserActionKindFromInput,
  browserTitleFromUrl,
  optionalRawString,
  optionalString,
} from "../support/service-value-helpers.ts";
import { browserPaneRef, firstBrowserPane } from "./workbench-snapshot.ts";
import type {
  TideActBrowserOutput,
  TideObserveBrowserOutput,
  TideOpenBrowserOutput,
} from "../tide-mcp/tide-mcp-output.ts";

// Browser Pane operations for the Workbench: open/reveal/navigate a Browser Pane,
// observe it, and queue a click/type action. Pure functions over the thread's
// pane list (the live page render + action execution happen in the Desktop
// webview). Shared by the workbench-command and Tide MCP paths. Extracted from
// thread-runtime-service.ts. See docs_v2/specs/thread-runtime-service-decomposition.md.

export function openBrowserOutput(
  thread: ThreadRecord,
  input: Record<string, unknown> | undefined,
  idGenerator: () => string,
  clock: () => string,
): TideOpenBrowserOutput {
  const capturedAt = clock();
  const requestedUrl = optionalString(input?.url);
  const requestedTitle = optionalString(input?.title);
  const disposition =
    input?.disposition === "new_browser_pane"
      ? "new_browser_pane"
      : "reuse_active_browser";
  const reusablePane =
    disposition === "reuse_active_browser"
      ? firstBrowserPane(thread.workbench)
      : undefined;

  if (reusablePane === undefined) {
    const pane: BrowserPaneState = {
      paneId: idGenerator(),
      kind: "browser",
      title: requestedTitle ?? browserTitleFromUrl(requestedUrl),
      url: requestedUrl,
      loading: false,
      visible: true,
      revision: idGenerator(),
      updatedAt: capturedAt,
    };
    thread.workbench.panes.push(pane);
    thread.workbench.activePaneId = pane.paneId;
    thread.workbench.focusOwner = "composer";

    return {
      kind: "open_browser",
      threadId: thread.threadId,
      pane: browserPaneRef(pane),
      visibleSideEffect: "created",
    };
  }

  const urlChanged = requestedUrl !== undefined && requestedUrl !== reusablePane.url;
  reusablePane.visible = true;
  reusablePane.title =
    requestedTitle ?? browserTitleFromUrl(requestedUrl ?? reusablePane.url);
  if (requestedUrl !== undefined) {
    reusablePane.url = requestedUrl;
  }
  reusablePane.revision = idGenerator();
  reusablePane.updatedAt = capturedAt;
  thread.workbench.activePaneId = reusablePane.paneId;
  thread.workbench.focusOwner = "composer";

  return {
    kind: "open_browser",
    threadId: thread.threadId,
    pane: browserPaneRef(reusablePane),
    visibleSideEffect: urlChanged ? "navigated" : "revealed",
  };
}

export function observeBrowserOutput(
  thread: ThreadRecord,
  input: Record<string, unknown> | undefined,
): ServiceResult<{ value: TideObserveBrowserOutput }> {
  const paneId = optionalString(input?.paneId);
  if (paneId === undefined) {
    return failure("workbench_target_not_found", "Browser Pane target was not found.");
  }

  const pane = thread.workbench.panes.find(
    (candidate): candidate is BrowserPaneState =>
      candidate.kind === "browser" && candidate.paneId === paneId,
  );
  if (pane === undefined) {
    return failure(
      "workbench_target_not_found",
      "Browser Pane target was not found for this Thread.",
    );
  }

  const revision = optionalString(input?.revision);
  if (revision !== undefined && revision !== pane.revision) {
    return failure("workbench_stale_reference", "Browser Pane revision is stale.");
  }

  return {
    ok: true,
    value: {
      kind: "observe_browser",
      threadId: thread.threadId,
      pane: browserPaneRef(pane),
    },
  };
}

export function actBrowserOutput(
  thread: ThreadRecord,
  input: Record<string, unknown> | undefined,
  idGenerator: () => string,
  clock: () => string,
): ServiceResult<{ value: TideActBrowserOutput }> {
  const paneId = optionalString(input?.paneId);
  const revision = optionalString(input?.revision);
  const selector = optionalString(input?.selector);
  const actionKind = browserActionKindFromInput(input?.action);
  if (
    paneId === undefined ||
    revision === undefined ||
    selector === undefined ||
    actionKind === undefined
  ) {
    return failure(
      "invalid_workbench_command",
      "Browser action requires pane id, revision, action, and selector.",
    );
  }

  const text = optionalRawString(input?.text);
  if (actionKind === "type_text" && text === undefined) {
    return failure("invalid_workbench_command", "Browser type action requires text.");
  }

  const pane = thread.workbench.panes.find(
    (candidate): candidate is BrowserPaneState =>
      candidate.kind === "browser" && candidate.paneId === paneId,
  );
  if (pane === undefined) {
    return failure(
      "workbench_target_not_found",
      "Browser Pane target was not found for this Thread.",
    );
  }
  if (revision !== pane.revision) {
    return failure("workbench_stale_reference", "Browser Pane revision is stale.");
  }
  if (pane.pendingAction !== undefined) {
    return failure(
      "invalid_workbench_command",
      "Browser Pane already has a pending action.",
    );
  }

  const requestedAt = clock();
  const action: BrowserPaneActionRequest = {
    actionId: idGenerator(),
    kind: actionKind,
    selector,
    requestedAt,
    ...(text === undefined ? {} : { text }),
  };
  pane.pendingAction = action;
  pane.revision = idGenerator();
  pane.updatedAt = requestedAt;
  thread.updatedAt = requestedAt;

  return {
    ok: true,
    value: {
      kind: "act_browser",
      threadId: thread.threadId,
      pane: browserPaneRef(pane),
      action: { ...action },
      status: "pending",
    },
  };
}
