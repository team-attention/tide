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
// actions ("move_to"/"click_at"/"drag"/"scroll"/"key"/"type") drive the page through
// real webview.sendInputEvent — the "human" path. Coordinate actions arrive in the
// screenshot pixel space the Agent observed; this helper converts them to webview CSS
// pixels before sending Electron input events.

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
  findInPage?: (
    text: string,
    options?: { forward?: boolean; findNext?: boolean; matchCase?: boolean },
  ) => number;
  stopFindInPage?: (action: "clearSelection" | "keepSelection" | "activateSelection") => void;
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

interface BrowserActionTarget {
  ok: boolean;
  message: string;
  x?: number;
  y?: number;
  description?: string;
  disabled?: boolean;
}

// Electron <webview> guest methods only work once the guest is attached AND has
// emitted dom-ready. Before that, executeJavaScript throws *synchronously* and
// capturePage() never resolves. These two guards keep a not-ready (or non-painting)
// webview from stalling the snapshot pipeline — which otherwise leaves the pane
// "pending"/agent-driving forever because onBrowserActionResult never fires.
const CAPTURE_TIMEOUT_MS = 2000;
const JAVASCRIPT_TIMEOUT_MS = 2000;

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
    // attaches. It can also return a promise that never resolves when the guest is
    // not fully attached; bound that wait so Browser Pane action results cannot
    // remain pending forever behind a hung text snapshot.
    const promise = webview.executeJavaScript?.(script);
    if (promise === undefined) {
      return undefined;
    }
    return await raceTimeout(promise, JAVASCRIPT_TIMEOUT_MS);
  } catch {
    return undefined;
  }
}

export function safeGetWebViewURL(webview: BrowserWebViewElement): string | undefined {
  try {
    return webview.getURL?.();
  } catch {
    return undefined;
  }
}

export function safeLoadWebViewURL(webview: BrowserWebViewElement, url: string): void {
  try {
    void webview.loadURL?.(url)?.catch(() => undefined);
  } catch {
    // Electron guest methods throw synchronously before dom-ready.
  }
}

export function safeInvokeWebView(
  webview: BrowserWebViewElement,
  method: "goBack" | "goForward" | "reload",
): void {
  try {
    webview[method]?.();
  } catch {
    // Ignore pre-dom-ready guest API throws from toolbar clicks.
  }
}

export function safeFindInWebView(
  webview: BrowserWebViewElement,
  text: string,
  options?: { forward?: boolean; findNext?: boolean; matchCase?: boolean },
): number | undefined {
  try {
    return webview.findInPage?.(text, options);
  } catch {
    return undefined;
  }
}

export function safeStopFindInWebView(
  webview: BrowserWebViewElement,
  action: "clearSelection" | "keepSelection" | "activateSelection",
): void {
  try {
    webview.stopFindInPage?.(action);
  } catch {
    // Ignore pre-dom-ready guest API throws from the find bar mount/close path.
  }
}

// True only when the guest has finished its current load. `<webview>.isLoading()`
// is NOT a safe probe: like the other guest methods it throws *synchronously*
// ("must be attached to the DOM and the dom-ready event emitted") until the guest
// is ready — which is exactly the just-mounted case. `?.` does not help (the method
// exists; calling it throws), so an un-guarded call in a mount effect escapes and
// unmounts the whole React tree (white screen — there is no error boundary). Treat a
// throw as "not settled yet": the dom-ready / did-finish-load listeners capture the
// snapshot once the guest is actually ready.
export function isWebViewSettled(webview: BrowserWebViewElement): boolean {
  try {
    return webview.isLoading?.() === false;
  } catch {
    return false;
  }
}

