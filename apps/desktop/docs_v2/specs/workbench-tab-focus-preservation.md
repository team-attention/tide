# Spec: Workbench Tab Focus Preservation

## Scope

Workbench Stacked mode must always show exactly one selected tab whenever there
is at least one visible Workbench Pane. Opening, closing, hiding, revealing, and
switching Threads must preserve the selected tab unless that Pane no longer
exists.

This spec covers:

- Keeping tab selection and active Pane content in sync.
- Preserving selected Workbench Pane across Workbench close/open.
- Preserving selected Workbench Pane per Thread when switching Threads.
- Selecting the Launcher when the user opens a new Launcher through `+`.
- Closing a Browser while a Launcher remains open.

It does not cover:

- DOM keyboard focus inside Browser, Editor, or Terminal content.
- Split tree placement or split ratios.
- Persisting Workbench tab focus across app restarts.

## Problem

The current Product Shell can show Workbench content while no tab header is
selected, or can keep showing Browser content after a Launcher tab has been
added. It can also collapse the Workbench when the user closes the last real
Pane even though a Launcher Pane remains.

The root causes are:

1. The App Chrome view model falls back to rendering the first Pane as content
   when `activeWorkbenchPaneId` is missing, but each tab's selected state still
   checks the raw `activeWorkbenchPaneId`. This can render content with no
   selected tab.
2. Product Shell remembers Workbench open/closed state per Thread, but it does
   not remember selected Workbench Pane per Thread.
3. Product Shell close handling treats closing the last non-Launcher Pane as a
   reason to close the whole Workbench, even if a Launcher Pane remains.

## Decisions

### D1. A visible Workbench with Panes has one selected tab

In Stacked mode, if `workbenchPanes.length > 0`, the tab strip must have exactly
one selected tab and the content area must render that same Pane.

The default selection is only a last-resort guard. Normal flows must set or
preserve an explicit active Pane id. If the explicit id no longer names a visible
Pane, select the first remaining visible Pane so the UI cannot render an
unselected Workbench.

### D2. Workbench open state does not own tab selection

Closing or reopening the Workbench column must not change the selected Pane.
`workbenchOpenByThreadId` remains responsible only for whether the Workbench is
shown for a Thread.

### D3. Selected Pane is remembered per Thread

Product Shell stores the latest selected Workbench Pane id for each Thread. The
stored id is updated from backend `workbench.changed.activePaneId` and from local
focus actions. When the user returns to a Thread whose Workbench is visible, the
stored selected Pane is restored if it still exists.

### D4. New Launcher is selected

When the user opens a new Workbench Pane through `+`, the resulting Launcher Pane
must be selected. If an existing Launcher Pane is already present, it is selected
optimistically before the backend confirmation arrives. If the backend creates a
new Launcher Pane, `workbench.changed.activePaneId` selects it.

### D5. Closing Browser beside Launcher keeps Workbench open

If a Browser Pane is closed while a Launcher Pane remains, the Browser is removed,
the Workbench stays open, and the Launcher becomes selected. The Workbench closes
only when no visible Pane remains.

## Flow

### UC-1: Open Workbench

1. Thread has at least one Workbench Pane.
2. User opens the Workbench column.
3. Product Shell shows the Workbench.
4. The previously selected Pane for this Thread remains selected.

### UC-2: Reopen Workbench

1. User has selected a Workbench tab.
2. User closes the Workbench column.
3. User opens the Workbench column again.
4. The same tab is selected.

### UC-3: Switch Threads

1. Thread A has Pane A2 selected.
2. User switches to Thread B.
3. User switches back to Thread A.
4. If Pane A2 still exists, Pane A2 is selected.

### UC-4: Open Launcher

1. Browser is selected.
2. User clicks `+`.
3. Launcher Pane appears.
4. Launcher tab is selected and Launcher content is shown.

### UC-5: Close Browser while Launcher remains

1. Browser and Launcher are open.
2. Browser is selected.
3. User closes Browser.
4. Browser closes, Workbench remains open, Launcher is selected.

## Invariants

1. A non-empty Stacked Workbench has exactly one selected tab.
2. Selected tab and rendered content refer to the same Pane id.
3. Workbench open/closed state never clears selected Pane memory.
4. Thread switching restores selected Pane memory for the target Thread.
5. The default first-Pane selection is used only when the remembered/active Pane
   no longer exists.

## Tests

| Rule | Test |
|------|------|
| Non-empty Workbench always selects one tab | `workbench_view_model_selects_first_visible_tab_when_active_id_missing` |
| Tab and content selection use same resolved id | `workbench_view_model_keeps_active_tab_and_pane_in_sync` |
| Reopening Workbench preserves selected Pane | `reopening_workbench_preserves_selected_tab` |
| Thread switching restores selected Pane | `switching_threads_restores_selected_workbench_tab` |
| `+` selects existing Launcher immediately | `new_workbench_pane_focuses_existing_launcher` |
| Browser close beside Launcher keeps Workbench open | `closing_browser_with_launcher_remaining_keeps_workbench_open` |

## Implementation Notes

- Prefer backend `activePaneId` when present.
- Store active Pane memory in Product Shell state, not in the open/closed memory.
- The first-Pane default should be centralized in App Chrome view-model
  resolution so tab state and content state cannot diverge.
