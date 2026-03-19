use super::*;
use std::path::PathBuf;
use tide_core::Rect;

// ── InputLine ──

#[test]
fn input_line_insert_and_cursor() {
    let mut il = InputLine::new();
    il.insert_char('h');
    il.insert_char('i');
    assert_eq!(il.text, "hi");
    assert_eq!(il.cursor, 2);
}

#[test]
fn input_line_backspace() {
    let mut il = InputLine::with_text("abc".into());
    il.backspace();
    assert_eq!(il.text, "ab");
    assert_eq!(il.cursor, 2);
}

#[test]
fn input_line_backspace_at_start() {
    let mut il = InputLine::new();
    il.backspace(); // should not panic
    assert_eq!(il.text, "");
    assert_eq!(il.cursor, 0);
}

#[test]
fn input_line_delete_char() {
    let mut il = InputLine::with_text("abc".into());
    il.cursor = 1;
    il.delete_char();
    assert_eq!(il.text, "ac");
    assert_eq!(il.cursor, 1);
}

#[test]
fn input_line_delete_at_end() {
    let mut il = InputLine::with_text("abc".into());
    il.delete_char(); // cursor at end, no-op
    assert_eq!(il.text, "abc");
}

#[test]
fn input_line_cursor_movement() {
    let mut il = InputLine::with_text("abc".into());
    il.move_cursor_left();
    assert_eq!(il.cursor, 2);
    il.move_cursor_left();
    assert_eq!(il.cursor, 1);
    il.move_cursor_right();
    assert_eq!(il.cursor, 2);
}

#[test]
fn input_line_cursor_bounds() {
    let mut il = InputLine::with_text("a".into());
    il.move_cursor_right(); // already at end
    assert_eq!(il.cursor, 1);
    il.cursor = 0;
    il.move_cursor_left(); // already at start
    assert_eq!(il.cursor, 0);
}

#[test]
fn input_line_utf8_handling() {
    let mut il = InputLine::new();
    il.insert_char('한');
    il.insert_char('글');
    assert_eq!(il.text, "한글");
    assert_eq!(il.cursor, "한글".len()); // byte length
    il.backspace();
    assert_eq!(il.text, "한");
    il.move_cursor_left();
    assert_eq!(il.cursor, 0);
    il.move_cursor_right();
    assert_eq!(il.cursor, "한".len());
}

#[test]
fn input_line_insert_in_middle() {
    let mut il = InputLine::with_text("ac".into());
    il.cursor = 1;
    il.insert_char('b');
    assert_eq!(il.text, "abc");
    assert_eq!(il.cursor, 2);
}

// ── shell_escape ──

#[test]
fn shell_escape_plain() {
    assert_eq!(shell_escape("hello"), "hello");
}

#[test]
fn shell_escape_with_spaces() {
    assert_eq!(shell_escape("hello world"), "'hello world'");
}

#[test]
fn shell_escape_with_single_quotes() {
    assert_eq!(shell_escape("it's"), "'it'\\''s'");
}

#[test]
fn shell_escape_with_special_chars() {
    assert_eq!(shell_escape("$HOME"), "'$HOME'");
    assert_eq!(shell_escape("a;b"), "'a;b'");
    assert_eq!(shell_escape("a|b"), "'a|b'");
}

#[test]
fn shell_escape_rejects_control_chars() {
    assert_eq!(shell_escape("a\x01b"), "''");
}

// ── FileFinderState ──

#[test]
fn file_finder_filter() {
    let entries = vec![
        PathBuf::from("src/main.rs"),
        PathBuf::from("src/lib.rs"),
        PathBuf::from("Cargo.toml"),
    ];
    let mut ff = FileFinderState::new(PathBuf::from("/"), entries);
    assert_eq!(ff.filtered.len(), 3);

    ff.insert_char('r');
    ff.insert_char('s');
    // "rs" matches "src/main.rs" and "src/lib.rs"
    assert_eq!(ff.filtered.len(), 2);
    assert_eq!(ff.selected, 0);

    ff.backspace();
    ff.backspace();
    assert_eq!(ff.filtered.len(), 3);
}

