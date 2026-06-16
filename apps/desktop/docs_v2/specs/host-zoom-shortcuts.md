# Spec: Host Zoom Shortcuts (Cmd +/-/0)

> Status: **IMPLEMENTED** (branch `zoom`). Global app zoom that scales the WHOLE Tide
> window — the React host UI **and** Browser Pane `<webview>` guests — together, with a
> floating indicator that shows the current % and resets to 100% on click.

## Problem

`Cmd +/-` stopped zooming the app. The View menu used Electron's built-in
`role: "zoomIn" | "zoomOut" | "resetZoom"`, and those roles act on the **focused**
`webContents`. When a Browser Pane `<webview>` had focus, that focused webContents was
the embedded guest page — so the shortcut zoomed only the page inside the webview and
left the Tide UI untouched (from the user's view, "zoom doesn't work"). This is the
same focus trap the panel-toggle shortcuts already work around with `click` handlers
that target the host window explicitly (`sendTogglePanel`).

## Behaviour

| Shortcut | Action |
|----------|--------|
| **⌘+ / ⌘=** (`CmdOrCtrl+Plus`, `CmdOrCtrl+=`) | Zoom in one ladder stop |
| **⌘-** (`CmdOrCtrl+-`) | Zoom out one ladder stop |
| **⌘0** (`CmdOrCtrl+0`) | Reset to 100% (menu label "Actual Size") |

- **Everything scales together.** Main zooms the host window's `webContents` and
  broadcasts the factor; the renderer mirrors that factor onto every `<webview>` guest
  (guests do NOT inherit host-window zoom), so UI + embedded pages stay in lockstep.
- **Ladder of clean stops** so the indicator reads round percentages:
  `0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3` (50% … 300%).
- **Indicator**: a small floating pill (bottom-right), shown only when zoom ≠ 100%.
  It displays the current % and resets to 100% on click — like a browser's zoom badge.
- **Per-session, not persisted**: the window always opens at 100%. Chromium persists
  per-origin zoom in the session store, so main resets the host zoom to 1 on each load
  (`dom-ready`, before paint). The indicator seeds from `getZoom()` (→ 100%) on mount.

## Why menu accelerators (not a renderer keydown)

Same reason as panel toggles: an application-menu accelerator fires even when focus is
inside a `<webview>` or terminal, and shows in the View menu (discoverable). The click
handlers prefer the `browserWindow` Electron passes the callback over a global
`getFocusedWindow()` lookup — it's the correct target and stays defined even when no
window holds OS focus for a moment.

## Implementation

- `main/zoom.ts` — pure `steppedZoomFactor(current, dir)` ladder math + `applyHostZoom`
  (sets host `webContents` zoom factor and broadcasts `tide:zoom-changed`).
- `main/app-menu.ts` — View-menu items call `stepHostZoom`/`resetHostZoom`.
- `main/electron-main.ts` — `tide:reset-zoom` (indicator click) + `tide:get-zoom` (seed).
- `preload/index.ts` — `onZoomChanged` / `resetZoom` / `getZoom`.
- `product-shell/support/global-zoom.tsx` — `GlobalZoomIndicator`: subscribes to the
  broadcast, mirrors the factor onto current + future `<webview>`s (MutationObserver +
  `dom-ready`), and renders the indicator. Mounted once in `renderer-entry.tsx`.

## Verification

- Unit: `tests/host-zoom-ladder.test.ts` (ladder stepping/clamping; broadcast contract).
- Live: `scripts/pw-zoom-verify.cjs` — opens an `.html` `<webview>` preview, focuses
  INTO it, drives the View-menu zoom items, and asserts host + webview zoom factors move
  together (1.1, reset, 0.9), the indicator shows the right % and resets on click. It
  normalises to 100% at start and end (zoom persists in shared userData). Screenshots at
  100% / 110% / 90% confirm crisp, proportional scaling (no double-scale / blur).