// Read the cheap DOM text (url / title / body) only — NEVER a pixel screenshot. The recurring
// load-event path (dom-ready/did-finish-load/did-stop-loading) fires repeatedly across every
// mounted (incl. background) pane; capturing a full-page PNG on each — on the host renderer's
// main thread — pegged the renderer at ~99% CPU. Pixels are now captured at exactly ONE place:
// the observe-time pull (captureBrowserWebViewScreenshot via pendingCapture), so a page never
// encodes a PNG unless an agent actually looks. Spec:
// docs_v2/specs/browser-pane-screenshot-on-load-decoupling.md.
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
  return {
    url: stringRecordField(snapshot, "url") ?? safeGetWebViewURL(webview),
    pageTitle: stringRecordField(snapshot, "pageTitle"),
    bodyTextPreview: stringRecordField(snapshot, "bodyTextPreview"),
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
    case "drag":
    case "scroll":
    case "key":
    case "type":
      return executeInputEventAction(webview, action);
  }
}

// Selector path: find the target in the page DOM, then prefer Electron input events so
// React-controlled fields and real click handlers see the same event family a user sends.
async function executeSelectorAction(
  webview: BrowserWebViewElement,
  action: BrowserWebViewAction,
): Promise<BrowserWebViewActionExecution> {
  if (webview.executeJavaScript === undefined) {
    return { ok: false, message: "Browser WebView does not expose script execution." };
  }
  if (action.kind === "click") {
    const target = await resolveSelectorTarget(webview, action.selector ?? "");
    if (!target.ok) {
      return { ok: false, message: target.message };
    }
    if (target.disabled === true) {
      return { ok: false, message: `${target.message}; target is disabled.` };
    }
    if (webview.sendInputEvent === undefined || target.x === undefined || target.y === undefined) {
      return executeSelectorClickFallback(webview, action.selector ?? "");
    }
    webview.sendInputEvent({ type: "mouseMove", x: target.x, y: target.y });
    webview.sendInputEvent({
      type: "mouseDown",
      x: target.x,
      y: target.y,
      button: "left",
      clickCount: 1,
    });
    webview.sendInputEvent({
      type: "mouseUp",
      x: target.x,
      y: target.y,
      button: "left",
      clickCount: 1,
    });
    return {
      ok: true,
      message: `Clicked ${action.selector ?? ""} at ${Math.round(target.x)},${Math.round(target.y)} (${target.description ?? "target"})`,
    };
  }

  if (action.kind === "type_text") {
    return executeSelectorTypeText(webview, action.selector ?? "", action.text ?? "");
  }
  return { ok: false, message: "Unsupported Browser action." };
}

async function executeSelectorClickFallback(
  webview: BrowserWebViewElement,
  selector: string,
): Promise<BrowserWebViewActionExecution> {
  const payload = JSON.stringify({ selector });
  const script = `((payload) => {
    const target = document.querySelector(payload.selector);
    if (!target) {
      return { ok: false, message: "Selector not found: " + payload.selector };
    }
    target.scrollIntoView?.({ block: "center", inline: "center" });
    target.click();
    return { ok: true, message: "Clicked " + payload.selector + " via DOM fallback" };
  })(${payload})`;
  return browserActionExecutionFromUnknown(await webview.executeJavaScript?.(script));
}

async function executeSelectorTypeText(
  webview: BrowserWebViewElement,
  selector: string,
  text: string,
): Promise<BrowserWebViewActionExecution> {
  const prepared = await prepareEditableTarget(webview, selector);
  if (!prepared.ok) {
    return { ok: false, message: prepared.message };
  }
  if (webview.sendInputEvent === undefined) {
    return executeSelectorTypeFallback(webview, selector, text);
  }
  replaceFocusedText(webview, text);
  await delay(50);
  const valueInfo = await readFocusedEditableValue(webview);
  const suffix = valueInfo.message.length > 0 ? `; ${valueInfo.message}` : "";
  return {
    ok: valueInfo.ok,
    message: `Typed ${text.length} character(s) into ${selector}${suffix}`,
  };
}

