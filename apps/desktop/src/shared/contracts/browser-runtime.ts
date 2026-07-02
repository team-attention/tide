import type {
  BrowserPaneActionDto,
  BrowserPaneInteractiveElementDto,
} from "./workbench.ts";

export interface BrowserRuntimeKeyDto {
  threadId: string;
  paneId: string;
}

export type BrowserRuntimeObserveModeDto = "text" | "screenshot" | "both";

export interface BrowserRuntimeBoundsDto {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserRuntimeScreenshotDto {
  data: string;
  mimeType: "image/png" | "image/jpeg";
  width: number;
  height: number;
  devicePixelRatio: number;
}

export interface BrowserRuntimeObservationDto {
  url?: string;
  title?: string;
  pageTitle?: string;
  bodyTextPreview?: string;
  interactiveElements?: BrowserPaneInteractiveElementDto[];
  screenshot?: BrowserRuntimeScreenshotDto;
  loading: boolean;
}

export interface BrowserRuntimeEnsureRequestDto extends BrowserRuntimeKeyDto {
  url?: string;
  title?: string;
}

export interface BrowserRuntimeObserveRequestDto extends BrowserRuntimeKeyDto {
  mode: BrowserRuntimeObserveModeDto;
}

export interface BrowserRuntimeActRequestDto extends BrowserRuntimeKeyDto {
  action: BrowserPaneActionDto;
}

export interface BrowserRuntimeCloseRequestDto extends BrowserRuntimeKeyDto {
  reason: "pane_closed" | "thread_archived" | "app_quit" | "idle";
}

export type BrowserRuntimeRequestPayloadDto =
  | BrowserRuntimeEnsureRequestDto
  | BrowserRuntimeObserveRequestDto
  | BrowserRuntimeActRequestDto
  | BrowserRuntimeCloseRequestDto;

export type BrowserRuntimeOperationDto = "ensure" | "observe" | "act" | "close";

export interface BrowserRuntimeRequestEnvelopeDto {
  kind: "browserRuntime.request";
  requestId: string;
  operation: BrowserRuntimeOperationDto;
  payload: BrowserRuntimeRequestPayloadDto;
}

export type BrowserRuntimeResponsePayloadDto =
  | { observation: BrowserRuntimeObservationDto }
  | {
      status: "completed" | "failed";
      message: string;
      completedAt: string;
      observation: BrowserRuntimeObservationDto;
    }
  | { closed: true };

export interface BrowserRuntimeResponseEnvelopeDto {
  kind: "browserRuntime.response";
  requestId: string;
  ok: boolean;
  payload?: BrowserRuntimeResponsePayloadDto;
  error?: {
    code: string;
    message: string;
  };
}

export interface BrowserRuntimeStageDto extends BrowserRuntimeKeyDto {
  bounds: BrowserRuntimeBoundsDto | null;
  visible: boolean;
  url?: string;
  title?: string;
  overlay?: {
    agentDriving: boolean;
    cursor?: {
      x: number;
      y: number;
    };
  };
}

export type BrowserRuntimeRendererCommandDto =
  | (BrowserRuntimeKeyDto & { kind: "navigate"; url: string })
  | (BrowserRuntimeKeyDto & { kind: "goBack" | "goForward" | "reload" });

export function isBrowserRuntimeResponseEnvelope(
  value: unknown,
): value is BrowserRuntimeResponseEnvelopeDto {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as { kind?: unknown; requestId?: unknown; ok?: unknown };
  return (
    record.kind === "browserRuntime.response" &&
    typeof record.requestId === "string" &&
    typeof record.ok === "boolean"
  );
}

export function isBrowserRuntimeRequestEnvelope(
  value: unknown,
): value is BrowserRuntimeRequestEnvelopeDto {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as {
    kind?: unknown;
    requestId?: unknown;
    operation?: unknown;
    payload?: unknown;
  };
  return (
    record.kind === "browserRuntime.request" &&
    typeof record.requestId === "string" &&
    (record.operation === "ensure" ||
      record.operation === "observe" ||
      record.operation === "act" ||
      record.operation === "close") &&
    typeof record.payload === "object" &&
    record.payload !== null
  );
}
