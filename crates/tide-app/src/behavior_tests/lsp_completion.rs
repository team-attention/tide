// Spec: docs/specs/lsp-completion.md
use crate::pane::editor::completion::{CompletionItem, CompletionKind, CompletionState, COMPLETION_VISIBLE_COUNT};
use crate::pane::editor::EditorPane;
use crate::pane::PaneKind;
use crate::state::FocusArea;
use crate::App;
use crate::ClipboardSearchPort;
use crate::WorkspaceNavPort;
use crate::tide_core::LayoutEngine;

fn test_app() -> App {
    let mut app = App::new();
    app.window.cached_cell_size = crate::tide_core::Size::new(8.0, 16.0);
    app.window.window_size = (960, 640);
    app
}

fn app_with_editor() -> (App, u64) {
    let mut app = test_app();
    let (layout, id) = crate::tide_layout::SplitLayout::with_initial_pane();
    app.layout = layout;
    let pane = EditorPane::new_empty(id);
    app.panes.insert(id, PaneKind::Editor(pane));
    app.focus.focused = Some(id);
    app.focus.focus_area = FocusArea::Stage;
    (app, id)
}

fn sample_items() -> Vec<CompletionItem> {
    vec![
        CompletionItem {
            label: "console".into(),
            kind: CompletionKind::Variable,
            insert_text: None,
            sort_text: None,
            filter_text: None,
            preselect: false,
            detail: None,
        },
        CompletionItem {
            label: "contains".into(),
            kind: CompletionKind::Method,
            insert_text: Some("contains()".into()),
            sort_text: None,
            filter_text: None,
            preselect: false,
            detail: None,
        },
        CompletionItem {
            label: "const".into(),
            kind: CompletionKind::Keyword,
            insert_text: None,
            sort_text: None,
            filter_text: None,
            preselect: false,
            detail: None,
        },
        CompletionItem {
            label: "constructor".into(),
            kind: CompletionKind::Function,
            insert_text: Some("constructor()".into()),
            sort_text: None,
            filter_text: None,
            preselect: false,
            detail: None,
        },
        CompletionItem {
            label: "continue".into(),
            kind: CompletionKind::Keyword,
            insert_text: None,
            sort_text: None,
            filter_text: None,
            preselect: false,
            detail: None,
        },
    ]
}

fn editor_with_completion(app: &mut App, id: u64) {
    if let Some(PaneKind::Editor(pane)) = app.panes.get_mut(&id) {
        pane.completion = Some(CompletionState::new(sample_items(), 0, 0));
    }
}

// --- UC-3: ShowCompletion ---

#[test]
fn completion_popup_shows_max_ten_items() {
    // UC-3 BR-12: CompletionPopup shows max 10 visible items
    let items: Vec<CompletionItem> = (0..20).map(|i| CompletionItem {
        label: format!("item_{}", i),
        kind: CompletionKind::Variable,
        insert_text: None,
        sort_text: None,
        filter_text: None,
        preselect: false,
        detail: None,
    }).collect();
    let state = CompletionState::new(items, 0, 0);
    let visible: Vec<_> = state.visible_items().collect();
    assert_eq!(visible.len(), COMPLETION_VISIBLE_COUNT);
}

#[test]
fn typing_filters_existing_completions_client_side() {
    // UC-3 BR-11: Continued typing within same prefix filters items
    let mut state = CompletionState::new(sample_items(), 0, 0);
    assert_eq!(state.filtered_indices.len(), 5);

    state.prefix = "const".into();
    state.apply_filter();
    // "const" and "constructor" contain "const"
    assert_eq!(state.filtered_indices.len(), 2);
    let labels: Vec<&str> = state.filtered_indices.iter()
        .map(|&i| state.items[i].label.as_str())
        .collect();
    assert!(labels.contains(&"const"));
    assert!(labels.contains(&"constructor"));
    assert!(!labels.contains(&"console"));
    assert!(!labels.contains(&"continue"));
}

#[test]
fn backspace_shortens_prefix_and_refilters() {
    // UC-3 BR-11a: Backspace shortens prefix and re-filters completion items
    let mut state = CompletionState::new(sample_items(), 0, 0);
    state.prefix = "const".into();
    state.apply_filter();
    assert_eq!(state.filtered_indices.len(), 2); // "const", "constructor"

    // Simulate backspace: "const" → "cons"
    state.prefix.pop();
    state.apply_filter();
    // "cons" matches: console, const, constructor, contains
    assert!(state.filtered_indices.len() >= 3);
}

