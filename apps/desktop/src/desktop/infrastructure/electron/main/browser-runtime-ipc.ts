import {
  BrowserWindow,
  ipcMain,
} from "electron";
import type {
  BrowserRuntimeRendererCommandDto,
  BrowserRuntimeStageDto,
} from "../../../../shared/contracts/index.ts";
import type { BrowserRuntimeHost } from "./browser-runtime-host.ts";

export function registerBrowserRuntimeIpc(browserRuntimeHost: BrowserRuntimeHost): void {
  if (process.env.TIDE_ENABLE_BROWSER_RUNTIME_TEST_HOOKS === "1") {
    const testGlobal = globalThis as typeof globalThis & {
      __tideBrowserRuntimeHost?: BrowserRuntimeHost;
    };
    testGlobal.__tideBrowserRuntimeHost = browserRuntimeHost;
  }

  ipcMain.on("tide:browser-runtime-stage", (event, stage: BrowserRuntimeStageDto) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window === null || !isBrowserRuntimeStage(stage)) {
      return;
    }
    browserRuntimeHost.setStage(window, stage);
  });

  ipcMain.handle(
    "tide:browser-runtime-command",
    async (_event, command: BrowserRuntimeRendererCommandDto) => {
      if (!isBrowserRuntimeRendererCommand(command)) {
        return;
      }
      await browserRuntimeHost.handleRendererCommand(command);
    },
  );
}

function isBrowserRuntimeStage(value: unknown): value is BrowserRuntimeStageDto {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as {
    threadId?: unknown;
    paneId?: unknown;
    visible?: unknown;
    bounds?: unknown;
    overlay?: unknown;
  };
  return (
    typeof record.threadId === "string" &&
    typeof record.paneId === "string" &&
    typeof record.visible === "boolean" &&
    (record.bounds === null || isBrowserRuntimeBounds(record.bounds)) &&
    (record.overlay === undefined || isBrowserRuntimeOverlay(record.overlay))
  );
}

function isBrowserRuntimeRendererCommand(
  value: unknown,
): value is BrowserRuntimeRendererCommandDto {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as {
    threadId?: unknown;
    paneId?: unknown;
    kind?: unknown;
    url?: unknown;
  };
  return (
    typeof record.threadId === "string" &&
    typeof record.paneId === "string" &&
    (record.kind === "goBack" ||
      record.kind === "goForward" ||
      record.kind === "reload" ||
      (record.kind === "navigate" && typeof record.url === "string"))
  );
}

function isBrowserRuntimeBounds(value: unknown): value is BrowserRuntimeStageDto["bounds"] {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as { x?: unknown; y?: unknown; width?: unknown; height?: unknown };
  return (
    typeof record.x === "number" &&
    typeof record.y === "number" &&
    typeof record.width === "number" &&
    typeof record.height === "number" &&
    Number.isFinite(record.x) &&
    Number.isFinite(record.y) &&
    Number.isFinite(record.width) &&
    Number.isFinite(record.height)
  );
}

function isBrowserRuntimeOverlay(value: unknown): value is NonNullable<BrowserRuntimeStageDto["overlay"]> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as { agentDriving?: unknown; cursor?: unknown };
  return (
    typeof record.agentDriving === "boolean" &&
    (record.cursor === undefined || isBrowserRuntimePoint(record.cursor))
  );
}

function isBrowserRuntimePoint(value: unknown): value is { x: number; y: number } {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as { x?: unknown; y?: unknown };
  return (
    typeof record.x === "number" &&
    typeof record.y === "number" &&
    Number.isFinite(record.x) &&
    Number.isFinite(record.y)
  );
}
