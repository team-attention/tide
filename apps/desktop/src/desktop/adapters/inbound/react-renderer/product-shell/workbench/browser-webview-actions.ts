import type {
  ProductShellBrowserScreenshot,
  ProductShellBrowserSnapshot,
  ProductShellViewModel,
} from "../../../../../application/domains/product-shell/product-shell.ts";

// Pure Browser Pane <webview> execution helpers, extracted from browser-pane.tsx so the
// "see + operate" mechanics are testable against a fake <webview> (no React).
// Spec: docs_v2/specs/browser-pane-agent-computer-use.md.
//
// Hybrid action model (D1): selector actions ("click"/"type_text") run through
// executeJavaScript (the reliability fallback, unchanged); coordinate computer-use
// actions ("move_to"/"click_at"/"scroll"/"key"/"type") drive the page through real
// webview.sendInputEvent — the "human" path. Coordinates are webview CSS pixels in this
// slice; the screenshot-pixel/DPR contract arrives with the screenshot observe slice.

export type BrowserWebViewInputEvent =
  | {
      type: "mouseMove" | "mouseDown" | "mouseUp";
      x: number;
      y: number;
      button?: "left" | "right" | "middle";
      clickCount?: number;
      modifiers?: string[];
    }
  | { type: "mouseWheel"; x: number; y: number; deltaX: number; deltaY: number; canScroll?: boolean }
  | { type: "keyDown" | "keyUp" | "char"; keyCode: string; modifiers?: string[] };

export type BrowserWebViewElement = HTMLElement & {
  executeJavaScript?: (code: string) => Promise<unknown>;
  getURL?: () => string;
  loadURL?: (url: string) => Promise<void>;
  goBack?: () => void;
  goForward?: () => void;
  reload?: () => void;
  canGoBack?: () => boolean;
  canGoForward?: () => boolean;
  isLoading?: () => boolean;
  sendInputEvent?: (event: BrowserWebViewInputEvent) => void;
  capturePage?: () => Promise<{
    toDataURL?: () => string;
    getSize?: () => { width: number; height: number };
  } | null | undefined>;
};

export type BrowserWebViewSnapshot = Omit<ProductShellBrowserSnapshot, "revision" | "loading">;

export type BrowserWebViewAction = NonNullable<
  NonNullable<ProductShellViewModel["appChrome"]["activeWorkbenchPane"]>["pendingAction"]
>;

export type BrowserWebViewActionExecution = { ok: boolean; message: string };

// Electron <webview> guest methods only work once the guest is attached AND has
// emitted dom-ready. Before that, executeJavaScript throws *synchronously* and
// capturePage() never resolves. These two guards keep a not-ready (or non-painting)
// webview from stalling the snapshot pipeline — which otherwise leaves the pane
// "pending"/agent-driving forever because onBrowserActionResult never fires.
const CAPTURE_TIMEOUT_MS = 2000;

function raceTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  // Renderer-resolved setTimeout returns a DOM `number` here (not NodeJS.Timeout);
  // the global setTimeout/clearTimeout still work in the node test runtime too.
  let timer: number | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  // Clear the loser's timer so a fast capture never leaves a dangling 2s timeout
  // (which would keep the process/tests alive and leak a handle).
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  });
}

async function safeExecuteJavaScript(
  webview: BrowserWebViewElement,
  script: string,
): Promise<unknown> {
  try {
    // `.catch()` is not enough: executeJavaScript throws synchronously (not a
    // rejected promise) before dom-ready, so a chained rejection handler never
    // attaches. Catch the sync throw and the async rejection both.
    return await webview.executeJavaScript?.(script);
  } catch {
    return undefined;
  }
}