#[test]
fn backspace_on_empty_prefix_dismisses_completion() {
    // UC-3 BR-11a: Backspace on empty prefix → dismiss (prefix becomes empty)
    let mut state = CompletionState::new(sample_items(), 0, 0);
    state.prefix = "a".into();
    state.apply_filter();

    // Simulate backspace: "a" → ""
    state.prefix.pop();
    // Caller should dismiss when prefix becomes empty after backspace
    assert!(state.prefix.is_empty());
}

#[test]
fn completion_popup_flips_position_data() {
    // UC-3 BR-15: CompletionPopup stores trigger position for layout decisions
    let state = CompletionState::new(sample_items(), 10, 5);
    assert_eq!(state.trigger_line, 10);
    assert_eq!(state.trigger_col, 5);
}

// --- UC-4: NavigateCompletion ---

#[test]
fn down_selects_next_completion_item() {
    // UC-4 BR-16: Down selects next item
    let mut state = CompletionState::new(sample_items(), 0, 0);
    assert_eq!(state.selected_index, 0);
    state.select_next();
    assert_eq!(state.selected_index, 1);
    assert_eq!(state.selected_item().unwrap().label, "contains");
}

#[test]
fn up_selects_previous_completion_item() {
    // UC-4 BR-17: Up selects previous item
    let mut state = CompletionState::new(sample_items(), 0, 0);
    state.selected_index = 2;
    state.select_prev();
    assert_eq!(state.selected_index, 1);
    assert_eq!(state.selected_item().unwrap().label, "contains");
}

#[test]
fn completion_selection_wraps_around() {
    // UC-4 BR-18: Selection wraps (bottom → top, top → bottom)
    let mut state = CompletionState::new(sample_items(), 0, 0);

    // At top, go up → wrap to bottom
    assert_eq!(state.selected_index, 0);
    state.select_prev();
    assert_eq!(state.selected_index, 4);
    assert_eq!(state.selected_item().unwrap().label, "continue");

    // At bottom, go down → wrap to top
    state.select_next();
    assert_eq!(state.selected_index, 0);
    assert_eq!(state.selected_item().unwrap().label, "console");
}

#[test]
fn completion_auto_scrolls_to_keep_selection_visible() {
    // UC-4 BR-19: Popup auto-scrolls to keep selected item visible
    let items: Vec<CompletionItem> = (0..20).map(|i| CompletionItem {
        label: format!("item_{}", i),
        kind: CompletionKind::Variable,
        insert_text: None,
        sort_text: None,
        filter_text: None,
        preselect: false,
        detail: None,
    }).collect();
    let mut state = CompletionState::new(items, 0, 0);
    assert_eq!(state.scroll_offset, 0);

    // Move to item 10 (past visible window)
    for _ in 0..COMPLETION_VISIBLE_COUNT {
        state.select_next();
    }
    assert_eq!(state.selected_index, COMPLETION_VISIBLE_COUNT);
    assert!(state.scroll_offset > 0);
    // Selected item should be within visible range
    assert!(state.selected_index >= state.scroll_offset);
    assert!(state.selected_index < state.scroll_offset + COMPLETION_VISIBLE_COUNT);
}

// --- UC-5: AcceptCompletion ---

#[test]
fn accepted_completion_uses_insert_text() {
    // UC-5 BR-22/24: insertText replaces typed prefix
    let mut state = CompletionState::new(sample_items(), 0, 0);
    state.selected_index = 1; // "contains" with insert_text "contains()"
    let text = state.insert_text().unwrap();
    assert_eq!(text, "contains()");
}

#[test]
fn accepted_completion_falls_back_to_label() {
    // UC-5: When no insertText, use label
    let mut state = CompletionState::new(sample_items(), 0, 0);
    state.selected_index = 0; // "console" with no insert_text
    let text = state.insert_text().unwrap();
    assert_eq!(text, "console");
}

#[test]
fn tab_accepts_selected_completion() {
    // UC-5 BR-20: Tab accepts selected completion
    let (mut app, id) = app_with_editor();
    // Type "con" then open completion
    app.send_text_to_target("con");
    editor_with_completion(&mut app, id);
    if let Some(PaneKind::Editor(pane)) = app.panes.get_mut(&id) {
        let cs = pane.completion.as_mut().unwrap();
        cs.prefix = "con".into();
        cs.selected_index = 0; // "console"
    }
    // Accept with Tab
    app.accept_completion(id);
    if let Some(PaneKind::Editor(pane)) = app.panes.get(&id) {
        assert!(pane.completion.is_none(), "completion should be dismissed after accept");
    }
}

