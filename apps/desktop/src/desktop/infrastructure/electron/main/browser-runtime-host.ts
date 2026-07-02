import {
  BrowserWindow,
  WebContentsView,
  type WebContents,
  type Rectangle,
} from "electron";
import type {
  BrowserRuntimeActRequestDto,
  BrowserRuntimeCloseRequestDto,
  BrowserRuntimeEnsureRequestDto,
  BrowserRuntimeObservationDto,
  BrowserRuntimeObserveRequestDto,
  BrowserRuntimeRendererCommandDto,
  BrowserRuntimeRequestEnvelopeDto,
  BrowserRuntimeResponseEnvelopeDto,
  BrowserRuntimeStageDto,
} from "../../../../shared/contracts/index.ts";
import {
  BROWSER_RUNTIME_OVERLAY_TAKE_CONTROL_URL,
  browserRuntimeOverlayDataUrl,
} from "./browser-runtime-overlay.ts";
import { performBrowserRuntimeAction } from "./browser-runtime-input.ts";

const BROWSER_PARTITION = "persist:tide-workbench-browser";
const DEFAULT_CAPTURE_BOUNDS: Rectangle = { x: 0, y: 0, width: 1280, height: 720 };
const POST_ACTION_SETTLE_MS = 120;
const LOAD_SETTLE_TIMEOUT_MS = 8_000;

interface BrowserRuntime {
  key: string;
  threadId: string;
  paneId: string;
  view: WebContentsView;
  overlayView: WebContentsView;
  attachedWindowId: number | null;
  overlayAttachedWindowId: number | null;
  overlaySignature: string | null;
  stage: BrowserRuntimeStageDto | null;
  queue: Promise<void>;
}

export class BrowserRuntimeHost {
  private readonly runtimes = new Map<string, BrowserRuntime>();
  private readonly pendingStages = new Map<
    string,
    { windowId: number; stage: BrowserRuntimeStageDto }
  >();
  private captureWindow: BrowserWindow | null = null;

  async handleRequest(
    request: BrowserRuntimeRequestEnvelopeDto,
  ): Promise<BrowserRuntimeResponseEnvelopeDto> {
    try {
      switch (request.operation) {
        case "ensure": {
          const payload = request.payload as BrowserRuntimeEnsureRequestDto;
          const runtime = this.ensureRuntime(payload);
          await this.enqueue(runtime, async () => {
            if (payload.url !== undefined && payload.url.length > 0) {
              await this.navigate(runtime, payload.url);
            }
          });
          return this.ok(request.requestId, {
            observation: await this.observeRuntime(runtime, "text"),
          });
        }
        case "observe": {
          const payload = request.payload as BrowserRuntimeObserveRequestDto;
          const runtime = this.ensureRuntime(payload);
          const observation = await this.enqueue(runtime, () =>
            this.observeRuntime(runtime, payload.mode),
          );
          return this.ok(request.requestId, { observation });
        }
        case "act": {
          const payload = request.payload as BrowserRuntimeActRequestDto;
          const runtime = this.ensureRuntime(payload);
          const result = await this.enqueue(runtime, async () => {
            await this.performAction(runtime, payload.action);
            await delay(POST_ACTION_SETTLE_MS);
            return {
              status: "completed" as const,
              message: `Browser action ${payload.action.kind} completed.`,
              completedAt: new Date().toISOString(),
              observation: await this.observeRuntime(runtime, "text"),
            };
          });
          return this.ok(request.requestId, result);
        }
        case "close": {
          const payload = request.payload as BrowserRuntimeCloseRequestDto;
          this.closeRuntime(payload.threadId, payload.paneId);
          return this.ok(request.requestId, { closed: true });
        }
        default: {
          throw new Error(`Unknown BrowserRuntime operation: ${String(request.operation)}`);
        }
      }
    } catch (error) {
      return {
        kind: "browserRuntime.response",
        requestId: request.requestId,
        ok: false,
        error: {
          code: "browser_runtime_error",
          message: error instanceof Error ? error.message : "BrowserRuntime request failed.",
        },
      };
    }
  }

