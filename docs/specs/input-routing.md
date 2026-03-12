# Spec: Input Routing

How a physical keypress becomes a state mutation. Covers keystroke resolution,
text routing, focus management, and GlobalAction dispatch.

## Bounded Contexts

| Context | Role |
|---------|------|
| `tide-platform` | Captures OS event, translates to PlatformEvent |
| `tide-app` | Routes through modal/focus/router chain |
| `tide-input` | Matches Hotkey → GlobalAction |
| `tide-terminal` / `tide-editor` | Receives text input |

## Use Cases

### UC-1: ResolveKeystroke

- **Actor**: User
- **Trigger**: PlatformEvent::KeyDown
- **Precondition**: App is running, event received
- **Flow**:
  1. Check modal interception chain (config_page → context_menu → save_confirm → save_as_input → file_finder → git_switcher → file_tree_rename)
  2. If modal consumes event → RETURN immediately
  3. Check FocusArea:
     - FileTree → handle file tree keys (arrows, enter, etc.)
     - PaneArea → continue to Router
  4. Router.process(KeyPress { key, modifiers })
     - Hotkey match → Action::GlobalAction(action)
     - No match → Action::RouteToPane(focused_id)
  5. Dispatch result
- **Postcondition**: Event consumed by modal, focus area handler, global action, or pane
- **Business Rules**:
  - BR-1: Plain text keys (no modifiers) route to focused Pane
  - BR-2: Modal intercepts prevent input from reaching Router or Pane
  - BR-3: Config page intercepts ALL keyboard input (highest priority)
  - BR-4: File finder intercepts keys before Pane
  - BR-5: Save confirm blocks all keys except ESC/Y/N
  - BR-6: Escape during pane drag cancels the drag
  - BR-7: FocusArea::FileTree consumes arrow keys
  - BR-8: GlobalAction keys work regardless of FocusArea
  - BR-9: Branch cleanup modal ESC cancels cleanup

### UC-2: RouteTextInput

- **Actor**: System (IME commit or direct text)
- **Trigger**: Text input arrives (IME commit, paste, key chars)
- **Precondition**: Text string to route
- **Flow**:
  1. Determine TextInputTarget via priority chain:
     - ConfigPage worktree/copy_files editing → ConfigPageWorktree/ConfigPageCopyFiles
     - SaveAsInput open → SaveAsInput
     - FileTreeRename open → FileTreeRename
     - FileFinder open → FileFinder
     - GitSwitcher open → GitSwitcher
     - SaveConfirm/ContextMenu/ConfigPage open → Consumed
     - SearchBar focused → SearchBar(id)
     - FocusArea::FileTree → Consumed
     - No focused Pane → Consumed
     - Focused Pane → Pane(id)
  2. Deliver text to resolved target
- **Postcondition**: Text delivered to correct target or consumed
- **Business Rules**:
  - BR-10: Text goes to Editor when nothing else is open
  - BR-11: Text goes to FileFinder when open
  - BR-12: Text goes to SearchBar when focused
  - BR-13: Text is consumed when no Pane is focused
  - BR-14: Text is consumed when FocusArea is FileTree
  - BR-15: Text goes to SaveAsInput when open
  - BR-16: Text goes to FileTreeRename when active
  - BR-17: ConfigPage worktree editing receives text
  - BR-18: ConfigPage copy_files editing receives text

### UC-3: ManageFocus

- **Actor**: User
- **Trigger**: GlobalAction::Navigate, GlobalAction::ToggleFileTree, GlobalAction::ToggleZoom, click
- **Precondition**: At least one Pane exists
- **Flow**:
  1. Focus switch: update app.focused, set focus_area, invalidate_chrome
  2. File tree toggle: cycle hidden→shown+focused→hidden
  3. Zoom toggle: set/clear zoomed_pane
- **Postcondition**: Focus, zoom, or file tree state updated
- **Business Rules**:
  - BR-19: New App starts with no focused Pane
  - BR-20: New App starts in PaneArea focus
  - BR-21: focus_terminal sets FocusArea to PaneArea
  - BR-22: Changing focused Pane increments chrome_generation
  - BR-23: Focusing same Pane does not change chrome_generation
  - BR-24: File tree toggle cycles: hidden → shown+focused → hidden
  - BR-25: Switching to PaneArea from FileTree preserves focused Pane
  - BR-26: ToggleZoom sets/clears zoomed_pane
  - BR-27: Zoom has no effect when FocusArea is FileTree

### UC-4: DispatchGlobalAction

- **Actor**: System (Router resolved a Hotkey)
- **Trigger**: Action::GlobalAction(action) from Router
- **Precondition**: GlobalAction variant determined
- **Flow**:
  1. Match action variant and delegate:
     - SplitVertical/Horizontal → split_with_launcher()
     - NewTab → new_terminal_tab()
     - NewFile → new_editor_pane()
     - ClosePane → close_specific_pane()
     - Find → open search bar
     - ToggleFileTree → toggle file tree + focus
     - ToggleFullscreen → set pending flag
     - FileFinder → open file finder modal
     - etc.
