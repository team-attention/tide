import type { WebContents } from "electron";
import type { BrowserRuntimeActRequestDto } from "../../../../shared/contracts/index.ts";

export async function performBrowserRuntimeAction(
  webContents: WebContents,
  action: BrowserRuntimeActRequestDto["action"],
): Promise<void> {
  switch (action.kind) {
    case "click":
      await clickResolvedPoint(webContents, await resolveActionPoint(webContents, selectorPointScript(action.selector)));
      return;
    case "type_text":
      await runInPage(webContents, selectorFocusScript(action.selector));
      await sendCdp(webContents, "Input.insertText", { text: action.text ?? "" });
      return;
    case "click_element":
      await clickResolvedPoint(
        webContents,
        await resolveActionPoint(webContents, elementPointScript(action.elementIndex ?? -1)),
      );
      return;
    case "move_to":
      await dispatchMouse(webContents, "mouseMoved", action.x ?? 0, action.y ?? 0);
      return;
    case "click_at":
      await dispatchMouse(webContents, "mouseMoved", action.x ?? 0, action.y ?? 0);
      await dispatchMouse(webContents, "mousePressed", action.x ?? 0, action.y ?? 0, {
        button: action.button ?? "left",
        clickCount: action.clickCount ?? 1,
      });
      await dispatchMouse(webContents, "mouseReleased", action.x ?? 0, action.y ?? 0, {
        button: action.button ?? "left",
        clickCount: action.clickCount ?? 1,
      });
      return;
    case "drag":
      await dispatchDrag(webContents, action);
      return;
    case "scroll":
      await dispatchMouse(webContents, "mouseWheel", action.x ?? 0, action.y ?? 0, {
        deltaX: action.deltaX ?? 0,
        deltaY: action.deltaY ?? 0,
      });
      return;
    case "key":
      await dispatchKey(webContents, action.keys ?? "");
      return;
    case "type":
      await sendCdp(webContents, "Input.insertText", { text: action.text ?? "" });
      return;
  }
}

function selectorPointScript(selector: string | undefined): string {
  return `(() => {
    const el = document.querySelector(${JSON.stringify(selector ?? "")});
    if (!el) throw new Error("Selector did not match an element.");
    el.scrollIntoView({ block: "center", inline: "center" });
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) throw new Error("Selector matched a non-visible element.");
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`;
}

function selectorFocusScript(selector: string | undefined): string {
  return `(() => {
    const el = document.querySelector(${JSON.stringify(selector ?? "")});
    if (!el) throw new Error("Selector did not match an element.");
    el.scrollIntoView({ block: "center", inline: "center" });
    el.focus();
    return true;
  })()`;
}

function elementPointScript(index: number): string {
  return `(() => {
    const elements = ${ELEMENT_QUERY_SCRIPT};
    const item = elements[${JSON.stringify(index)}];
    if (!item || !item.element) throw new Error("Element index did not match an element.");
    item.element.scrollIntoView({ block: "center", inline: "center" });
    const rect = item.element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) throw new Error("Element index matched a non-visible element.");
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`;
}

async function resolveActionPoint(
  webContents: WebContents,
  script: string,
): Promise<{ x: number; y: number }> {
  const result = await runInPage(webContents, script);
  const record = result !== null && typeof result === "object"
    ? result as { x?: unknown; y?: unknown }
    : {};
  if (
    typeof record.x !== "number" ||
    typeof record.y !== "number" ||
    !Number.isFinite(record.x) ||
    !Number.isFinite(record.y)
  ) {
    throw new Error("Browser action target did not resolve to a clickable point.");
  }
  return { x: record.x, y: record.y };
}

async function clickResolvedPoint(
  webContents: WebContents,
  point: { x: number; y: number },
): Promise<void> {
  await dispatchMouseCss(webContents, "mouseMoved", point.x, point.y);
  await dispatchMouseCss(webContents, "mousePressed", point.x, point.y, {
    button: "left",
    clickCount: 1,
  });
  await dispatchMouseCss(webContents, "mouseReleased", point.x, point.y, {
    button: "left",
    clickCount: 1,
  });
}

