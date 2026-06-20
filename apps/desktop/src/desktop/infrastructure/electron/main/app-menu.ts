import { BrowserWindow, Menu } from "electron";
import type { MenuItemConstructorOptions } from "electron";
import { applyHostZoom, steppedZoomFactor } from "./zoom.ts";
// Extracted from electron-main.ts (spec: navigable-source-structure).

// View-menu panel toggles route through a menu accelerator (not a renderer keydown)
// so they fire even when focus is inside a <webview> Browser Pane or a terminal — and
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
// webContents — when a Browser Pane <webview> has focus that's the guest page,
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
  const isMac = process.platform === "darwin";
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" } as MenuItemConstructorOptions] : []),
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { role: "selectAll" },
        { type: "separator" },
        {
          label: "Find in Pane",
          accelerator: "CmdOrCtrl+F",
          click: (_item, win) => sendFindIntent(win as BrowserWindow | undefined),
        },
      ],
    },
    {
      label: "View",
      submenu: [
        { label: "Toggle Left Rail", accelerator: "CmdOrCtrl+B", click: () => sendTogglePanel("leftRail") },
        { label: "Toggle File Tree", accelerator: "CmdOrCtrl+E", click: () => sendTogglePanel("fileTree") },
        { label: "Toggle Workbench", accelerator: "CmdOrCtrl+J", click: () => sendTogglePanel("workbench") },
        { type: "separator" },
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { label: "Actual Size", accelerator: "CmdOrCtrl+0", click: (_item, win) => resetHostZoom(win as BrowserWindow | undefined) },
        { label: "Zoom In", accelerator: "CmdOrCtrl+Plus", click: (_item, win) => stepHostZoom(1, win as BrowserWindow | undefined) },
        // macOS reports "=" (not "+") for Cmd+= without Shift; bind it too so zoom-in
        // works without holding Shift. Hidden so the menu shows a single Zoom In entry
        // (acceleratorWorksWhenHidden defaults to true, so the shortcut still fires).
        { label: "Zoom In", accelerator: "CmdOrCtrl+=", click: (_item, win) => stepHostZoom(1, win as BrowserWindow | undefined), visible: false },
        { label: "Zoom Out", accelerator: "CmdOrCtrl+-", click: (_item, win) => stepHostZoom(-1, win as BrowserWindow | undefined) },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        {
          label: "Close",
          accelerator: "CmdOrCtrl+W",
          click: () => {
            BrowserWindow.getFocusedWindow()?.webContents.send("tide:close-intent");
          },
        },
        { label: "Close Window", accelerator: "Shift+CmdOrCtrl+W", role: "close" },
        ...(isMac
          ? [{ type: "separator" } as MenuItemConstructorOptions, { role: "front" } as MenuItemConstructorOptions]
          : []),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