  setStage(window: BrowserWindow, stage: BrowserRuntimeStageDto): void {
    const key = runtimeKey(stage.threadId, stage.paneId);
    this.pendingStages.set(key, { windowId: window.id, stage });
    const runtime = this.runtimes.get(key);
    if (runtime === undefined) {
      if (stage.visible && stage.bounds !== null) {
        const created = this.ensureRuntime(stage);
        if (stage.url !== undefined && stage.url.length > 0) {
          void this.enqueue(created, () => this.navigate(created, stage.url ?? ""));
        }
      }
      return;
    }
    runtime.stage = stage;
    if (stage.visible && stage.bounds !== null && validBounds(stage.bounds)) {
      this.attachToWindow(runtime, window, roundedBounds(stage.bounds));
      return;
    }
    this.detachOverlay(runtime);
    this.detachFromVisibleWindow(runtime);
  }

  async handleRendererCommand(command: BrowserRuntimeRendererCommandDto): Promise<void> {
    const runtime = this.ensureRuntime(command);
    await this.enqueue(runtime, async () => {
      switch (command.kind) {
        case "navigate":
          await this.navigate(runtime, command.url);
          break;
        case "goBack":
          if (runtime.view.webContents.canGoBack()) {
            runtime.view.webContents.goBack();
          }
          break;
        case "goForward":
          if (runtime.view.webContents.canGoForward()) {
            runtime.view.webContents.goForward();
          }
          break;
        case "reload":
          runtime.view.webContents.reload();
          break;
      }
    });
  }

  closeAll(reason: BrowserRuntimeCloseRequestDto["reason"]): void {
    void reason;
    for (const runtime of this.runtimes.values()) {
      this.destroyRuntime(runtime);
    }
    this.runtimes.clear();
    if (this.captureWindow !== null && !this.captureWindow.isDestroyed()) {
      this.captureWindow.destroy();
    }
    this.captureWindow = null;
  }

