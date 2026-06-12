import { BrowserWindow, Menu } from "electron";
import type { MenuItemConstructorOptions } from "electron";
// Extracted from electron-main.ts (spec: navigable-source-structure).

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
    { role: "viewMenu" },
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
