import type { ThreadRecord } from "../../domains/thread/thread.ts";
import type {
  BrowserPaneActionRequest,
  BrowserPaneState,
} from "../../domains/workbench/workbench.ts";
import type { BrowserRuntimeObservation } from "../../ports/outbound/browser-runtime-port.ts";
import { failure, type ServiceResult } from "../support/service-result.ts";
import {
  browserActionKindFromInput,
  browserButtonFromInput,
  browserClickCountFromInput,
  browserObserveModeFromInput,
  browserTitleFromUrl,
  finiteNumberFromInput,
  optionalRawString,
  optionalString,
} from "../support/service-value-helpers.ts";
import { browserPaneRef, firstBrowserPane } from "./workbench-snapshot.ts";
import type {
  TideObserveBrowserOutput,
  TideOpenBrowserOutput,
} from "../tide-mcp/tide-mcp-output.ts";

// Browser Pane operations for the Workbench: open/reveal/navigate a Browser Pane,
// observe it, and prepare BrowserRuntime actions. Pure functions over the thread's
// pane list; live page rendering and execution are owned by Electron main's
// BrowserRuntime. Shared by the workbench-command and Tide MCP paths. Extracted
// from thread-runtime-service.ts. See docs_v2/specs/thread-runtime-service-decomposition.md.

export function browserPaneByIdForThread(
  thread: ThreadRecord,
  paneId: string | undefined,
): BrowserPaneState | undefined {
  return thread.workbench.panes.find(
    (candidate): candidate is BrowserPaneState =>
      candidate.kind === "browser" && candidate.paneId === paneId,
  );
}

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
      loading: requestedUrl !== undefined,
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
  reusablePane.title =
    requestedTitle ?? browserTitleFromUrl(requestedUrl ?? reusablePane.url);
  if (requestedUrl !== undefined) {
    reusablePane.url = requestedUrl;
  }
  if (urlChanged) {
    reusablePane.loading = true;
    delete reusablePane.pageTitle;
    delete reusablePane.bodyTextPreview;
    delete reusablePane.interactiveElements;
    delete reusablePane.screenshot;
  }
  reusablePane.revision = idGenerator();
  // Re-use / re-navigation invalidates the D5 act auto-retry window: clear priorRevision so
  // a stale action from the previous page is never auto-retried against the new one.
  delete reusablePane.priorRevision;
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

export async function observeBrowserOutput(
  thread: ThreadRecord,
  input: Record<string, unknown> | undefined,
): Promise<ServiceResult<{ value: TideObserveBrowserOutput }>> {
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

  const mode = browserObserveModeFromInput(input?.mode);
  // BrowserRuntime has already refreshed the pane evidence before this mapper runs.
  // Attach the screenshot only for mode=screenshot|both; screenshot-only drops DOM text.
  const ref = browserPaneRef(pane);
  if (mode !== "text" && pane.screenshot !== undefined) {
    ref.screenshot = { ...pane.screenshot };
  }
  if (mode === "screenshot") {
    ref.bodyTextPreview = undefined;
  }

  return {
    ok: true,
    value: {
      kind: "observe_browser",
      threadId: thread.threadId,
      pane: ref,
    },
  };
}

export function applyBrowserRuntimeObservation(
  pane: BrowserPaneState,
  observation: BrowserRuntimeObservation,
  input: {
    idGenerator: () => string;
    observedAt: string;
    remint: "never" | "on_url_change" | "always";
  },
): void {
  const previousUrl = pane.url;
  if (observation.title !== undefined) {
    pane.title = observation.title;
  }
  if (observation.pageTitle !== undefined) {
    pane.pageTitle = observation.pageTitle;
  }
  if (observation.url !== undefined) {
    pane.url = observation.url;
  }
  if (observation.bodyTextPreview !== undefined) {
    pane.bodyTextPreview = observation.bodyTextPreview;
  }
  if (observation.interactiveElements !== undefined) {
    pane.interactiveElements = observation.interactiveElements;
  }
  if (observation.screenshot !== undefined) {
    pane.screenshot = observation.screenshot;
  }
  pane.loading = observation.loading;
  if (
    input.remint === "always" ||
    (input.remint === "on_url_change" &&
      observation.url !== undefined &&
      observation.url !== previousUrl)
  ) {
    if (observation.url !== undefined && observation.url !== previousUrl) {
      delete pane.priorRevision;
    } else {
      pane.priorRevision = pane.revision;
    }
    pane.revision = input.idGenerator();
  }
  pane.updatedAt = input.observedAt;
}

