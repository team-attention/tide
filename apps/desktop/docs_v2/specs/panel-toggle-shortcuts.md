# Spec: Panel Toggle Shortcuts (Left Rail / File Tree / Workbench)

> Status: **IMPLEMENTED** (branch `desktop-multitask-polish`). Keyboard shortcuts to
> show/hide each of the three collapsible Product-Shell panels.

## Scope

Give each of the three togglable panels its own keyboard shortcut:

| Panel | Shortcut | What it toggles |
|-------|----------|-----------------|
| **Left Rail** (threads/projects) | **⌘B** (`CmdOrCtrl+B`) | `leftRailOpen` |
| **File Tree** (file explorer) | **⌘E** (`CmdOrCtrl+E`) | `fileTreeOpen` |
| **Workbench** (browsers/editors/terminals) | **⌘J** (`CmdOrCtrl+J`) | `workbenchOpen` |

Key choices follow conventions: ⌘B is the universal "toggle sidebar", ⌘E ≈ Explorer,
⌘J ≈ panel. All single-modifier, and free of existing accelerators (⌘W close-intent,
⌘R reload, ⌘P Quick Open, ⌘⇧F content search, ⌥1..9 / ⌥Tab multitask).

## Evidence (already present before this change)

- **Toggle reducers exist:** `state/thread-list.ts` `toggleProductShellLeftRail`,
  `state/file-tree.ts` `toggleProductShellFileTreeWithRefresh`, `state/workbench.ts`
  `toggleProductShellWorkbenchWithLauncher`.
- **Renderer handlers exist:** `onLeftRailToggle` (rail-handlers), `onFileTreeToggle`
  (editor-handlers), `onWorkbenchToggle` (workbench-handlers) — already wired to the
  on-screen toggle buttons (chrome.tsx / chat-column.tsx / left-rail.tsx).
- **Gap:** none of them had a keyboard shortcut.
- **Pattern to mirror:** the ⌘W "close intent" already routes
  app-menu → `webContents.send` → preload listener → renderer (`app-menu.ts:24`,
  `preload/index.ts onCloseIntent`, `product-shell.tsx` useEffect).

## Decisions

1. **Menu accelerators, not a renderer keydown.** The shortcuts live as items in a
   custom **View** menu (`app-menu.ts`), each with an `accelerator` + `click` that does
   `webContents.send("tide:toggle-panel", panel)`. Reasons:
   - **Focus-robust:** a renderer `keydown` listener can be swallowed when a `<webview>`
     Browser Pane or a terminal has focus. macOS matches menu key-equivalents before the
     event reaches the focused web content, so the toggle always fires.
   - **Discoverable:** the shortcut shows next to the item in the menu bar.
   The custom View menu keeps the standard items (reload / devtools / zoom / fullscreen).
2. **One IPC channel, one panel id.** `tide:toggle-panel` carries
   `"leftRail" | "fileTree" | "workbench"` (one preload method `onTogglePanel`, one
   renderer subscription) rather than three channels.
3. **Renderer owns the open/close.** The menu only signals intent; the renderer routes
   the panel id to the existing toggle handler (`usePanelToggleFromMenu` in
   `support/use-shell-effects.ts`, subscribed once, latest handlers via a commit-phase
   ref — same convention as `useEscapeShortcuts`). No new state or reducer.

## Files

- `infrastructure/electron/main/app-menu.ts` — custom View menu + `sendTogglePanel`.
- `infrastructure/electron/preload/index.ts` — `onTogglePanel` surface + impl.
- `infrastructure/electron/renderer/renderer-entry.tsx` — `window.tide.onTogglePanel` type.
- `react-renderer/product-shell/support/use-shell-effects.ts` — `usePanelToggleFromMenu`.
- `react-renderer/product-shell/product-shell.tsx` — calls the hook with the 3 handlers.

## Verification

Live (no unit test — matches the existing menu/IPC wiring, which is integration-verified):
1. With focus in the chat/composer: **⌘B** hides/shows the Left Rail; **⌘E** the File
   Tree; **⌘J** the Workbench. Each press flips the panel.
2. Click into a **Browser Pane** (webview) or a **terminal**, then press the same keys —
   they still toggle (the menu-accelerator path is focus-independent).
3. The **View** menu lists "Toggle Left Rail / File Tree / Workbench" with ⌘B / ⌘E / ⌘J,
   and reload/zoom/fullscreen still work.