- **Postcondition**: Action executed
- **Business Rules**:
  - BR-28: SplitVertical/Horizontal creates new Pane in SplitLayout
  - BR-29: NewTab creates Launcher Pane
  - BR-30: NewFile creates Editor Pane in TabGroup
  - BR-31: Find opens search bar on focused Pane
  - BR-32: Find again reuses existing search bar
  - BR-33: ToggleFileTree shows/hides and sets FocusArea
  - BR-34: ToggleFullscreen sets pending flag
  - BR-35: FileFinder opens file finder modal

## Tests

| UC | BR | Test module | Test |
|----|-----|-------------|------|
| UC-1 | BR-1 | `keyboard_routing` | `plain_text_keys_route_to_focused_pane` |
| UC-1 | BR-3 | `keyboard_routing` | `config_page_intercepts_all_keyboard_input` |
| UC-1 | BR-3 | `keyboard_routing` | `escape_during_config_page_closes_config_page` |
| UC-1 | BR-4 | `keyboard_routing` | `file_finder_intercepts_keys_before_pane` |
| UC-1 | BR-5 | `keyboard_routing` | `save_confirm_blocks_all_keys_except_escape` |
| UC-1 | BR-6 | `keyboard_routing` | `escape_during_pane_drag_cancels_the_drag` |
| UC-1 | BR-7 | `keyboard_routing` | `focus_area_file_tree_consumes_arrow_keys` |
| UC-1 | BR-8 | `keyboard_routing` | `global_action_keys_work_when_focus_area_is_file_tree` |
| UC-1 | BR-9 | `keyboard_routing` | `branch_cleanup_enter_means_keep_branch` |
| UC-2 | BR-10 | `text_input_routing` | `text_goes_to_editor_when_nothing_else_is_open` |
| UC-2 | BR-11 | `text_input_routing` | `text_goes_to_file_finder_when_open` |
| UC-2 | BR-12 | `text_input_routing` | `text_goes_to_search_bar_when_focused` |
| UC-2 | BR-13 | `text_input_routing` | `text_is_consumed_when_no_pane_is_focused` |
| UC-2 | BR-14 | `text_input_routing` | `text_is_consumed_when_file_tree_has_focus` |
| UC-2 | BR-15 | `text_input_routing` | `text_goes_to_save_as_input_when_open` |
| UC-2 | BR-16 | `text_input_routing` | `text_goes_to_file_tree_rename_when_active` |
| UC-2 | BR-17 | `text_input_routing` | `config_page_worktree_editing_receives_text` |
| UC-2 | BR-18 | `text_input_routing` | `config_page_copy_files_editing_receives_text` |
| UC-3 | BR-19 | `focus_management` | `new_app_starts_with_no_focused_pane` |
| UC-3 | BR-20 | `focus_management` | `new_app_starts_in_pane_area_focus` |
| UC-3 | BR-21 | `focus_management` | `focus_terminal_sets_focus_area_to_pane_area` |
| UC-3 | BR-22 | `focus_management` | `focus_terminal_updates_chrome_generation_when_changing_pane` |
| UC-3 | BR-23 | `focus_management` | `focus_terminal_same_pane_does_not_change_chrome` |
| UC-3 | BR-24 | `focus_management` | `toggling_file_tree_focus_cycles_through_three_states` |
| UC-3 | BR-25 | `focus_management` | `switching_to_pane_area_from_file_tree_preserves_focused_pane` |
| UC-3 | BR-26 | `focus_management` | `toggling_zoom_on_focused_pane_fills_entire_area` |
| UC-3 | BR-26 | `focus_management` | `toggling_zoom_again_restores_split_layout` |
| UC-3 | BR-27 | `focus_management` | `zoom_has_no_effect_when_focus_area_is_file_tree` |
| UC-4 | BR-28 | `global_actions` | `split_vertical_creates_new_pane_in_split_layout_and_focuses_it` |
| UC-4 | BR-28 | `global_actions` | `split_horizontal_creates_new_pane_in_split_layout_and_focuses_it` |
| UC-4 | BR-29 | `global_actions` | `new_tab_global_action_creates_launcher_pane` |
| UC-4 | BR-30 | `global_actions` | `new_file_global_action_creates_editor_pane_in_tab_group` |
| UC-4 | BR-31 | `global_actions` | `find_opens_search_bar_on_focused_pane` |
| UC-4 | BR-32 | `global_actions` | `find_again_reuses_existing_search_bar` |
| UC-4 | BR-33 | `global_actions` | `toggle_file_tree_from_pane_area_sets_focus_area_to_file_tree` |
| UC-4 | BR-33 | `global_actions` | `toggle_file_tree_again_hides_and_restores_focus_area_to_pane_area` |
| UC-4 | BR-34 | `global_actions` | `toggle_fullscreen_sets_pending_flag` |
| UC-4 | BR-35 | `global_actions` | `file_finder_opens_via_global_action` |

## Location

| Layer | Crate | Key Files |
|-------|-------|-----------|
| Platform | tide-platform | `macos/view.rs` (keyDown → PlatformEvent) |
| Input | tide-input | `router.rs`, `hotkey.rs` |
| Orchestrator | tide-app | `event_handler/`, `app.rs` |
| Tests | tide-app | `behavior_tests.rs :: mod keyboard_routing, text_input_routing, focus_management, global_actions` |
