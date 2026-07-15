import {
  arrayOfStrings,
  recordOfStrings,
  stringField,
} from "../support/record-helpers.ts";
import {
  boundedBrowserTextPreview,
  numberFromData,
  optionalString,
} from "../support/service-value-helpers.ts";
import type {
  BrowserPaneInteractiveElement,
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
  providerReadinessKind?: string;
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
    providerReadinessKind: stringField(data, "blockerKind"),
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
      interactiveElements?: BrowserPaneInteractiveElement[];
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
    interactiveElements: browserPaneInteractiveElementsFromData(data?.interactiveElements),
    loading: typeof data?.loading === "boolean" ? data.loading : undefined,
    screenshot: browserPaneScreenshotFromData(data?.screenshot),
  };
}

function browserPaneInteractiveElementsFromData(
  value: unknown,
): BrowserPaneInteractiveElement[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const elements: BrowserPaneInteractiveElement[] = [];
  for (const item of value.slice(0, 80)) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const rectRecord =
      record.rect !== null && typeof record.rect === "object" && !Array.isArray(record.rect)
        ? (record.rect as Record<string, unknown>)
        : undefined;
    const index = nonNegativeIntegerFromData(record, "index");
    const tag = optionalString(record.tag);
    const x = rectRecord === undefined ? undefined : finiteNumberFromData(rectRecord, "x");
    const y = rectRecord === undefined ? undefined : finiteNumberFromData(rectRecord, "y");
    const width = rectRecord === undefined ? undefined : finiteNumberFromData(rectRecord, "width");
    const height = rectRecord === undefined ? undefined : finiteNumberFromData(rectRecord, "height");
    if (
      index === undefined ||
      tag === undefined ||
      x === undefined ||
      y === undefined ||
      width === undefined ||
      height === undefined
    ) {
      continue;
    }
    elements.push({
      index,
      tag: tag.slice(0, 32),
      role: optionalString(record.role)?.slice(0, 64),
      type: optionalString(record.type)?.slice(0, 64),
      text: optionalString(record.text)?.slice(0, 240),
      ariaLabel: optionalString(record.ariaLabel)?.slice(0, 160),
      placeholder: optionalString(record.placeholder)?.slice(0, 160),
      href: optionalString(record.href)?.slice(0, 512),
      disabled: typeof record.disabled === "boolean" ? record.disabled : undefined,
      rect: { x, y, width, height },
    });
  }
  return elements.length === 0 ? undefined : elements;
}

function nonNegativeIntegerFromData(
  data: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = data[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

function finiteNumberFromData(
  data: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = data[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

// Parse a pixel-vision capture from command data. Requires base64 data + positive width/height; mimeType defaults
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