#[test]
fn file_finder_select_up_down() {
    let entries = vec![
        PathBuf::from("a"),
        PathBuf::from("b"),
        PathBuf::from("c"),
    ];
    let mut ff = FileFinderState::new(PathBuf::from("/"), entries);
    assert_eq!(ff.selected, 0);

    ff.select_down();
    assert_eq!(ff.selected, 1);
    ff.select_down();
    assert_eq!(ff.selected, 2);
    ff.select_down(); // at end, no change
    assert_eq!(ff.selected, 2);

    ff.select_up();
    assert_eq!(ff.selected, 1);
    ff.select_up();
    assert_eq!(ff.selected, 0);
    ff.select_up(); // at start, no change
    assert_eq!(ff.selected, 0);
}

#[test]
fn file_finder_selected_path() {
    let entries = vec![
        PathBuf::from("foo.txt"),
        PathBuf::from("bar.txt"),
    ];
    let ff = FileFinderState::new(PathBuf::from("/base"), entries);
    assert_eq!(ff.selected_path(), Some(PathBuf::from("/base/foo.txt")));
}

// ── ContextMenuAction ──

#[test]
fn context_menu_items_file() {
    let items = ContextMenuAction::items(false, true);
    assert_eq!(items.len(), 2); // Rename, Delete
}

#[test]
fn context_menu_items_dir_idle() {
    let items = ContextMenuAction::items(true, true);
    assert_eq!(items.len(), 5); // CdHere, OpenTerminalHere, RevealInFinder, Rename, Delete
}

#[test]
fn context_menu_items_dir_busy() {
    let items = ContextMenuAction::items(true, false);
    assert_eq!(items.len(), 4); // no CdHere when busy
}

// ── SaveAsInput ──

#[test]
fn save_as_resolve_path() {
    let sa = SaveAsInput {
        pane_id: 1,
        filename: InputLine::with_text("test.rs".into()),
        directory: InputLine::with_text("/tmp".into()),
        active_field: SaveAsField::Filename,
        anchor_rect: Rect::new(0.0, 0.0, 100.0, 20.0),
    };
    assert_eq!(sa.resolve_path(), Some(PathBuf::from("/tmp/test.rs")));
}

#[test]
fn save_as_empty_filename() {
    let sa = SaveAsInput {
        pane_id: 1,
        filename: InputLine::new(),
        directory: InputLine::with_text("/tmp".into()),
        active_field: SaveAsField::Filename,
        anchor_rect: Rect::new(0.0, 0.0, 100.0, 20.0),
    };
    assert_eq!(sa.resolve_path(), None);
}

#[test]
fn save_as_absolute_filename() {
    let sa = SaveAsInput {
        pane_id: 1,
        filename: InputLine::with_text("/abs/path.rs".into()),
        directory: InputLine::with_text("/tmp".into()),
        active_field: SaveAsField::Filename,
        anchor_rect: Rect::new(0.0, 0.0, 100.0, 20.0),
    };
    assert_eq!(sa.resolve_path(), Some(PathBuf::from("/abs/path.rs")));
}

#[test]
fn save_as_toggle_field() {
    let mut sa = SaveAsInput {
        pane_id: 1,
        filename: InputLine::new(),
        directory: InputLine::new(),
        active_field: SaveAsField::Filename,
        anchor_rect: Rect::new(0.0, 0.0, 100.0, 20.0),
    };
    sa.toggle_field();
    assert_eq!(sa.active_field, SaveAsField::Directory);
    sa.toggle_field();
    assert_eq!(sa.active_field, SaveAsField::Filename);
}

// ── ImeState ──

#[test]
fn ime_state_new_defaults() {
    let ime = ImeState::new();
    assert!(!ime.composing);
    assert!(ime.preedit.is_empty());
    assert_eq!(ime.last_target, None);
    assert!(ime.pending_creates.is_empty());
    assert!(ime.pending_removes.is_empty());
    assert!(ime.cursor_dirty);
}

#[test]
fn ime_state_clear_composition() {
    let mut ime = ImeState::new();
    ime.composing = true;
    ime.preedit = "ㅎ".to_string();
    ime.clear_composition();
    assert!(!ime.composing);
    assert!(ime.preedit.is_empty());
}

#[test]
fn ime_state_set_preedit_nonempty() {
    let mut ime = ImeState::new();
    ime.set_preedit("ㅎ");
    assert!(ime.composing);
    assert_eq!(ime.preedit, "ㅎ");
}