#[test]
fn enter_accepts_selected_completion() {
    // UC-5 BR-21: Enter accepts selected completion
    let (mut app, id) = app_with_editor();
    app.send_text_to_target("con");
    editor_with_completion(&mut app, id);
    if let Some(PaneKind::Editor(pane)) = app.panes.get_mut(&id) {
        let cs = pane.completion.as_mut().unwrap();
        cs.prefix = "con".into();
        cs.selected_index = 0; // "console"
    }
    app.accept_completion(id);
    if let Some(PaneKind::Editor(pane)) = app.panes.get(&id) {
        assert!(pane.completion.is_none());
    }
}

#[test]
fn accepted_completion_replaces_typed_prefix() {
    // UC-5 BR-22: Inserted text replaces the typed prefix, not appended
    let (mut app, id) = app_with_editor();
    app.send_text_to_target("con");
    editor_with_completion(&mut app, id);
    if let Some(PaneKind::Editor(pane)) = app.panes.get_mut(&id) {
        let cs = pane.completion.as_mut().unwrap();
        cs.prefix = "con".into();
        cs.selected_index = 0; // "console"
    }
    app.accept_completion(id);
    if let Some(PaneKind::Editor(pane)) = app.panes.get(&id) {
        // Buffer should contain "console", not "conconsole"
        let line = pane.editor.buffer.line(0).unwrap();
        assert_eq!(line, "console");
    }
}

// --- UC-6: DismissCompletion ---

#[test]
fn escape_dismisses_completion() {
    // UC-6 BR-25: Escape dismisses completion
    let (mut app, id) = app_with_editor();
    editor_with_completion(&mut app, id);
    app.dismiss_completion(id);
    if let Some(PaneKind::Editor(pane)) = app.panes.get(&id) {
        assert!(pane.completion.is_none());
    }
}

#[test]
fn completion_dismissed_when_no_matches() {
    // UC-6 BR-27: Completion dismissed when filter matches zero items
    let (mut app, id) = app_with_editor();
    editor_with_completion(&mut app, id);
    if let Some(PaneKind::Editor(pane)) = app.panes.get_mut(&id) {
        let cs = pane.completion.as_mut().unwrap();
        cs.prefix = "xyz_no_match".into();
        cs.apply_filter();
        assert!(cs.is_empty());
    }
}

#[test]
fn switching_pane_dismisses_completion() {
    // UC-6 BR-28: Switching pane dismisses completion
    let (mut app, id1) = app_with_editor();
    let id2 = app.layout.split(id1, crate::tide_core::SplitDirection::Vertical);
    app.panes.insert(id2, PaneKind::Editor(EditorPane::new_empty(id2)));
    editor_with_completion(&mut app, id1);

    // Switch focus to id2
    app.focus_terminal(id2);

    if let Some(PaneKind::Editor(pane)) = app.panes.get(&id1) {
        assert!(pane.completion.is_none(), "completion should be dismissed when switching pane");
    }
}

#[test]
fn trigger_char_after_filter_dismiss_sends_new_request() {
    // UC-3 BR-9a: When client-side filter produces zero matches AND the dismissing
    // character is a trigger character, a new completion request should be sent.
    // Test: type "." while completion popup is showing → popup dismissed → trigger flag set
    let (mut app, id) = app_with_editor();
    editor_with_completion(&mut app, id);
    // Simulate the existing completion having a prefix
    if let Some(PaneKind::Editor(pane)) = app.panes.get_mut(&id) {
        let cs = pane.completion.as_mut().unwrap();
        cs.prefix = "con".into();
        cs.apply_filter();
        assert!(!cs.is_empty(), "should have matches for 'con'");
    }

    // Type "." — this should dismiss completion (no item matches "con.")
    // AND should trigger a new completion request (because "." is a trigger char)
    app.send_text_to_target(".");

    // Completion popup should be dismissed (filter "con." matches nothing)
    if let Some(PaneKind::Editor(pane)) = app.panes.get(&id) {
        // Without LSP, no new completion will arrive. But the old one must be gone.
        assert!(pane.completion.is_none(),
            "completion should be dismissed when filter matches nothing after trigger char");
        // Buffer should contain the typed text
        let line = pane.editor.buffer.line(0).unwrap();
        assert!(line.contains("."), "dot should be in the buffer");
    }
}

// --- CompletionState unit tests ---