async function executeSelectorTypeFallback(
  webview: BrowserWebViewElement,
  selector: string,
  text: string,
): Promise<BrowserWebViewActionExecution> {
  const payload = JSON.stringify({ selector, text });
  const script = `((payload) => {
    const target = document.querySelector(payload.selector);
    if (!target) {
      return { ok: false, message: "Selector not found: " + payload.selector };
    }
    target.scrollIntoView?.({ block: "center", inline: "center" });
    target.focus?.();
    if ("value" in target) {
      target.value = payload.text;
      target.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: payload.text,
      }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, message: "Typed " + payload.selector + " via DOM fallback" };
    }
    target.textContent = payload.text;
    target.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: payload.text,
    }));
    return { ok: true, message: "Typed " + payload.selector + " via DOM fallback" };
  })(${payload})`;
  return browserActionExecutionFromUnknown(await webview.executeJavaScript?.(script));
}

async function resolveSelectorTarget(
  webview: BrowserWebViewElement,
  selector: string,
): Promise<BrowserActionTarget> {
  const payload = JSON.stringify({ selector });
  const script = `((payload) => {
    const target = document.querySelector(payload.selector);
    if (!target) {
      return { ok: false, message: "Selector not found: " + payload.selector };
    }
    target.scrollIntoView?.({ block: "center", inline: "center" });
    const rect = target.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return { ok: false, message: "Selector is not visible: " + payload.selector };
    }
    const x = Math.max(0, Math.min(window.innerWidth - 1, rect.left + rect.width / 2));
    const y = Math.max(0, Math.min(window.innerHeight - 1, rect.top + rect.height / 2));
    const hit = document.elementFromPoint(x, y);
    const hitMatches = hit !== null && (hit === target || target.contains(hit));
    const tagName = target.tagName?.toLowerCase?.() ?? "element";
    const label = [
      tagName,
      target.id ? "#" + target.id : "",
      typeof target.className === "string" && target.className.trim().length > 0
        ? "." + target.className.trim().split(/\\s+/).slice(0, 3).join(".")
        : "",
      hitMatches ? "hit" : "center-obscured",
    ].filter(Boolean).join("");
    return {
      ok: true,
      message: "Resolved " + payload.selector,
      x,
      y,
      description: label,
      disabled: target.disabled === true || target.getAttribute?.("aria-disabled") === "true",
    };
  })(${payload})`;
  return browserActionTargetFromUnknown(await webview.executeJavaScript?.(script));
}

async function prepareEditableTarget(
  webview: BrowserWebViewElement,
  selector: string,
): Promise<BrowserActionTarget> {
  const payload = JSON.stringify({ selector });
  const script = `((payload) => {
    const target = document.querySelector(payload.selector);
    if (!target) {
      return { ok: false, message: "Selector not found: " + payload.selector };
    }
    target.scrollIntoView?.({ block: "center", inline: "center" });
    const editable = "value" in target || target.isContentEditable === true;
    if (!editable) {
      return { ok: false, message: "Selector is not editable: " + payload.selector };
    }
    target.focus?.();
    if (document.activeElement !== target) {
      return { ok: false, message: "Selector could not be focused: " + payload.selector };
    }
    if ("value" in target && typeof target.setSelectionRange === "function") {
      target.setSelectionRange(0, String(target.value ?? "").length);
    } else {
      const selection = window.getSelection?.();
      const range = document.createRange();
      range.selectNodeContents(target);
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    const rect = target.getBoundingClientRect();
    return {
      ok: true,
      message: "Focused " + payload.selector,
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      description: target.tagName?.toLowerCase?.() ?? "editable",
      disabled: target.disabled === true || target.getAttribute?.("aria-disabled") === "true",
    };
  })(${payload})`;
  return browserActionTargetFromUnknown(await webview.executeJavaScript?.(script));
}