#[test]
fn ime_state_set_preedit_empty_clears() {
    let mut ime = ImeState::new();
    ime.composing = true;
    ime.preedit = "ㅎ".to_string();
    ime.set_preedit("");
    assert!(!ime.composing);
    assert!(ime.preedit.is_empty());
}

#[test]
fn ime_state_pending_queues() {
    let mut ime = ImeState::new();
    ime.pending_creates.push(1);
    ime.pending_creates.push(2);
    ime.pending_removes.push(3);
    assert_eq!(ime.pending_creates.len(), 2);
    assert_eq!(ime.pending_removes.len(), 1);
}

// ── ModalStack ──

#[test]
fn modal_stack_new_all_none() {
    let ms = ModalStack::new();
    assert!(ms.file_finder.is_none());
    assert!(ms.git_switcher.is_none());
    assert!(ms.config_page.is_none());
    assert!(ms.save_as_input.is_none());
    assert!(ms.save_confirm.is_none());
    assert!(ms.context_menu.is_none());
    assert!(ms.file_tree_rename.is_none());
    assert!(ms.branch_cleanup.is_none());
}

#[test]
fn modal_stack_is_any_open_empty() {
    let ms = ModalStack::new();
    assert!(!ms.is_any_open());
}

#[test]
fn modal_stack_is_any_open_file_finder() {
    let mut ms = ModalStack::new();
    ms.file_finder = Some(FileFinderState::new(PathBuf::from("/tmp"), vec![]));
    assert!(ms.is_any_open());
}

#[test]
fn modal_stack_is_any_open_config_page() {
    let mut ms = ModalStack::new();
    ms.config_page = Some(ConfigPageState::new(vec![], String::new(), String::new()));
    assert!(ms.is_any_open());
}

#[test]
fn modal_stack_close_all() {
    let mut ms = ModalStack::new();
    ms.file_finder = Some(FileFinderState::new(PathBuf::from("/tmp"), vec![]));
    ms.config_page = Some(ConfigPageState::new(vec![], String::new(), String::new()));
    ms.close_all();
    assert!(!ms.is_any_open());
}

// ── RenderCache ──

#[test]
fn render_cache_new_defaults() {
    let rc = RenderCache::new();
    assert!(rc.needs_redraw);
    assert!(rc.pane_generations.is_empty());
    assert_eq!(rc.chrome_generation, 0);
    assert_eq!(rc.layout_generation, 0);
}

#[test]
fn render_cache_invalidate_chrome() {
    let mut rc = RenderCache::new();
    rc.needs_redraw = false;
    let gen_before = rc.chrome_generation;
    rc.invalidate_chrome();
    assert_eq!(rc.chrome_generation, gen_before + 1);
    assert!(rc.needs_redraw);
}

#[test]
fn render_cache_invalidate_pane() {
    let mut rc = RenderCache::new();
    rc.pane_generations.insert(42, 100);
    rc.needs_redraw = false;
    rc.invalidate_pane(42);
    assert!(!rc.pane_generations.contains_key(&42));
    assert!(rc.needs_redraw);
}

#[test]
fn render_cache_is_chrome_dirty() {
    let mut rc = RenderCache::new();
    rc.last_chrome_generation = 0;
    rc.chrome_generation = 0;
    assert!(!rc.is_chrome_dirty());
    rc.chrome_generation = 1;
    assert!(rc.is_chrome_dirty());
}

// ── InteractionState ──

#[test]
fn interaction_state_new_defaults() {
    let is = InteractionState::new();
    assert!(!is.mouse_left_pressed);
    assert!(is.scrollbar_dragging.is_none());
    assert!(is.hover_target.is_none());
    assert!(is.scroll_accumulator.is_empty());
}

// ── FileTreeModel ──

#[test]
fn file_tree_model_new_defaults() {
    let ft = FileTreeModel::new(200.0);
    assert_eq!(ft.width, 200.0);
    assert!(!ft.visible);
    assert!(ft.tree.is_none());
    assert_eq!(ft.scroll, 0.0);
    assert_eq!(ft.cursor, 0);
    assert!(ft.git_status.is_empty());
}

// ── WorkspaceManager ──

#[test]
fn workspace_manager_new_defaults() {
    let wm = WorkspaceManager::new();
    assert!(wm.workspaces.is_empty());
    assert_eq!(wm.active, 0);
    assert!(!wm.show_sidebar);
    assert!(wm.sidebar_rect.is_none());
    assert!(wm.drag.is_none());
}