export function prepareBrowserRuntimeAction(
  thread: ThreadRecord,
  input: Record<string, unknown> | undefined,
  idGenerator: () => string,
  clock: () => string,
): ServiceResult<{
  value: {
    pane: BrowserPaneState;
    action: BrowserPaneActionRequest;
    setsDriving: boolean;
    agentCursor?: { x: number; y: number };
  };
}> {
  const paneId = optionalString(input?.paneId);
  const revision = optionalString(input?.revision);
  const actionKind = browserActionKindFromInput(input?.action);
  if (paneId === undefined || revision === undefined || actionKind === undefined) {
    return failure(
      "invalid_workbench_command",
      "Browser action requires pane id, revision, and a supported action.",
    );
  }

  const requestedAt = clock();
  const built = buildBrowserActionRequest(actionKind, input, idGenerator(), requestedAt);
  if (!built.ok) {
    return built;
  }

  const pane = browserPaneByIdForThread(thread, paneId);
  if (pane === undefined) {
    return failure(
      "workbench_target_not_found",
      "Browser Pane target was not found for this Thread.",
    );
  }
  if (pane.userControlled === true) {
    return failure(
      "workbench_user_controlled",
      "The user has taken manual control of this browser pane, so it is no longer agent-driven. " +
        "Do not drive it; re-observe to see the current page, then continue your response or ask the user how to proceed.",
    );
  }
  if (
    revision !== pane.revision &&
    !(revision === pane.priorRevision && pane.loading !== true)
  ) {
    return failure(
      "workbench_stale_reference",
      `Browser Pane revision is stale. The pane is now at revision "${pane.revision}"; if it has not navigated since you observed it, retry this action with that revision.`,
    );
  }

  return {
    ok: true,
    value: {
      pane,
      action: built.value.action,
      setsDriving: built.value.setsDriving,
      agentCursor: built.value.agentCursor,
    },
  };
}

interface BuiltBrowserAction {
  action: BrowserPaneActionRequest;
  setsDriving: boolean;
  agentCursor?: { x: number; y: number };
}

