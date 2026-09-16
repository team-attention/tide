import { parseShortcutOverrides, shortcutKeys, SHORTCUTS_STORAGE_KEY, replacedEditingShortcut } from "../../../../shared/shortcuts.ts";
import { readUiPrefs } from "./ui-prefs.ts";
import { BrowserWindow, Menu } from "electron";
import type { MenuItemConstructorOptions } from "electron";
import { applyHostZoom, steppedZoomFactor } from "./zoom.ts";
// Extracted from electron-main.ts (spec: navigable-source-structure).

let activeShortcuts = parseShortcutOverrides(null);
const recordingContents = new Set<number>();
export function setHostShortcutRecording(contents: Electron.WebContents, active: boolean): void {
  if (active) recordingContents.add(contents.id); else recordingContents.delete(contents.id);
  contents.setIgnoreMenuShortcuts(active);
}
export function installHostShortcutGuard(contents: Electron.WebContents): void {
  const id = contents.id;
  contents.once("destroyed", () => recordingContents.delete(id));
  contents.on("before-input-event", (event, input) => {
    if (!recordingContents.has(id) && input.type === "keyDown" && replacedEditingShortcut({
      key: input.key, code: input.code, metaKey: input.meta, ctrlKey: input.control,
      altKey: input.alt, shiftKey: input.shift, isComposing: input.isComposing,
    }, activeShortcuts)) event.preventDefault();
  });
}

// View-menu panel toggles route through a menu accelerator (not a renderer keydown)
// so they fire even when focus is inside embedded content or a terminal — and
// the shortcut shows in the menu, making it discoverable. The renderer decides the
// actual open/close via its existing toggle handlers. Spec: panel-toggle-shortcuts.
function sendTogglePanel(panel: "leftRail" | "fileTree" | "workbench"): void {
  BrowserWindow.getFocusedWindow()?.webContents.send("tide:toggle-panel", panel);
}

function sendFindIntent(menuWindow: BrowserWindow | undefined): void {
  (menuWindow ?? BrowserWindow.getFocusedWindow() ?? undefined)?.webContents.send("tide:find-intent");
}

// Zoom the HOST window's webContents directly instead of using the built-in
// "zoomIn"/"zoomOut"/"resetZoom" roles. Those roles act on the *focused*
// webContents — when embedded webview content has focus that's the guest page,
// so Cmd +/- zoomed only the embedded page and left the Tide UI untouched. We zoom the
// React host instead so the whole app scales regardless of webview focus. We prefer the
// `browserWindow` Electron hands the click callback (the window the menu acted on) over
// a global getFocusedWindow() lookup — it's the correct target and stays defined even if
// nothing holds OS focus for a moment. applyHostZoom also broadcasts the factor so the
// renderer mirrors it onto <webview> guests (which don't inherit host zoom), so UI +
// embedded pages scale together. Spec: host-zoom-shortcuts.
function hostWebContents(menuWindow: BrowserWindow | undefined): Electron.WebContents | undefined {
  return (menuWindow ?? BrowserWindow.getFocusedWindow() ?? undefined)?.webContents;
}

function stepHostZoom(direction: 1 | -1, menuWindow: BrowserWindow | undefined): void {
  const host = hostWebContents(menuWindow);
  if (host === undefined) return;
  applyHostZoom(host, steppedZoomFactor(host.getZoomFactor(), direction));
}

function resetHostZoom(menuWindow: BrowserWindow | undefined): void {
  const host = hostWebContents(menuWindow);
  if (host === undefined) return;
  applyHostZoom(host, 1);
}

// Own the application menu so Cmd+W does NOT close the whole window (Electron's
// default Window menu binds CmdOrCtrl+W to role:"close"). Instead Cmd+W sends a
// "close intent" to the renderer, which closes the focused Workbench pane, else
// the active thread → start composer. Shift+Cmd+W still closes the window. The
// standard app/edit/view roles are kept so copy/paste/reload/quit still work.
export function installApplicationMenu(): void {
  const overrides = parseShortcutOverrides(readUiPrefs()[SHORTCUTS_STORAGE_KEY]);
  activeShortcuts = overrides;
  const key = (id: string) => shortcutKeys(id, overrides)[0];
  const isMac = process.platform === "darwin";
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu", submenu: [{role:"about"}, {type:"separator"}, {role:"services"}, {type:"separator"}, {role:"hide"}, {role:"hideOthers"}, {role:"unhide"}, {type:"separator"}, {role:"quit", accelerator:key("quit")}] } as MenuItemConstructorOptions] : []),
    {
      label: "Edit",
      submenu: [
        { role: "undo", accelerator: key("undo") },
        { role: "redo", accelerator: key("redo") },
        { type: "separator" },
        { role: "cut", accelerator: key("cut") },
        { role: "copy", accelerator: key("copy") },
        { role: "paste", accelerator: key("paste") },
        { role: "pasteAndMatchStyle", accelerator: key("pastePlain") },
        { role: "delete" },
        { role: "selectAll", accelerator: key("selectAll") },
        { type: "separator" },
        {
          label: "Find in Pane",
          accelerator: key("find"),
          click: (_item, win) => sendFindIntent(win as BrowserWindow | undefined),
        },
      ],
    },
    {
      label: "View",
      submenu: [
        { label: "Toggle Left Rail", accelerator: key("leftRail"), click: () => sendTogglePanel("leftRail") },
        { label: "Toggle File Tree", accelerator: key("fileTree"), click: () => sendTogglePanel("fileTree") },
        { label: "Toggle Workbench", accelerator: key("workbench"), click: () => sendTogglePanel("workbench") },
        { type: "separator" },
        { role: "reload", accelerator: key("reload") },
        { role: "forceReload", accelerator: key("forceReload") },
        { role: "toggleDevTools", accelerator: key("devTools") },
        { type: "separator" },
        { label: "Actual Size", accelerator: key("zoomReset"), click: (_item, win) => resetHostZoom(win as BrowserWindow | undefined) },
        { label: "Zoom In", accelerator: key("zoomIn"), click: (_item, win) => stepHostZoom(1, win as BrowserWindow | undefined) },
        // macOS reports "=" (not "+") for Cmd+= without Shift; bind it too so zoom-in
        // works without holding Shift. Hidden so the menu shows a single Zoom In entry
        // (acceleratorWorksWhenHidden defaults to true, so the shortcut still fires).
        ...(!overrides.zoomIn ? [{ label: "Zoom In", accelerator: "CmdOrCtrl+=", click: (_item, win) => stepHostZoom(1, win as BrowserWindow | undefined), visible: false } as MenuItemConstructorOptions] : []),
        { label: "Zoom Out", accelerator: key("zoomOut"), click: (_item, win) => stepHostZoom(-1, win as BrowserWindow | undefined) },
        { type: "separator" },
        { role: "togglefullscreen", accelerator: key("fullscreen") },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize", accelerator: key("minimize") },
        { role: "zoom" },
        {
          label: "Close",
          accelerator: key("close"),
          click: () => {
            BrowserWindow.getFocusedWindow()?.webContents.send("tide:close-intent");
          },
        },
        { label: "Close Window", accelerator: key("closeWindow"), role: "close" },
        ...(isMac
          ? [{ type: "separator" } as MenuItemConstructorOptions, { role: "front" } as MenuItemConstructorOptions]
          : []),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
