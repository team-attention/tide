import type { ThreadId } from "../../domains/thread/thread.ts";
import type {
  BrowserPaneActionRequest,
  BrowserPaneInteractiveElement,
  BrowserPaneScreenshot,
  WorkbenchPaneId,
} from "../../domains/workbench/workbench.ts";

export interface BrowserRuntimeKey {
  threadId: ThreadId;
  paneId: WorkbenchPaneId;
}

export type BrowserRuntimeObserveMode = "text" | "screenshot" | "both";

export interface BrowserRuntimeObservation {
  url?: string;
  title?: string;
  pageTitle?: string;
  bodyTextPreview?: string;
  interactiveElements?: BrowserPaneInteractiveElement[];
  screenshot?: BrowserPaneScreenshot;
  loading: boolean;
}

export interface BrowserRuntimeError {
  code: string;
  message: string;
}

export type BrowserRuntimeResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: BrowserRuntimeError };

export interface BrowserRuntimeEnsureInput extends BrowserRuntimeKey {
  url?: string;
  title?: string;
}

export interface BrowserRuntimeObserveInput extends BrowserRuntimeKey {
  mode: BrowserRuntimeObserveMode;
}

export interface BrowserRuntimeActInput extends BrowserRuntimeKey {
  action: BrowserPaneActionRequest;
}

export interface BrowserRuntimeActionResult {
  status: "completed" | "failed";
  message: string;
  completedAt: string;
  observation: BrowserRuntimeObservation;
}

export interface BrowserRuntimeCloseInput extends BrowserRuntimeKey {
  reason: "pane_closed" | "thread_archived" | "app_quit" | "idle";
}

export interface BrowserRuntimePort {
  ensure(
    input: BrowserRuntimeEnsureInput,
  ): Promise<BrowserRuntimeResult<{ observation: BrowserRuntimeObservation }>>;
  observe(
    input: BrowserRuntimeObserveInput,
  ): Promise<BrowserRuntimeResult<{ observation: BrowserRuntimeObservation }>>;
  act(input: BrowserRuntimeActInput): Promise<BrowserRuntimeResult<BrowserRuntimeActionResult>>;
  close(input: BrowserRuntimeCloseInput): Promise<BrowserRuntimeResult<void>>;
}