async function readFocusedEditableValue(
  webview: BrowserWebViewElement,
): Promise<BrowserWebViewActionExecution> {
  if (webview.executeJavaScript === undefined) {
    return { ok: true, message: "" };
  }
  const script = `(() => {
    const target = document.activeElement;
    if (!target) {
      return { ok: false, message: "no focused element after type" };
    }
    if ("value" in target) {
      return { ok: true, message: "focused value length " + String(target.value ?? "").length };
    }
    if (target.isContentEditable === true) {
      return { ok: true, message: "focused text length " + String(target.textContent ?? "").length };
    }
    return { ok: false, message: "focused element is not editable after type" };
  })()`;
  return browserActionExecutionFromUnknown(await webview.executeJavaScript?.(script));
}

// Coordinate computer-use path — real input events on the live <webview>.
async function executeInputEventAction(
  webview: BrowserWebViewElement,
  action: BrowserWebViewAction,
): Promise<BrowserWebViewActionExecution> {
  if (webview.sendInputEvent === undefined) {
    return { ok: false, message: "Browser WebView does not expose input events." };
  }
  switch (action.kind) {
    case "move_to": {
      if (action.x === undefined || action.y === undefined) {
        return invalidCoordinates();
      }
      const point = coordinateActionPoint(action.x, action.y);
      webview.sendInputEvent({ type: "mouseMove", x: point.x, y: point.y });
      return { ok: true, message: `Moved to ${action.x},${action.y}` };
    }
    case "click_at": {
      if (action.x === undefined || action.y === undefined) {
        return invalidCoordinates();
      }
      const button = action.button ?? "left";
      const clickCount = action.clickCount ?? 1;
      const point = coordinateActionPoint(action.x, action.y);
      const described = await describePoint(webview, point.x, point.y);
      webview.sendInputEvent({ type: "mouseMove", x: point.x, y: point.y });
      webview.sendInputEvent({ type: "mouseDown", x: point.x, y: point.y, button, clickCount });
      webview.sendInputEvent({ type: "mouseUp", x: point.x, y: point.y, button, clickCount });
      const suffix = described.message.length > 0 ? ` (${described.message})` : "";
      return { ok: true, message: `Clicked at ${action.x},${action.y}${suffix}` };
    }
    case "drag": {
      if (
        action.x === undefined ||
        action.y === undefined ||
        action.toX === undefined ||
        action.toY === undefined
      ) {
        return invalidDragCoordinates();
      }
      const start = coordinateActionPoint(action.x, action.y);
      const end = coordinateActionPoint(action.toX, action.toY);
      const steps = boundedInteger(action.steps, 8, 1, 60);
      const durationMs = boundedInteger(action.durationMs, 250, 0, 2000);
      const perStepDelayMs = steps > 0 ? durationMs / steps : 0;
      webview.sendInputEvent({ type: "mouseMove", x: start.x, y: start.y });
      webview.sendInputEvent({
        type: "mouseDown",
        x: start.x,
        y: start.y,
        button: "left",
        clickCount: 1,
      });
      for (let step = 1; step <= steps; step += 1) {
        const t = step / steps;
        const x = start.x + (end.x - start.x) * t;
        const y = start.y + (end.y - start.y) * t;
        webview.sendInputEvent({ type: "mouseMove", x, y, button: "left" });
        if (perStepDelayMs > 0) {
          await delay(perStepDelayMs);
        }
      }
      webview.sendInputEvent({
        type: "mouseUp",
        x: end.x,
        y: end.y,
        button: "left",
        clickCount: 1,
      });
      return {
        ok: true,
        message: `Dragged from ${action.x},${action.y} to ${action.toX},${action.toY}`,
      };
    }
    case "scroll": {
      if (action.x === undefined || action.y === undefined) {
        return invalidCoordinates();
      }
      const point = coordinateActionPoint(action.x, action.y);
      webview.sendInputEvent({
        type: "mouseWheel",
        x: point.x,
        y: point.y,
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
        sendTextCharacter(webview, char);
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

function invalidDragCoordinates(): BrowserWebViewActionExecution {
  return { ok: false, message: "Drag browser action requires numeric x, y, toX, and toY." };
}

function boundedInteger(
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

function coordinateActionPoint(x: number, y: number): { x: number; y: number } {
  const devicePixelRatio =
    typeof globalThis !== "undefined" &&
    typeof (globalThis as { devicePixelRatio?: number }).devicePixelRatio === "number" &&
    Number.isFinite((globalThis as { devicePixelRatio: number }).devicePixelRatio) &&
    (globalThis as { devicePixelRatio: number }).devicePixelRatio > 0
      ? (globalThis as { devicePixelRatio: number }).devicePixelRatio
      : 1;
  return { x: x / devicePixelRatio, y: y / devicePixelRatio };
}

function replaceFocusedText(webview: BrowserWebViewElement, text: string): void {
  const selectAllModifier = process.platform === "darwin" ? "cmd" : "control";
  webview.sendInputEvent?.({ type: "keyDown", keyCode: "A", modifiers: [selectAllModifier] });
  webview.sendInputEvent?.({ type: "keyUp", keyCode: "A", modifiers: [selectAllModifier] });
  if (text.length === 0) {
    webview.sendInputEvent?.({ type: "keyDown", keyCode: "Backspace" });
    webview.sendInputEvent?.({ type: "keyUp", keyCode: "Backspace" });
    return;
  }
  for (const char of text) {
    sendTextCharacter(webview, char);
  }
}

function sendTextCharacter(webview: BrowserWebViewElement, char: string): void {
  if (char === "\n") {
    webview.sendInputEvent?.({ type: "keyDown", keyCode: "Enter" });
    webview.sendInputEvent?.({ type: "keyUp", keyCode: "Enter" });
    return;
  }
  webview.sendInputEvent?.({ type: "char", keyCode: char });
}

async function describePoint(
  webview: BrowserWebViewElement,
  x: number,
  y: number,
): Promise<BrowserWebViewActionExecution> {
  if (webview.executeJavaScript === undefined) {
    return { ok: true, message: "" };
  }
  const payload = JSON.stringify({ x, y });
  const script = `((payload) => {
    const target = document.elementFromPoint(payload.x, payload.y);
    if (!target) {
      return { ok: true, message: "no element under point" };
    }
    const tagName = target.tagName?.toLowerCase?.() ?? "element";
    const parts = [
      tagName,
      target.id ? "#" + target.id : "",
      typeof target.className === "string" && target.className.trim().length > 0
        ? "." + target.className.trim().split(/\\s+/).slice(0, 3).join(".")
        : "",
    ].filter(Boolean);
    const disabled = target.disabled === true || target.getAttribute?.("aria-disabled") === "true";
    const form = "form" in target ? target.form : undefined;
    const formValid = form && typeof form.checkValidity === "function" ? form.checkValidity() : true;
    return {
      ok: true,
      message: parts.join("") + (disabled ? "; disabled" : "") + (formValid === false ? "; form invalid" : ""),
    };
  })(${payload})`;
  return browserActionExecutionFromUnknown(await webview.executeJavaScript?.(script));
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

function browserActionTargetFromUnknown(value: unknown): BrowserActionTarget {
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return {
      ok: typeof record.ok === "boolean" ? record.ok : false,
      message:
        typeof record.message === "string" ? record.message : "Browser action target resolved.",
      x: typeof record.x === "number" ? record.x : undefined,
      y: typeof record.y === "number" ? record.y : undefined,
      description: typeof record.description === "string" ? record.description : undefined,
      disabled: typeof record.disabled === "boolean" ? record.disabled : undefined,
    };
  }
  return { ok: false, message: "Browser action target returned an invalid result." };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stringRecordField(
  record: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = record[field];
  return typeof value === "string" ? value : undefined;
}