async function dispatchDrag(
  webContents: WebContents,
  action: BrowserRuntimeActRequestDto["action"],
): Promise<void> {
  const fromX = action.x ?? 0;
  const fromY = action.y ?? 0;
  const toX = action.toX ?? fromX;
  const toY = action.toY ?? fromY;
  const steps = Math.max(1, Math.min(60, action.steps ?? 8));
  await dispatchMouse(webContents, "mouseMoved", fromX, fromY);
  await dispatchMouse(webContents, "mousePressed", fromX, fromY, { button: "left", clickCount: 1 });
  for (let step = 1; step <= steps; step += 1) {
    const ratio = step / steps;
    await dispatchMouse(
      webContents,
      "mouseMoved",
      fromX + (toX - fromX) * ratio,
      fromY + (toY - fromY) * ratio,
      { button: "left" },
    );
    if ((action.durationMs ?? 0) > 0) {
      await delay((action.durationMs ?? 0) / steps);
    }
  }
  await dispatchMouse(webContents, "mouseReleased", toX, toY, { button: "left", clickCount: 1 });
}

async function dispatchMouse(
  webContents: WebContents,
  type: string,
  screenshotX: number,
  screenshotY: number,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const dpr = await pageDevicePixelRatio(webContents);
  await dispatchMouseCss(webContents, type, screenshotX / dpr, screenshotY / dpr, extra);
}

async function dispatchMouseCss(
  webContents: WebContents,
  type: string,
  x: number,
  y: number,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await sendCdp(webContents, "Input.dispatchMouseEvent", {
    type,
    x,
    y,
    ...extra,
  });
}

async function dispatchKey(webContents: WebContents, keys: string): Promise<void> {
  const parsed = keyStroke(keys);
  const key = keyDescriptor(parsed.key);
  await sendCdp(webContents, "Input.dispatchKeyEvent", {
    type: "keyDown",
    key: key.key,
    code: key.code,
    windowsVirtualKeyCode: key.windowsVirtualKeyCode,
    modifiers: parsed.modifiers,
  });
  await sendCdp(webContents, "Input.dispatchKeyEvent", {
    type: "keyUp",
    key: key.key,
    code: key.code,
    windowsVirtualKeyCode: key.windowsVirtualKeyCode,
    modifiers: parsed.modifiers,
  });
}

function keyStroke(keys: string): { key: string; modifiers: number } {
  const parts = keys
    .split("+")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) {
    return { key: "", modifiers: 0 };
  }
  let modifiers = 0;
  for (const part of parts.slice(0, -1)) {
    switch (part.toLowerCase()) {
      case "alt":
      case "option":
        modifiers |= 1;
        break;
      case "ctrl":
      case "control":
        modifiers |= 2;
        break;
      case "cmd":
      case "command":
      case "meta":
        modifiers |= 4;
        break;
      case "shift":
        modifiers |= 8;
        break;
    }
  }
  return { key: parts[parts.length - 1] ?? "", modifiers };
}

function keyDescriptor(keys: string): {
  key: string;
  code: string;
  windowsVirtualKeyCode: number;
} {
  switch (keys) {
    case "Enter":
      return { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 };
    case "Tab":
      return { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 };
    case "Escape":
      return { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 };
    case "Backspace":
      return { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 };
    case "ArrowDown":
      return { key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 };
    case "ArrowUp":
      return { key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 };
    case "ArrowLeft":
      return { key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 };
    case "ArrowRight":
      return { key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 };
    default:
      return {
        key: keys.length === 1 ? keys : "Unidentified",
        code: keys.length === 1 ? `Key${keys.toUpperCase()}` : keys,
        windowsVirtualKeyCode: keys.length === 1 ? keys.toUpperCase().charCodeAt(0) : 0,
      };
  }
}

async function pageDevicePixelRatio(webContents: WebContents): Promise<number> {
  const value = await runInPage(webContents, "window.devicePixelRatio || 1");
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 1;
}

function runInPage(webContents: WebContents, script: string): Promise<unknown> {
  return webContents.executeJavaScript(script, true) as Promise<unknown>;
}

async function sendCdp(
  webContents: WebContents,
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  if (!webContents.debugger.isAttached()) {
    webContents.debugger.attach("1.3");
  }
  return webContents.debugger.sendCommand(method, params);
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