  private ensureRuntime(input: { threadId: string; paneId: string }): BrowserRuntime {
    const key = runtimeKey(input.threadId, input.paneId);
    const existing = this.runtimes.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const view = new WebContentsView({
      webPreferences: {
        partition: BROWSER_PARTITION,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    const overlayView = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        transparent: true,
        backgroundThrottling: false,
      },
    });
    overlayView.setBackgroundColor("#00000000");
    const runtime: BrowserRuntime = {
      key,
      threadId: input.threadId,
      paneId: input.paneId,
      view,
      overlayView,
      attachedWindowId: null,
      overlayAttachedWindowId: null,
      overlaySignature: null,
      stage: this.pendingStages.get(key)?.stage ?? null,
      queue: Promise.resolve(),
    };
    overlayView.webContents.on("will-navigate", (event, url) => {
      if (url.startsWith(BROWSER_RUNTIME_OVERLAY_TAKE_CONTROL_URL)) {
        event.preventDefault();
        this.releaseControlFromOverlay(runtime);
      }
    });
    overlayView.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith(BROWSER_RUNTIME_OVERLAY_TAKE_CONTROL_URL)) {
        this.releaseControlFromOverlay(runtime);
      }
      return { action: "deny" };
    });
    view.webContents.setWindowOpenHandler(({ url }) => {
      if (isHttpUrl(url)) {
        this.openPopupInBrowserPane(runtime, url);
      }
      return { action: "deny" };
    });
    this.runtimes.set(key, runtime);
    const pendingStage = this.pendingStages.get(key);
    if (
      pendingStage !== undefined &&
      pendingStage.stage.visible &&
      pendingStage.stage.bounds !== null
    ) {
      const window = BrowserWindow.fromId(pendingStage.windowId);
      if (window !== null) {
        this.attachToWindow(runtime, window, roundedBounds(pendingStage.stage.bounds));
      }
    }
    return runtime;
  }

  private closeRuntime(threadId: string, paneId: string): void {
    const key = runtimeKey(threadId, paneId);
    const runtime = this.runtimes.get(key);
    if (runtime === undefined) {
      return;
    }
    this.destroyRuntime(runtime);
    this.runtimes.delete(key);
    this.pendingStages.delete(key);
  }

  private destroyRuntime(runtime: BrowserRuntime): void {
    this.detachFromVisibleWindow(runtime);
    const overlayWebContents = runtime.overlayView.webContents;
    if (!overlayWebContents.isDestroyed()) {
      overlayWebContents.close({ waitForBeforeUnload: false });
    }
    const webContents = runtime.view.webContents;
    if (!webContents.isDestroyed()) {
      webContents.close({ waitForBeforeUnload: false });
    }
  }

  private attachToWindow(runtime: BrowserRuntime, window: BrowserWindow, bounds: Rectangle): void {
    if (window.isDestroyed()) {
      return;
    }
    if (runtime.attachedWindowId !== window.id) {
      this.detachFromVisibleWindow(runtime);
      window.contentView.addChildView(runtime.view);
      runtime.attachedWindowId = window.id;
    }
    runtime.view.setBounds(bounds);
    this.updateOverlay(runtime, window, bounds);
  }

  private detachFromVisibleWindow(runtime: BrowserRuntime): void {
    this.detachOverlay(runtime);
    if (runtime.attachedWindowId === null) {
      return;
    }
    const window = BrowserWindow.fromId(runtime.attachedWindowId);
    if (window !== null && !window.isDestroyed()) {
      try {
        window.contentView.removeChildView(runtime.view);
      } catch {
        // The view may already have moved to the hidden capture surface.
      }
    }
    runtime.attachedWindowId = null;
  }

  private updateOverlay(runtime: BrowserRuntime, window: BrowserWindow, bounds: Rectangle): void {
    const overlay = runtime.stage?.overlay;
    if (overlay?.agentDriving !== true || runtime.stage?.visible !== true) {
      this.detachOverlay(runtime);
      return;
    }
    if (window.isDestroyed()) {
      return;
    }
    if (runtime.overlayAttachedWindowId !== window.id) {
      this.detachOverlay(runtime);
      window.contentView.addChildView(runtime.overlayView);
      runtime.overlayAttachedWindowId = window.id;
    } else {
      window.contentView.addChildView(runtime.overlayView);
    }
    runtime.overlayView.setBounds(bounds);
    runtime.overlayView.setVisible(true);
    const signature = JSON.stringify({
      cursor: overlay.cursor ?? null,
      threadId: runtime.threadId,
      paneId: runtime.paneId,
    });
    if (runtime.overlaySignature !== signature) {
      runtime.overlaySignature = signature;
      void runtime.overlayView.webContents.loadURL(
        browserRuntimeOverlayDataUrl({
          cursor: overlay.cursor,
          threadId: runtime.threadId,
          paneId: runtime.paneId,
        }),
      );
    }
  }

  private detachOverlay(runtime: BrowserRuntime): void {
    if (runtime.overlayAttachedWindowId === null) {
      return;
    }
    const window = BrowserWindow.fromId(runtime.overlayAttachedWindowId);
    if (window !== null && !window.isDestroyed()) {
      try {
        window.contentView.removeChildView(runtime.overlayView);
      } catch {
        // The overlay may already have been removed while reparenting the browser view.
      }
    }
    runtime.overlayAttachedWindowId = null;
    runtime.overlaySignature = null;
    runtime.overlayView.setVisible(false);
  }

  private releaseControlFromOverlay(runtime: BrowserRuntime): void {
    const windowId = runtime.overlayAttachedWindowId ?? runtime.attachedWindowId;
    const window = windowId === null ? null : BrowserWindow.fromId(windowId);
    if (window === null || window.isDestroyed()) {
      return;
    }
    window.webContents.send(
      "tide:browser-runtime-release-control",
      runtime.threadId,
      runtime.paneId,
    );
  }

  private openPopupInBrowserPane(runtime: BrowserRuntime, url: string): void {
    const window = this.hostWindowForRuntime(runtime);
    if (window === null || window.isDestroyed()) {
      return;
    }
    window.webContents.send("tide:open-browser-pane", url, true);
  }

  private hostWindowForRuntime(runtime: BrowserRuntime): BrowserWindow | null {
    const pendingWindowId = this.pendingStages.get(runtime.key)?.windowId;
    const pendingWindow =
      pendingWindowId === undefined ? null : BrowserWindow.fromId(pendingWindowId);
    if (isUsableHostWindow(pendingWindow, this.captureWindow)) {
      return pendingWindow;
    }

    const attachedWindow =
      runtime.attachedWindowId === null ? null : BrowserWindow.fromId(runtime.attachedWindowId);
    if (isUsableHostWindow(attachedWindow, this.captureWindow)) {
      return attachedWindow;
    }

    return BrowserWindow.getAllWindows().find((candidate) =>
      isUsableHostWindow(candidate, this.captureWindow)
    ) ?? null;
  }

  private attachToCaptureSurface(runtime: BrowserRuntime): void {
    const stage = runtime.stage;
    if (stage?.visible === true && stage.bounds !== null && runtime.attachedWindowId !== null) {
      return;
    }
    this.detachOverlay(runtime);
    const window = this.ensureCaptureWindow();
    if (runtime.attachedWindowId !== window.id) {
      this.detachFromVisibleWindow(runtime);
      try {
        window.contentView.addChildView(runtime.view);
      } catch {
        // If Electron already moved the view, setBounds below is enough.
      }
      runtime.attachedWindowId = window.id;
    }
    runtime.view.setBounds(DEFAULT_CAPTURE_BOUNDS);
  }

  private ensureCaptureWindow(): BrowserWindow {
    if (this.captureWindow !== null && !this.captureWindow.isDestroyed()) {
      return this.captureWindow;
    }
    this.captureWindow = new BrowserWindow({
      show: false,
      width: DEFAULT_CAPTURE_BOUNDS.width,
      height: DEFAULT_CAPTURE_BOUNDS.height,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    return this.captureWindow;
  }

  private async navigate(runtime: BrowserRuntime, url: string): Promise<void> {
    const webContents = runtime.view.webContents;
    if (webContents.isDestroyed()) {
      throw new Error("BrowserRuntime WebContents was destroyed.");
    }
    if (webContents.getURL() === url && !webContents.isLoading()) {
      return;
    }
    this.attachToCaptureSurface(runtime);
    await webContents.loadURL(url);
    await waitForLoadSettle(webContents);
  }

  private async observeRuntime(
    runtime: BrowserRuntime,
    mode: BrowserRuntimeObserveRequestDto["mode"],
  ): Promise<BrowserRuntimeObservationDto> {
    const webContents = runtime.view.webContents;
    if (webContents.isDestroyed()) {
      throw new Error("BrowserRuntime WebContents was destroyed.");
    }
    if (mode !== "text") {
      this.attachToCaptureSurface(runtime);
      await waitForPaintableViewport(webContents);
    }
    const dom = await readDomSnapshot(webContents);
    const observation: BrowserRuntimeObservationDto = {
      url: webContents.getURL() || undefined,
      title: dom.title || webContents.getTitle() || undefined,
      pageTitle: dom.title || undefined,
      bodyTextPreview: dom.bodyTextPreview,
      interactiveElements: dom.interactiveElements,
      loading: webContents.isLoading(),
    };
    if (mode !== "text") {
      const image = await webContents.capturePage();
      const size = image.getSize();
      observation.screenshot = {
        data: image.toPNG().toString("base64"),
        mimeType: "image/png",
        width: size.width,
        height: size.height,
        devicePixelRatio: dom.devicePixelRatio,
      };
    }
    return observation;
  }

  private async performAction(
    runtime: BrowserRuntime,
    action: BrowserRuntimeActRequestDto["action"],
  ): Promise<void> {
    this.attachToCaptureSurface(runtime);
    await waitForPaintableViewport(runtime.view.webContents);
    await performBrowserRuntimeAction(runtime.view.webContents, action);
  }

  private enqueue<T>(
    runtime: BrowserRuntime,
    task: () => Promise<T>,
  ): Promise<T> {
    const next = runtime.queue.then(task, task);
    runtime.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private ok(
    requestId: string,
    payload: BrowserRuntimeResponseEnvelopeDto["payload"],
  ): BrowserRuntimeResponseEnvelopeDto {
    return {
      kind: "browserRuntime.response",
      requestId,
      ok: true,
      payload,
    };
  }
}

function runtimeKey(threadId: string, paneId: string): string {
  return `${threadId}:${paneId}`;
}

function roundedBounds(bounds: Rectangle): Rectangle {
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height)),
  };
}

