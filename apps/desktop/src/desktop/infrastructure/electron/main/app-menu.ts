import { BrowserWindow, Menu } from "electron";
import type { MenuItemConstructorOptions } from "electron";
// Extracted from electron-main.ts (spec: navigable-source-structure).

// View-menu panel toggles route through a menu accelerator (not a renderer keydown)
// so they fire even when focus is inside a <webview> Browser Pane or a terminal — and
// the shortcut shows in the menu, making it discoverable. The renderer decides the
// actual open/close via its existing toggle handlers. Spec: panel-toggle-shortcuts.
function sendTogglePanel(panel: "leftRail" | "fileTree" | "workbench"): void {
  BrowserWindow.getFocusedWindow()?.webContents.send("tide:toggle-panel", panel);
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
    { role: "editMenu" },
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
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
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
