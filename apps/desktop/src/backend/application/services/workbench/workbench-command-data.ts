import {
  arrayOfStrings,
  recordOfStrings,
  stringField,
} from "../support/record-helpers.ts";
import {
  boundedBrowserTextPreview,
  numberFromData,
  optionalRawString,
  optionalString,
} from "../support/service-value-helpers.ts";
import type {
  BrowserPaneScreenshot,
  TerminalPaneState,
  WorkbenchLayoutMode,
} from "../../domains/workbench/workbench.ts";

// Parsers that coerce untyped Tide MCP / workbench command `data` payloads into
// the typed shapes the service acts on. Pure: depend only on leaf value/record
// helpers. Extracted from thread-runtime-service.ts to keep the service focused
// on behavior.

// Coerce a "stacked" | "split" layout-mode value (from set_layout_mode command
// data or the tide_set_workbench_layout tool input). Unknown values => undefined.
export function workbenchLayoutModeFromValue(value: unknown): WorkbenchLayoutMode | undefined {
  return value === "stacked" || value === "split" ? value : undefined;
}

export type WorkbenchTerminalExpectedCompletion =
  NonNullable<TerminalPaneState["expectedCompletion"]>;

export interface WorkbenchTerminalCommandInput {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  title?: string;
  terminalRole?: TerminalPaneState["terminalRole"];
  expectedCompletion?: WorkbenchTerminalExpectedCompletion;
}

export function workbenchTerminalCommandFromData(
  data: Record<string, unknown> | undefined,
): WorkbenchTerminalCommandInput {
  const terminalRole = stringField(data, "terminalRole");
  const expectedCompletion = stringField(data, "expectedCompletion");
  return {
    command: stringField(data, "command"),
    args: data?.args === undefined ? undefined : arrayOfStrings(data.args),
    env: recordOfStrings(data?.env),
    cwd: stringField(data, "cwd"),
    title: stringField(data, "title"),
    terminalRole: terminalRole === "provider_readiness" ? terminalRole : undefined,
    expectedCompletion:
      expectedCompletion === "process_exit" || expectedCompletion === "retry_preflight"
        ? expectedCompletion
        : undefined,
  };
}

export function terminalInputFromData(
  data: Record<string, unknown> | undefined,
): string | undefined {
  const input = data?.input ?? data?.bytes;
  return typeof input === "string" && input.length > 0 ? input : undefined;
}

export function editorPaneSaveFromData(
  data: Record<string, unknown> | undefined,
): { baseRevision: string; content: string } | undefined {
  const baseRevision = stringField(data, "baseRevision");
  const content = data?.content;
  if (baseRevision === undefined || typeof content !== "string") {
    return undefined;
  }
  return { baseRevision, content };
}

export function editorPanePositionFromData(
  data: Record<string, unknown> | undefined,
): { line: number; character: number } | undefined {
  const line = data?.line;
  const character = data?.character;
  if (
    typeof line !== "number" ||
    typeof character !== "number" ||
    !Number.isInteger(line) ||
    !Number.isInteger(character) ||
    line < 0 ||
    character < 0
  ) {
    return undefined;
  }
  return { line, character };
}

export function browserPaneSnapshotFromData(
  data: Record<string, unknown> | undefined,
):
  | {
      revision: string;
      url?: string;
      pageTitle?: string;
      bodyTextPreview?: string;
      loading?: boolean;
      screenshot?: BrowserPaneScreenshot;
    }
  | undefined {
  const revision = optionalString(data?.revision);
  if (revision === undefined) {
    return undefined;
  }
  const bodyTextPreview =
    typeof data?.bodyTextPreview === "string"
      ? boundedBrowserTextPreview(data.bodyTextPreview)
      : undefined;
  return {
    revision,
    url: optionalString(data?.url),
    pageTitle: optionalString(data?.pageTitle),
    bodyTextPreview,
    loading: typeof data?.loading === "boolean" ? data.loading : undefined,
    screenshot: browserPaneScreenshotFromData(data?.screenshot),
  };
}

// Parse the renderer's reply to an observe-time capture pull (update_browser_capture_result):
// the captureId being answered plus an optional screenshot (absent when the guest could not be
// captured — observe then degrades to the cached image / DOM text).
export function browserPaneCaptureResultFromData(
  data: Record<string, unknown> | undefined,
): { captureId: string; screenshot?: BrowserPaneScreenshot } | undefined {
  const captureId = optionalString(data?.captureId);
  if (captureId === undefined) {
    return undefined;
  }
  return { captureId, screenshot: browserPaneScreenshotFromData(data?.screenshot) };
}

// Parse a pixel-vision capture from update_browser_snapshot command data (renderer's
// webview.capturePage). Requires base64 data + positive width/height; mimeType defaults
// to image/png, devicePixelRatio to 1.
function browserPaneScreenshotFromData(value: unknown): BrowserPaneScreenshot | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const data =
    typeof record.data === "string" && record.data.length > 0 ? record.data : undefined;
  const width = numberFromData(record, "width");
  const height = numberFromData(record, "height");
  if (data === undefined || width === undefined || height === undefined) {
    return undefined;
  }
  return {
    data,
    mimeType: record.mimeType === "image/jpeg" ? "image/jpeg" : "image/png",
    width,
    height,
    devicePixelRatio: numberFromData(record, "devicePixelRatio") ?? 1,
  };
}

export function browserPaneActionResultFromData(
  data: Record<string, unknown> | undefined,
):
  | {
      revision: string;
      actionId: string;
      status: "completed" | "failed";
      message: string;
      url?: string;
      pageTitle?: string;
      bodyTextPreview?: string;
      loading?: boolean;
    }
  | undefined {
  const revision = optionalString(data?.revision);
  const actionId = optionalString(data?.actionId);
  const status =
    data?.status === "completed" || data?.status === "failed" ? data.status : undefined;
  const message = optionalRawString(data?.message);
  if (
    revision === undefined ||
    actionId === undefined ||
    status === undefined ||
    message === undefined
  ) {
    return undefined;
  }
  const bodyTextPreview =
    typeof data?.bodyTextPreview === "string"
      ? boundedBrowserTextPreview(data.bodyTextPreview)
      : undefined;
  return {
    revision,
    actionId,
    status,
    message,
    url: optionalString(data?.url),
    pageTitle: optionalString(data?.pageTitle),
    bodyTextPreview,
    loading: typeof data?.loading === "boolean" ? data.loading : undefined,
  };
}