function validBounds(bounds: Rectangle): boolean {
  return bounds.width > 1 && bounds.height > 1;
}

function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function isUsableHostWindow(
  window: BrowserWindow | null | undefined,
  captureWindow: BrowserWindow | null,
): window is BrowserWindow {
  return (
    window !== null &&
    window !== undefined &&
    !window.isDestroyed() &&
    (captureWindow === null || window.id !== captureWindow.id)
  );
}

async function readDomSnapshot(webContents: WebContents): Promise<{
  title: string;
  bodyTextPreview: string;
  devicePixelRatio: number;
  interactiveElements: BrowserRuntimeObservationDto["interactiveElements"];
}> {
  let result: unknown;
  try {
    result = await runInPage(webContents, DOM_SNAPSHOT_SCRIPT);
  } catch {
    return {
      title: webContents.getTitle(),
      bodyTextPreview: "",
      devicePixelRatio: 1,
      interactiveElements: [],
    };
  }
  const record = result !== null && typeof result === "object" ? result as {
    title?: unknown;
    bodyTextPreview?: unknown;
    devicePixelRatio?: unknown;
    interactiveElements?: unknown;
  } : {};
  return {
    title: typeof record.title === "string" ? record.title : "",
    bodyTextPreview:
      typeof record.bodyTextPreview === "string" ? record.bodyTextPreview.slice(0, 6000) : "",
    devicePixelRatio:
      typeof record.devicePixelRatio === "number" && Number.isFinite(record.devicePixelRatio)
        ? record.devicePixelRatio
        : 1,
    interactiveElements: Array.isArray(record.interactiveElements)
      ? record.interactiveElements.slice(0, 80) as BrowserRuntimeObservationDto["interactiveElements"]
      : [],
  };
}

