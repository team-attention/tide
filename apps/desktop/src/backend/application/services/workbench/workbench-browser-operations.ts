import type { ThreadRecord } from "../../domains/thread/thread.ts";
import type {
  BrowserPaneActionRequest,
  BrowserPaneScreenshot,
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

// Pull a FRESH pixel capture from the renderer for this observe (mode=screenshot|both):
// returns the captured screenshot, or undefined when capture is unavailable (timed out / pane
// not painting) so observe degrades to the cached image. Provided by the MCP handler, which
// owns the pendingCapture round-trip; omitted by callers (e.g. tests) that want the cache-only
// behaviour. Spec: docs_v2/specs/browser-pane-screenshot-on-load-decoupling.md.
export type BrowserScreenshotPuller = (
  pane: BrowserPaneState,
) => Promise<BrowserPaneScreenshot | undefined>;

export async function observeBrowserOutput(
  thread: ThreadRecord,
  input: Record<string, unknown> | undefined,
  pullScreenshot?: BrowserScreenshotPuller,
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
  // Pixel vision is pulled ON DEMAND at observe time, not eagerly on every page-load: ask the
  // renderer to capture the live <webview> now and cache the result. Fall back to the last
  // cached screenshot when the pull yields nothing. text mode never captures.
  if (mode !== "text" && pullScreenshot !== undefined) {
    try {
      const fresh = await pullScreenshot(pane);
      if (fresh !== undefined) {
        pane.screenshot = fresh;
      }
    } catch {
      // An unexpected puller failure (IPC / coordinator) degrades to the cached screenshot or
      // DOM text below — never fail the whole observe tool call (Gemini review).
    }
  }
  // Attach the screenshot only for mode=screenshot|both (default text → no image, back-compat +
  // token cost). screenshot-only drops the DOM-text body.
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
  if (pane.userControlled === true) {
    // The user took manual control of this pane. Don't drive it (and don't re-grab) —
    // yield and continue: observe the current state and proceed or ask the user.
    return failure(
      "workbench_user_controlled",
      "The user has taken manual control of this browser pane, so it is no longer agent-driven. " +
        "Do not drive it; re-observe to see the current page, then continue your response or ask the user how to proceed.",
    );
  }
  if (pane.pendingAction !== undefined) {
    // A real conflict: an action is already in flight. The agent must let it settle and
    // re-observe (which returns the result + a fresh revision) before driving again.
    return failure(
      "invalid_workbench_command",
      "Browser Pane already has a pending action.",
    );
  }
  if (
    revision !== pane.revision &&
    !(revision === pane.priorRevision && pane.loading !== true)
  ) {
    // D5 (spec: browser-pane-live-pull-vision.md) + D3: a stale revision is rejected EXCEPT
    // the one safe case — the caller's token is the pane's immediately-prior revision from a
    // settled act-completion (`priorRevision`, which is cleared on navigation), i.e. the
    // agent's OWN already-settled action advanced the token. There we auto-retry against the
    // current revision instead of failing — that failure is what forced weak models into a
    // close/reopen thrash. A genuinely stale token (older, or advanced by a navigation) still
    // errors, handing back the current revision so the agent re-observes the new page.
    return failure(
      "workbench_stale_reference",
      `Browser Pane revision is stale. The pane is now at revision "${pane.revision}"; if it has not navigated since you observed it, retry this action with that revision.`,
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
  // No re-mint on the act itself (D5 "no re-mint on no-op act"): queuing an action does not
  // change the page, so the agent's observed revision stays valid for its next act. The
  // revision advances only when the page actually changes — on action completion
  // (update_browser_action_result) or navigation.
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
  // Mark the pane user-controlled so the agent's next drive attempt is softly refused
  // (it yields + continues) rather than re-grabbing or erroring on the bumped revision.
  pane.userControlled = true;
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