export async function readBrowserWebViewSnapshot(
  webview: BrowserWebViewElement,
): Promise<BrowserWebViewSnapshot> {
  const script = `(() => ({
    url: window.location.href,
    pageTitle: document.title,
    bodyTextPreview: (document.body?.innerText ?? "").slice(0, 65536)
  }))()`;
  const rawSnapshot = await safeExecuteJavaScript(webview, script);
  const snapshot =
    rawSnapshot !== null && typeof rawSnapshot === "object"
      ? (rawSnapshot as Record<string, unknown>)
      : {};
  const screenshot = await captureBrowserWebViewScreenshot(webview);
  return {
    url: stringRecordField(snapshot, "url") ?? webview.getURL?.(),
    pageTitle: stringRecordField(snapshot, "pageTitle"),
    bodyTextPreview: stringRecordField(snapshot, "bodyTextPreview"),
    ...(screenshot === undefined ? {} : { screenshot }),
  };
}

// Pixel vision: capture the rendered page via Electron <webview>.capturePage() → base64
// PNG + size + devicePixelRatio. Cached backend-side (via the snapshot path) for
// tide_observe_browser mode=screenshot|both. Returns undefined when capture is
// unavailable/empty so observe degrades to DOM text. Spec:
// docs_v2/specs/browser-pane-agent-computer-use.md.
export async function captureBrowserWebViewScreenshot(
  webview: BrowserWebViewElement,
): Promise<ProductShellBrowserScreenshot | undefined> {
  if (webview.capturePage === undefined) {
    return undefined;
  }
  try {
    // Ceiling the capture: capturePage() never resolves while the guest isn't
    // painting (just-created / offscreen / pre-dom-ready). Without this race a
    // single hung capture stalls the snapshot → the action result is never
    // reported and the pane stays "pending". Degrade to "no screenshot" instead.
    const image = await raceTimeout(webview.capturePage(), CAPTURE_TIMEOUT_MS);
    const dataUrl = image?.toDataURL?.();
    if (typeof dataUrl !== "string" || dataUrl.length === 0) {
      return undefined;
    }
    const comma = dataUrl.indexOf(",");
    const data = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
    if (data.length === 0) {
      return undefined;
    }
    const size = image?.getSize?.() ?? { width: 0, height: 0 };
    const devicePixelRatio =
      typeof globalThis !== "undefined" &&
      typeof (globalThis as { devicePixelRatio?: number }).devicePixelRatio === "number"
        ? (globalThis as { devicePixelRatio: number }).devicePixelRatio
        : 1;
    return {
      data,
      mimeType: "image/png",
      width: size.width,
      height: size.height,
      devicePixelRatio,
    };
  } catch {
    return undefined;
  }
}

export async function executeBrowserWebViewAction(
  webview: BrowserWebViewElement,
  action: BrowserWebViewAction,
): Promise<BrowserWebViewActionExecution> {
  switch (action.kind) {
    case "click":
    case "type_text":
      return executeSelectorAction(webview, action);
    case "move_to":
    case "click_at":
    case "scroll":
    case "key":
    case "type":
      return executeInputEventAction(webview, action);
  }
}

// Selector path — unchanged reliability fallback (querySelector + DOM dispatch).
async function executeSelectorAction(
  webview: BrowserWebViewElement,
  action: BrowserWebViewAction,
): Promise<BrowserWebViewActionExecution> {
  if (webview.executeJavaScript === undefined) {
    return { ok: false, message: "Browser WebView does not expose script execution." };
  }
  const payload = JSON.stringify({
    kind: action.kind,
    selector: action.selector ?? "",
    text: action.text ?? "",
  });
  const script = `((payload) => {
    const target = document.querySelector(payload.selector);
    if (!target) {
      return { ok: false, message: "Selector not found: " + payload.selector };
    }
    target.scrollIntoView?.({ block: "center", inline: "center" });
    if (payload.kind === "click") {
      target.click();
      return { ok: true, message: "Clicked " + payload.selector };
    }
    if (payload.kind === "type_text") {
      target.focus?.();
      if ("value" in target) {
        target.value = payload.text;
        target.dispatchEvent(new Event("input", { bubbles: true }));
        target.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true, message: "Typed " + payload.selector };
      }
      target.textContent = payload.text;
      target.dispatchEvent(new Event("input", { bubbles: true }));
      return { ok: true, message: "Typed " + payload.selector };
    }
    return { ok: false, message: "Unsupported Browser action." };
  })(${payload})`;
  return browserActionExecutionFromUnknown(await webview.executeJavaScript(script));
}