function runInPage(webContents: WebContents, script: string): Promise<unknown> {
  return webContents.executeJavaScript(script, true) as Promise<unknown>;
}

async function waitForLoadSettle(webContents: WebContents): Promise<void> {
  if (!webContents.isLoading()) {
    await delay(30);
    return;
  }
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, LOAD_SETTLE_TIMEOUT_MS);
    webContents.once("did-stop-loading", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function waitForPaintableViewport(webContents: WebContents): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const result = await runInPage(
        webContents,
        "({ width: window.innerWidth, height: window.innerHeight, readyState: document.readyState })",
      );
      const record = result !== null && typeof result === "object"
        ? result as { width?: unknown; height?: unknown }
        : {};
      if (
        typeof record.width === "number" &&
        typeof record.height === "number" &&
        record.width > 0 &&
        record.height > 0
      ) {
        return;
      }
    } catch {
      // Navigations can briefly destroy the execution context; retry until the viewport stabilizes.
    }
    await delay(50);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const ELEMENT_QUERY_SCRIPT = `Array.from(document.querySelectorAll("a,button,input,textarea,select,[role=button],[role=link],[contenteditable=true]"))
  .filter((element) => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  })
  .map((element, index) => ({ element, index }))`;

const DOM_SNAPSHOT_SCRIPT = `(() => {
  const text = (document.body ? document.body.innerText : "").replace(/\\s+\\n/g, "\\n").trim().slice(0, 6000);
  const items = ${ELEMENT_QUERY_SCRIPT}.slice(0, 80).map(({ element }, index) => {
    const rect = element.getBoundingClientRect();
    return {
      index,
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute("role") || undefined,
      type: element.getAttribute("type") || undefined,
      text: (element.innerText || element.value || "").trim().slice(0, 120) || undefined,
      ariaLabel: element.getAttribute("aria-label") || undefined,
      placeholder: element.getAttribute("placeholder") || undefined,
      href: element.href || undefined,
      disabled: Boolean(element.disabled),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
  });
  return {
    title: document.title || "",
    bodyTextPreview: text,
    devicePixelRatio: window.devicePixelRatio || 1,
    interactiveElements: items,
  };
})()`;

export const browserRuntimeHost = new BrowserRuntimeHost();
