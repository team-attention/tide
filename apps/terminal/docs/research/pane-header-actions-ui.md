# Report: Pane Header Actions UI

## Objective

Add a mouse-first control surface to Tide so a user can create and split `Pane`s from visible header chrome instead of depending on `GlobalAction` keybindings.

## Tide Interaction Inventory

### Existing mouse-first surfaces

1. Titlebar toggles already expose `Workspace`, `FileTree`, `Dock`, theme, settings, and integration affordances in [crates/tide-app/src/adapter/outward/view/chrome/titlebar.rs](/Users/you/Workspace/tide/crates/tide-app/src/adapter/outward/view/chrome/titlebar.rs).
2. Header chrome already exposes close, git badges, compare/back, live-preview, diff refresh, and tab switching through `HeaderHitAction` and `check_header_click()` in [header.rs](/Users/you/Workspace/tide/crates/tide-app/src/adapter/outward/view/header.rs) and [click_adapter/header.rs](/Users/you/Workspace/tide/crates/tide-app/src/adapter/inward/click_adapter/header.rs).
3. Mouse routing already supports header clicks, browser navigation buttons, file tree clicks, drag-drop between `Pane`s, and split-border resizing in [mouse_adapter/mod.rs](/Users/you/Workspace/tide/crates/tide-app/src/adapter/inward/mouse_adapter/mod.rs).

### Keyboard-first gaps before this change

1. `GlobalAction::SplitHorizontal`, `SplitVertical`, `DockSplitHorizontal`, `DockSplitVertical`, `NewTab`, `NewFile`, and `OpenBrowser` are defined in [crates/tide-app/src/domain/input/mod.rs](/Users/you/Workspace/tide/crates/tide-app/src/domain/input/mod.rs).
2. Those creation flows are dispatched in [crates/tide-app/src/application/services/action_service/mod.rs](/Users/you/Workspace/tide/crates/tide-app/src/application/services/action_service/mod.rs).
3. The actual `Pane` creation behavior lives in [crates/tide-app/src/application/services/pane_create_service/mod.rs](/Users/you/Workspace/tide/crates/tide-app/src/application/services/pane_create_service/mod.rs):
   `new_terminal_tab()`, `new_editor_pane()`, `open_browser_pane()`, `split_with_launcher()`, and `resolve_launcher()`.
4. `new_editor_pane()` and `open_browser_pane()` already route non-`Terminal` `Pane`s into the Dock whenever a live context terminal exists, so the new header surface should preserve that routing instead of introducing a second rule set.
5. Before this work, header chrome did not expose any of those create/split flows directly.

## External UI Research

### Reference terminal UI

Relevant direction:

1. The reference screenshot shows a compact monochrome icon cluster at the far-right edge of pane headers, using simple outline controls instead of text badges.
2. The visible shell is dense, but creation and context switching stay near the active working surface instead of being buried in a global menu.
3. The useful takeaway for Tide is not the exact layout. It is the idea that terminal, browser, and agent surfaces should feel like sibling actions in the same working context.

### OpenAI Codex app

Source: <https://openai.com/index/introducing-the-codex-app/>

Relevant direction:

1. OpenAI describes the Codex app as a command center for AI agents with projects, tasks, approvals, and diff review in one place.
2. The product direction is contextual control. Actions live near the active work unit rather than behind mode-heavy navigation.
3. The useful takeaway for Tide is to keep the creation surface local to the active `Pane` or `TabGroup`, not in another modal layer.

### VS Code

Source: <https://code.visualstudio.com/docs/getstarted/userinterface>

Relevant direction:

1. VS Code separates global navigation from local editor-group actions.
2. Split editors and editor-group actions are exposed on the right side of the active header area.
3. The useful takeaway for Tide is the right-aligned action cluster on the local header surface, which keeps creation close to the current context without making the whole app chrome heavier.

## Design Decision

### Chosen pattern

Use a right-edge action strip on every visible single-`Pane` header and on every visible `TabGroup` header.

Action order:

1. `OpenBrowser`
2. `SplitHorizontal`
3. `SplitVertical`

### Why this pattern

1. It matches Tide's current structure. Header hit zones already exist and are the narrowest extension point.
2. It keeps Stage and Dock behavior contextual. The same action strip can dispatch to the correct underlying creation flow without forcing the user to focus first just to reveal the affordance.
3. It avoids adding a second top-level action bar that would compete with the titlebar toggles.
4. It aligns with the VS Code style of right-aligned group-local actions while still fitting Tide's terminal-first chrome.
5. The user screenshots preferred icon tiles over text badges, so the strip should read like compact header chrome rather than miniature command labels.
6. The reference screenshot favors small monochrome outline controls, so Tide should avoid bright semantic button colors in this strip.

### Visual language

1. Use compact monochrome line-style icon tiles so the strip reads as part of header chrome, not as a modal toolbar.
2. Keep the strip visible on every visible header surface, including unfocused single-`Pane` headers and unfocused `TabGroup` headers.
3. Anchor the strip to the far-right edge of the full header bar. Do not append it inside the active tab capsule.
4. Reserve width before title/tab elision so click targets stay stable and do not overlap tab-hit regions.
5. Remove `NewTerminal` and `NewFile` from the strip. Keep those flows on the existing keyboard and `Launcher` paths.
6. Use a simpler Browser glyph than the previous window-outline treatment. A compact unfilled globe with meridian/equator strokes fits the reference direction better than a filled dot or miniature browser window frame.
7. Keep the split glyphs as unfilled rectangular split marks rather than filled squares, so the header strip reads like a set of outline tools instead of status chips.

### Stage and Dock behavior

1. `OpenBrowser` preserves Tide's existing terminal-context routing. In practice, a focused Stage terminal header still opens that non-`Terminal` `Pane` in the Dock.
2. Split actions preserve the current Stage versus Dock routing of the underlying creation services.
3. Dock actions stay inside the Dock.
4. Dock split actions are allowed to reuse the current `Launcher`-based flow internally, but the click path must resolve the intermediate `Launcher` to a concrete `Terminal` before it returns.

## Implementation Scope

1. Spec: [docs/specs/pane-header-actions.md](/Users/you/Workspace/tide/docs/specs/pane-header-actions.md)
2. Behavior tests: [crates/tide-app/src/application/behavior_tests/pane_header_actions.rs](/Users/you/Workspace/tide/crates/tide-app/src/application/behavior_tests/pane_header_actions.rs)
3. Rendering: [crates/tide-app/src/adapter/outward/view/header.rs](/Users/you/Workspace/tide/crates/tide-app/src/adapter/outward/view/header.rs)
4. Click dispatch: [crates/tide-app/src/adapter/inward/click_adapter/header.rs](/Users/you/Workspace/tide/crates/tide-app/src/adapter/inward/click_adapter/header.rs)
5. Hover feedback: [drag_types.rs](/Users/you/Workspace/tide/crates/tide-app/src/domain/state/drag_types.rs), [hit_test.rs](/Users/you/Workspace/tide/crates/tide-app/src/adapter/inward/click_adapter/hit_test.rs), [hover.rs](/Users/you/Workspace/tide/crates/tide-app/src/adapter/outward/view/hover.rs), and [layout_compute.rs](/Users/you/Workspace/tide/crates/tide-app/src/layout_compute.rs)
