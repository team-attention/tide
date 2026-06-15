import type { ThreadRecord } from "../../domains/thread/thread.ts";
import type {
  BrowserPaneActionRequest,
  BrowserPaneState,
} from "../../domains/workbench/workbench.ts";
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

// Seed adopted composer-screen panes into a freshly-created Thread's Workbench
// (called from startThread, race-free — they ride along in the first snapshot).
// Browser panes are pure/synchronous; editor panes read the file via the passed
// openEditorFile (best-effort — a failed read is skipped so a bad path never fails
// thread start). See docs_v2/specs/workbench-dock-parity.md.
export async function seedInitialWorkbenchPanes(
  thread: ThreadRecord,
  panes: Array<{ kind: "browser" | "editor"; url?: string; path?: string; title?: string }> | undefined,
  idGenerator: () => string,
  clock: () => string,
  openEditorFile: (thread: ThreadRecord, input: { path: string }) => Promise<unknown>,
): Promise<void> {
  if (panes === undefined || panes.length === 0) {
    return;
  }
  for (const pane of panes) {
    if (pane.kind === "browser") {
      openBrowserOutput(
        thread,
        { url: pane.url, title: pane.title, disposition: "new_browser_pane" },
        idGenerator,
        clock,
      );
    } else if (pane.kind === "editor" && pane.path !== undefined) {
      await openEditorFile(thread, { path: pane.path });
    }
  }
  // The first send drives the turn; the agent — not the Workbench — owns focus.
  thread.workbench.focusOwner = "composer";
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

  // Pixel vision: attach the cached screenshot only for mode=screenshot|both (default
  // text → no image, back-compat + token cost). screenshot-only drops the DOM-text body.
  const mode = browserObserveModeFromInput(input?.mode);
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

// Hybrid action model (docs_v2/specs/browser-pane-agent-computer-use.md): the selector
// path ("click"/"type_text") is the unchanged reliability fallback and never starts
// driving; the coordinate path ("move_to"/"click_at"/"scroll"/"key"/"type") is the
// "human" computer-use path and starts agentDriving (+ agentCursor where it has a point).
export function actBrowserOutput(
  thread: ThreadRecord,
  input: Record<string, unknown> | undefined,
  idGenerator: () => string,
  clock: () => string,
): ServiceResult<{ value: TideActBrowserOutput }> {
  const paneId = optionalString(input?.paneId);
  const revision = optionalString(input?.revision);
  const actionKind = browserActionKindFromInput(input?.action);
  if (paneId === undefined || revision === undefined || actionKind === undefined) {
    return failure(
      "invalid_workbench_command",
      "Browser action requires pane id, revision, and a supported action.",
    );
  }

  const built = buildBrowserActionRequest(actionKind, input, idGenerator(), clock());
  if (!built.ok) {
    return built;
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
    // D3 (spec: browser-pane-action-revision-race): hand the caller the CURRENT
    // revision so it can retry once against it (e.g. when its own prior action, not a
    // navigation, advanced the token). The agent decides — if it expects the page to
    // have moved it should re-observe instead.
    return failure(
      "workbench_stale_reference",
      `Browser Pane revision is stale. The pane is now at revision "${pane.revision}"; if it has not navigated since you observed it, retry this action with that revision.`,
    );
  }
  if (pane.pendingAction !== undefined) {
    return failure(
      "invalid_workbench_command",
      "Browser Pane already has a pending action.",
    );
  }

  const { action, setsDriving, agentCursor } = built.value;
  pane.pendingAction = action;
  if (setsDriving) {
    pane.agentDriving = true;
    if (agentCursor !== undefined) {
      pane.agentCursor = agentCursor;
    }
  }
  pane.revision = idGenerator();
  pane.updatedAt = action.requestedAt;
  thread.updatedAt = action.requestedAt;

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

// User takeover (D5): clear computer-use driving state and any queued agent input so
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
  delete pane.pendingAction;
  pane.revision = idGenerator();
  pane.updatedAt = releasedAt;
  thread.updatedAt = releasedAt;
  return { ok: true, value: { paneId: pane.paneId } };
}

// Turn end / runtime no longer driving: drop the "agent is driving" overlay state on
// the Thread's Browser Panes so the on-screen theater + lock auto-dismiss. Leaves any
// in-flight pendingAction to settle via its own result path. Returns whether anything
// changed. Spec: docs_v2/specs/browser-pane-agent-computer-use.md.
export function clearAgentBrowserDriving(thread: ThreadRecord): boolean {
  let changed = false;
  for (const pane of thread.workbench.panes) {
    if (pane.kind === "browser" && (pane.agentDriving === true || pane.agentCursor !== undefined)) {
      pane.agentDriving = false;
      delete pane.agentCursor;
      changed = true;
    }
  }
  return changed;
}
