import { app, BrowserWindow, ipcMain, Notification } from "electron";
import { isNotificationRequest, shouldEmitNotification } from "./notification-policy.ts";
// Native OS notifications, delivered from the MAIN process (not the renderer's web
// Notification API): main delivery needs no permission prompt (macOS auto-registers on
// first show), works while the renderer/webview is unfocused, and gives a reliable
// `click` event for window control. The pure gate/validation lives in notification-policy.
// See specs/focus-aware-notifications.md.

// Wire the renderer→main notify channel. `getWindow` is called at delivery time so a
// torn-down window is never captured. A click brings the window frontmost and, when the
// request names a thread, asks the renderer to activate it (a user action, so it is an
// allowed source of focus change — web-native-thread-model).
export function registerNotificationBridge(getWindow: () => BrowserWindow | undefined): void {
  ipcMain.on("tide:notify", (_event, request: unknown) => {
    if (!isNotificationRequest(request)) {
      return;
    }
    const appFocused = getWindow()?.isFocused() ?? false;
    if (!shouldEmitNotification({ appFocused, isActiveThread: request.isActiveThread === true })) {
      return;
    }
    if (!Notification.isSupported()) {
      return;
    }
    const notification = new Notification({ title: request.title, body: request.body });
    notification.on("click", () => {
      app.focus({ steal: true });
      const window = getWindow();
      if (window !== undefined && !window.isDestroyed()) {
        if (window.isMinimized()) {
          window.restore();
        }
        window.show();
        window.focus();
        if (request.threadId !== null && request.threadId.length > 0) {
          window.webContents.send("tide:activate-thread", request.threadId);
        }
      }
    });
    notification.show();
  });
}