function buildBrowserActionRequest(
  kind: BrowserPaneActionRequest["kind"],
  input: Record<string, unknown> | undefined,
  actionId: string,
  requestedAt: string,
): ServiceResult<{ value: BuiltBrowserAction }> {
  const base = { actionId, kind, requestedAt } as const;
  switch (kind) {
    case "click":
    case "type_text": {
      const selector = optionalString(input?.selector);
      if (selector === undefined) {
        return failure(
          "invalid_workbench_command",
          "Selector browser action requires a selector.",
        );
      }
      const text = optionalRawString(input?.text);
      if (kind === "type_text" && text === undefined) {
        return failure("invalid_workbench_command", "Browser type action requires text.");
      }
      return {
        ok: true,
        value: {
          action: { ...base, selector, ...(text === undefined ? {} : { text }) },
          setsDriving: false,
        },
      };
    }
    case "click_element": {
      const elementIndex = nonNegativeIntegerFromInput(input?.elementIndex);
      if (elementIndex === undefined) {
        return failure(
          "invalid_workbench_command",
          "Element browser action requires numeric elementIndex from observe_browser interactiveElements.",
        );
      }
      return {
        ok: true,
        value: {
          action: { ...base, elementIndex },
          setsDriving: false,
        },
      };
    }
    case "move_to":
    case "click_at": {
      const x = finiteNumberFromInput(input?.x);
      const y = finiteNumberFromInput(input?.y);
      if (x === undefined || y === undefined) {
        return failure(
          "invalid_workbench_command",
          "Coordinate browser action requires numeric x and y.",
        );
      }
      const clickCount = browserClickCountFromInput(input?.clickCount);
      const click =
        kind === "click_at"
          ? {
              button: browserButtonFromInput(input?.button),
              ...(clickCount === undefined ? {} : { clickCount }),
            }
          : {};
      return {
        ok: true,
        value: {
          action: { ...base, x, y, ...click },
          setsDriving: true,
          agentCursor: { x, y },
        },
      };
    }
    case "drag": {
      const x = finiteNumberFromInput(input?.x);
      const y = finiteNumberFromInput(input?.y);
      const toX = finiteNumberFromInput(input?.toX);
      const toY = finiteNumberFromInput(input?.toY);
      if (x === undefined || y === undefined || toX === undefined || toY === undefined) {
        return failure(
          "invalid_workbench_command",
          "Drag browser action requires numeric x, y, toX, and toY.",
        );
      }
      const durationMs = boundedIntegerFromInput(input?.durationMs, 250, 0, 2000);
      const steps = boundedIntegerFromInput(input?.steps, 8, 1, 60);
      return {
        ok: true,
        value: {
          action: { ...base, x, y, toX, toY, durationMs, steps },
          setsDriving: true,
          agentCursor: { x: toX, y: toY },
        },
      };
    }
    case "scroll": {
      const x = finiteNumberFromInput(input?.x);
      const y = finiteNumberFromInput(input?.y);
      const deltaX = finiteNumberFromInput(input?.deltaX);
      const deltaY = finiteNumberFromInput(input?.deltaY);
      if (
        x === undefined ||
        y === undefined ||
        deltaX === undefined ||
        deltaY === undefined
      ) {
        return failure(
          "invalid_workbench_command",
          "Scroll browser action requires numeric x, y, deltaX, and deltaY.",
        );
      }
      return {
        ok: true,
        value: {
          action: { ...base, x, y, deltaX, deltaY },
          setsDriving: true,
          agentCursor: { x, y },
        },
      };
    }
    case "key": {
      const keys = optionalString(input?.keys);
      if (keys === undefined) {
        return failure("invalid_workbench_command", "Key browser action requires keys.");
      }
      return { ok: true, value: { action: { ...base, keys }, setsDriving: true } };
    }
    case "type": {
      const text = optionalRawString(input?.text);
      if (text === undefined) {
        return failure("invalid_workbench_command", "Type browser action requires text.");
      }
      return { ok: true, value: { action: { ...base, text }, setsDriving: true } };
    }
  }
}

function nonNegativeIntegerFromInput(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

function boundedIntegerFromInput(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(Math.round(value), min), max);
}

// User takeover (D5): clear computer-use driving state so
// the user regains the page immediately. Pure over the thread's pane list.
export function releaseAgentBrowserControl(
  thread: ThreadRecord,
  paneId: string | undefined,
  idGenerator: () => string,
  clock: () => string,
): ServiceResult<{ value: { paneId: string } }> {
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
  const releasedAt = clock();
  pane.agentDriving = false;
  delete pane.agentCursor;
  // Mark the pane user-controlled so the agent's next drive attempt is softly refused
  // (it yields + continues) rather than re-grabbing or erroring on the bumped revision.
  pane.userControlled = true;
  pane.revision = idGenerator();
  pane.updatedAt = releasedAt;
  thread.updatedAt = releasedAt;
  return { ok: true, value: { paneId: pane.paneId } };
}

// Turn end / runtime no longer driving: drop the "agent is driving" overlay state on
// the Thread's Browser Panes so the on-screen theater + lock auto-dismiss. Returns whether
// anything changed. Spec: docs_v2/specs/browser-pane-agent-computer-use.md.
export function clearAgentBrowserDriving(thread: ThreadRecord): boolean {
  let changed = false;
  for (const pane of thread.workbench.panes) {
    if (
      pane.kind === "browser" &&
      (pane.agentDriving === true || pane.agentCursor !== undefined || pane.userControlled === true)
    ) {
      pane.agentDriving = false;
      delete pane.agentCursor;
      // Fresh turn ⇒ the agent may drive again; clear the user-control gate.
      delete pane.userControlled;
      changed = true;
    }
  }
  return changed;
}