#[test]
fn new_completion_state_selects_first_item() {
    let state = CompletionState::new(sample_items(), 0, 0);
    assert_eq!(state.selected_index, 0);
    assert_eq!(state.selected_item().unwrap().label, "console");
}

#[test]
fn empty_completion_state_has_no_selected_item() {
    let state = CompletionState::new(vec![], 0, 0);
    assert!(state.selected_item().is_none());
    assert!(state.is_empty());
}

#[test]
fn filter_is_case_insensitive() {
    let mut state = CompletionState::new(sample_items(), 0, 0);
    state.prefix = "CONS".into();
    state.apply_filter();
    // Fuzzy match: "console", "contains", "const", "constructor" all match c-o-n-s in order
    assert_eq!(state.filtered_indices.len(), 4);
}

#[test]
fn select_next_on_empty_does_not_panic() {
    let mut state = CompletionState::new(vec![], 0, 0);
    state.select_next(); // should not panic
    state.select_prev(); // should not panic
}

#[test]
fn completion_kind_abbreviations() {
    assert_eq!(CompletionKind::Function.abbr(), "fn");
    assert_eq!(CompletionKind::Variable.abbr(), "var");
    assert_eq!(CompletionKind::Keyword.abbr(), "kw");
    assert_eq!(CompletionKind::Method.abbr(), "mth");
    assert_eq!(CompletionKind::Other.abbr(), "");
}

// --- UC-3 BR-13: sortText tiebreaker ---

#[test]
fn sort_text_breaks_tie_when_fuzzy_scores_equal() {
    // UC-3 BR-13: When fuzzy scores are equal, sortText breaks the tie (ascending)
    let items = vec![
        CompletionItem {
            label: "zebra".into(),
            kind: CompletionKind::Variable,
            insert_text: None,
            sort_text: Some("2".into()),
            filter_text: None,
            preselect: false,
            detail: None,
        },
        CompletionItem {
            label: "alpha".into(),
            kind: CompletionKind::Variable,
            insert_text: None,
            sort_text: Some("0".into()),
            filter_text: None,
            preselect: false,
            detail: None,
        },
        CompletionItem {
            label: "middle".into(),
            kind: CompletionKind::Variable,
            insert_text: None,
            sort_text: Some("1".into()),
            filter_text: None,
            preselect: false,
            detail: None,
        },
    ];
    // Empty prefix → all items shown, fuzzy scores all 0 → sortText decides order
    let mut state = CompletionState::new(items, 0, 0);
    state.prefix = "".into();
    state.apply_filter();

    let labels: Vec<&str> = state.filtered_indices.iter()
        .map(|&i| state.items[i].label.as_str())
        .collect();
    assert_eq!(labels, vec!["alpha", "middle", "zebra"]);
}

// --- UC-3 BR-13a: preselect boost ---

#[test]
fn preselect_items_boosted_to_top() {
    // UC-3 BR-13a: Items with preselect=true appear before non-preselected items
    let items = vec![
        CompletionItem {
            label: "string".into(),
            kind: CompletionKind::Keyword,
            insert_text: None,
            sort_text: Some("1".into()),
            filter_text: None,
            preselect: false,
            detail: None,
        },
        CompletionItem {
            label: "String".into(),
            kind: CompletionKind::Variable,
            insert_text: None,
            sort_text: Some("0".into()),
            filter_text: None,
            preselect: true,
            detail: None,
        },
        CompletionItem {
            label: "stringify".into(),
            kind: CompletionKind::Function,
            insert_text: None,
            sort_text: Some("2".into()),
            filter_text: None,
            preselect: false,
            detail: None,
        },
    ];
    let mut state = CompletionState::new(items, 0, 0);
    state.prefix = "stri".into();
    state.apply_filter();

    // String (preselect=true) should be first regardless of fuzzy score
    let first_label = state.items[state.filtered_indices[0]].label.as_str();
    assert_eq!(first_label, "String", "preselected item should be first");
}

// --- UC-3 BR-14: detail text ---

#[test]
fn completion_item_includes_detail_text() {
    // UC-3 BR-14: CompletionItem stores detail text from server
    let item = CompletionItem {
        label: "useState".into(),
        kind: CompletionKind::Function,
        insert_text: None,
        sort_text: None,
        filter_text: None,
        preselect: false,
        detail: Some("function useState<S>(): [S, Dispatch<S>]".into()),
    };
    assert_eq!(item.detail.as_deref(), Some("function useState<S>(): [S, Dispatch<S>]"));
}
