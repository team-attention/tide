# Spec: Focus-Aware Native Notifications

## Scope

Make Tide's OS notifications reliable and focus-aware for the three existing
triggers:

1. An agent **finished a turn** (was running, now idle).
2. A thread **needs the user** (waiting for input/approval — `attention`).
3. An agent CLI posted an **update-available** notice.

A notification fires only when the user is **not actually looking at that thread**.
Move notification *delivery* from the renderer's web `Notification` API to the
Electron **main process** `Notification` module, and make a notification **click**
bring the window forward and activate the originating thread.

## Evidence

- `product-shell.tsx` (≈314–358, 494–509): all three notifications are built with
  the renderer **web `Notification`** API and gated only by `Notification.permission`.
- `selectBackgroundCompletions` (`state/thread-list.ts:111`) excludes
  `activeThreadId`, but reads **no OS window-focus state**. So when Tide is in the
  background (another app on top) and the agent finishes in the thread that is still
  `activeThreadId`, **no notification fires** — the moment it is most needed. The
  `attention` path has the opposite flaw: it notifies even for the thread the user
  is currently viewing (over-notify).
- `requestPermission()` is fired but its result is not awaited before the same tick
  checks `permission === "granted"`, so the first notification can be dropped.
- IPC patterns already in the repo:
  - main→renderer: `webContents.send("tide:x", payload)` + preload `onX(listener)`
    (`tide:open-browser-pane`, `tide:toggle-panel`, `tide:fullscreen-changed`).
  - renderer→main: `ipcRenderer.invoke`/`ipcMain.handle`.
- `onThreadSelect(threadId)` (`handlers/rail-handlers.ts:18` →
  `openProductShellThreadFromLeftRail`) is the thread-activation handler.
- `web-native-thread-model.md:15`: `activeThreadId` is set ONLY by user actions.
  A notification click **is** a user action, so activating its thread is compliant.
- `selectBackgroundCompletions` has **no** unit test; one renderer integration path
  uses it (`product-shell.tsx:349`). Safe to replace.

## Decisions

- **Deliver via main-process `Notification` (electron module).** Removes the renderer
  permission race (macOS auto-registers permission on first show), works regardless
  of renderer/webview focus, and gives a reliable `click` event for window control.
- **Focus gate lives in main**, using `BrowserWindow.isFocused()` (window-level).
  The renderer's `document.hasFocus()` is rejected: it returns `false` when a Browser
  Pane / terminal `<webview>` holds focus even though the window is frontmost, which
  would over-notify while the user is plainly looking at Tide.
- **Suppress only when the user is looking at that exact thread**: `appFocused &&
  isActiveThread`. Everything else notifies (background app, or a different thread).
- **The renderer owns "what happened"** (running→done / newly-attention transitions
  and `isActiveThread`); **main owns "is the user here"** (window focus) + OS delivery
  + click routing.
- Click → restore/show/focus the window, then `tide:activate-thread` → `onThreadSelect`.

## Out Of Scope

- Bypassing macOS Do Not Disturb / Focus modes (OS policy is respected; that was the
  user's actual "I didn't see it" cause and is not a code concern).
- Notification action buttons, custom sounds, grouping/coalescing of distinct alerts.
- In-app (non-OS) toast surface.

## Domain Model

`TideNotificationRequest` (renderer → main, fire-and-forget):

```
{
  kind: "agent_finished" | "needs_attention" | "agent_update";
  threadId: string | null;   // null for agent_update (no specific thread to open)
  title: string;
  body: string;
  isActiveThread: boolean;    // threadId === activeThreadId at emit time
}
```

## Contracts

- preload `TidePreloadSurface`:
  - `notify(request: TideNotificationRequest): void` → `ipcRenderer.send("tide:notify", request)`.
  - `onActivateThread(listener: (threadId: string) => void): () => void` ←
    `ipcRenderer.on("tide:activate-thread", …)`.
- main:
  - `ipcMain.on("tide:notify", …)` builds the OS notification through the gate.
  - notification `click` → `webContents.send("tide:activate-thread", threadId)`.
- `renderer-entry.tsx` `Window.tide` type mirrors the two new members.

## Flow

1. Renderer effect — completion: for every thread that went running→done and is not
   now `attention`, call `notify({ kind:"agent_finished", threadId, title, body:title,
   isActiveThread })`. (No `activeThreadId` exclusion here anymore — the gate is in main.)
2. Renderer effect — attention: for every newly-`attention` thread, call
   `notify({ kind:"needs_attention", threadId, title, body:title, isActiveThread })`.
3. Renderer `onBackendEvent` — `agentRuntime.noticePosted`: call
   `notify({ kind:"agent_update", threadId:null, title, body:message, isActiveThread:false })`.
4. Main `tide:notify`: if `shouldEmitNotification({ appFocused: win.isFocused(),
   isActiveThread })` is false, drop it. Else `new Notification({ title, body }).show()`;
   on `click` restore+show+focus the window and, when `threadId !== null`, send
   `tide:activate-thread`.
5. Renderer `useActivateThreadFromMain` → `onThreadSelect(threadId)`.

## Invariants

- The thread the user is actively viewing (`appFocused && isActiveThread`) never
  produces a notification.
- When the app is not focused, every completion/attention transition notifies.
- No permission prompt or first-notification race (main `Notification`).
- Existing dedupe stays: each transition notifies at most once (`prevRunningRef`,
  `notifiedAttentionRef`, `notifiedUpdatesRef`).
- A click activates the originating thread and brings the window frontmost; activation
  flows through the same user-action path as a left-rail click (`onThreadSelect`).

## Tests

- `notifications.test.ts` (main): `shouldEmitNotification`
  - `appFocused && isActiveThread` → `false` (suppressed).
  - `appFocused && !isActiveThread` → `true`.
  - `!appFocused && isActiveThread` → `true`.
  - `!appFocused && !isActiveThread` → `true`.
- `thread-list` test: `selectCompletedThreads(previousRunning, threads)`
  - was running, now idle, not attention → included (regardless of activeThreadId).
  - still running → excluded; now attention → excluded; was not previously running → excluded.

## Implementation Notes

- New `src/desktop/infrastructure/electron/main/notifications.ts`:
  pure `shouldEmitNotification({ appFocused, isActiveThread })` + `registerNotificationBridge(getWindow)`
  that wires `ipcMain.on("tide:notify", …)`. Keep it the *only* place that imports
  electron `Notification`.
- `electron-main.ts`: call `registerNotificationBridge(() => BrowserWindow.getAllWindows()[0])`
  once at module load (alongside the other `ipcMain` handlers).
- `state/thread-list.ts`: rename `selectBackgroundCompletions` →
  `selectCompletedThreads(previousRunning, threads)` (drop the `activeThreadId` param).
- `product-shell.tsx`: replace the three `new Notification(...)` sites with
  `window.tide?.notify?.(…)`; delete `Notification.permission`/`requestPermission`
  handling; add `useActivateThreadFromMain(handlers.onThreadSelect)`.
- `support/use-shell-effects.ts`: add `useActivateThreadFromMain(onThreadSelect)`
  (subscribe-once, latest-via-ref, mirroring `useOpenBrowserPaneFromMain`).
- `preload/index.ts` + `renderer-entry.tsx`: add `notify` + `onActivateThread`.
```