// Coordinate computer-use path — real input events on the live <webview>.
function executeInputEventAction(
  webview: BrowserWebViewElement,
  action: BrowserWebViewAction,
): BrowserWebViewActionExecution {
  if (webview.sendInputEvent === undefined) {
    return { ok: false, message: "Browser WebView does not expose input events." };
  }
  switch (action.kind) {
    case "move_to": {
      if (action.x === undefined || action.y === undefined) {
        return invalidCoordinates();
      }
      webview.sendInputEvent({ type: "mouseMove", x: action.x, y: action.y });
      return { ok: true, message: `Moved to ${action.x},${action.y}` };
    }
    case "click_at": {
      if (action.x === undefined || action.y === undefined) {
        return invalidCoordinates();
      }
      const button = action.button ?? "left";
      const clickCount = action.clickCount ?? 1;
      webview.sendInputEvent({ type: "mouseMove", x: action.x, y: action.y });
      webview.sendInputEvent({ type: "mouseDown", x: action.x, y: action.y, button, clickCount });
      webview.sendInputEvent({ type: "mouseUp", x: action.x, y: action.y, button, clickCount });
      return { ok: true, message: `Clicked at ${action.x},${action.y}` };
    }
    case "scroll": {
      if (action.x === undefined || action.y === undefined) {
        return invalidCoordinates();
      }
      webview.sendInputEvent({
        type: "mouseWheel",
        x: action.x,
        y: action.y,
        deltaX: action.deltaX ?? 0,
        deltaY: action.deltaY ?? 0,
        canScroll: true,
      });
      return { ok: true, message: `Scrolled at ${action.x},${action.y}` };
    }
    case "key": {
      if (action.keys === undefined) {
        return { ok: false, message: "Key browser action requires keys." };
      }
      const { keyCode, modifiers } = parseKeyChord(action.keys);
      webview.sendInputEvent({ type: "keyDown", keyCode, modifiers });
      webview.sendInputEvent({ type: "keyUp", keyCode, modifiers });
      return { ok: true, message: `Pressed ${action.keys}` };
    }
    case "type": {
      if (action.text === undefined) {
        return { ok: false, message: "Type browser action requires text." };
      }
      for (const char of action.text) {
        webview.sendInputEvent({ type: "char", keyCode: char });
      }
      return { ok: true, message: `Typed ${action.text.length} character(s)` };
    }
    default:
      return { ok: false, message: "Unsupported Browser action." };
  }
}

function invalidCoordinates(): BrowserWebViewActionExecution {
  return { ok: false, message: "Coordinate browser action requires numeric x and y." };
}

// "Cmd+Shift+A" → { keyCode: "A", modifiers: ["cmd", "shift"] }. Electron sendInputEvent
// keyboard modifiers use "cmd"/"control"/"alt"/"shift"; the final token is the key.
function parseKeyChord(keys: string): { keyCode: string; modifiers: string[] } {
  const parts = keys
    .split("+")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const keyCode = parts.at(-1) ?? keys;
  const modifierAliases: Record<string, string> = {
    cmd: "cmd",
    command: "cmd",
    meta: "cmd",
    super: "cmd",
    ctrl: "control",
    control: "control",
    alt: "alt",
    option: "alt",
    shift: "shift",
  };
  const modifiers = parts
    .slice(0, -1)
    .map((part) => modifierAliases[part.toLowerCase()])
    .filter((modifier): modifier is string => modifier !== undefined);
  return { keyCode, modifiers };
}

function browserActionExecutionFromUnknown(value: unknown): BrowserWebViewActionExecution {
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const ok = typeof record.ok === "boolean" ? record.ok : false;
    const message =
      typeof record.message === "string" ? record.message : "Browser action finished.";
    return { ok, message };
  }
  return { ok: false, message: "Browser action returned an invalid result." };
}

function stringRecordField(
  record: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = record[field];
  return typeof value === "string" ? value : undefined;
}
