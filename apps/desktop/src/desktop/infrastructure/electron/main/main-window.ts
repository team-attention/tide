import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { mainDir } from "./backend-bridge.ts";
import { BrowserWindow } from "electron";
import { runElectronRuntimeSmoke } from "./runtime-smoke.ts";
// Extracted from electron-main.ts (spec: navigable-source-structure).

export interface TideDesktopMainEntrypoint {
  productName: string;
  backendEntrypoint: string;
  rendererRoot: string;
}

export const tideDesktopMainEntrypoint: TideDesktopMainEntrypoint = {
  productName: "Tide",
  backendEntrypoint: "src/backend/infrastructure/node/entrypoints/backend-entrypoint.ts",
  rendererRoot: "src/desktop/infrastructure/electron/renderer",
};

// The URL the main host renderer is loaded from — the dev-server origin in
// development, or the packaged renderer's file:// document. The navigation
// policy treats this as "the app" and everything else as off-app.
export function appRendererUrl(): string {
  return (
    process.env.ELECTRON_RENDERER_URL ??
    pathToFileURL(join(mainDir, "../renderer/index.html")).href
  );
}

export function createMainWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: tideDesktopMainEntrypoint.productName,
    // Frameless: no native title bar so the app's own top row is the chrome.
    // Keep the native traffic lights (functional) and place them inside the
    // Left Rail Top Row to match the canonical Figma (one set of controls, not two).
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 19, y: 19 },
    webPreferences: {
      preload: join(mainDir, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      // Don't throttle the renderer's timers when the window is occluded/hidden (e.g. Tide
      // sits on another macOS Space). Chromium clamps a hidden page's timers (to ~1/min after
      // a few minutes — "intensive wake-up throttling"), which would delay the coalescing
      // flush that folds backend events into thread state and drives completion /
      // needs-attention notifications — so a long-running background agent could finish and
      // go unannounced for up to a minute. Background notification is a core promise of the
      // app, so keep the off-screen renderer responsive.
      backgroundThrottling: false,
    },
  });

  // Tell the renderer when native fullscreen hides the macOS traffic lights, so
  // the Left Rail top row can reclaim the space they normally reserve.
  const sendFullscreen = (isFullscreen: boolean) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send("tide:fullscreen-changed", isFullscreen);
    }
  };
  mainWindow.on("enter-full-screen", () => sendFullscreen(true));
  mainWindow.on("leave-full-screen", () => sendFullscreen(false));

  const rendererLoaded =
    process.env.ELECTRON_RENDERER_URL !== undefined
      ? mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
      : mainWindow.loadFile(join(mainDir, "../renderer/index.html"));

  void rendererLoaded.then(() => runElectronRuntimeSmoke(mainWindow));

  return mainWindow;
}
