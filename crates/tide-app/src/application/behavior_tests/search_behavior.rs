// Spec: docs/specs/search.md
use crate::state::search::SearchState;
use unicode_width::UnicodeWidthStr;

// --- UC-1: ExecuteSearch ---

#[test]
fn new_search_state_has_empty_input() {
    // UC-1 BR-1: New SearchState has empty input and no matches
    let state = SearchState::new();
    assert!(state.input.text.is_empty());
    assert_eq!(state.matches.len(), 0);
    assert!(state.current.is_none());
}

#[test]
fn search_in_editor_finds_all_occurrences() {
    // UC-1 BR-2: Search finds all occurrences across lines
    let mut state = SearchState::new();
    state.input = crate::state::InputLine::with_text("foo".to_string());
    let lines = vec![
        "this is foo bar".to_string(),
        "no match here".to_string(),
        "foo again".to_string(),
    ];
    crate::state::search::execute_search_editor(&mut state, &lines);
    assert_eq!(state.matches.len(), 2);
    assert_eq!(state.matches[0].line, 0);
    assert_eq!(state.matches[1].line, 2);
}

#[test]
fn empty_search_query_clears_matches() {
    // UC-1 BR-3: Empty search query clears all matches
    let mut state = SearchState::new();
    state.matches = vec![crate::state::search::SearchMatch {
        line: 0,
        col: 0,
        len: 3,
    }];
    state.current = Some(0);
    let lines = vec!["content".to_string()];
    crate::state::search::execute_search_editor(&mut state, &lines);
    assert!(state.matches.is_empty());
    assert!(state.current.is_none());
}

// --- UC-2: NavigateMatches ---

#[test]
fn search_display_shows_zero_of_zero_when_empty() {
    // UC-2 BR-4: Display shows "0/0" when no matches
    let state = SearchState::new();
    assert_eq!(state.current_display(), "0/0");
}

#[test]
fn next_match_wraps_around_from_last_to_first() {
    // UC-2 BR-5: next_match wraps from last to first
    let mut state = SearchState::new();
    state.matches = vec![
        crate::state::search::SearchMatch {
            line: 0,
            col: 0,
            len: 3,
        },
        crate::state::search::SearchMatch {
            line: 1,
            col: 0,
            len: 3,
        },
    ];
    state.current = Some(1);
    state.next_match();
    assert_eq!(state.current, Some(0));
}

#[test]
fn prev_match_wraps_around_from_first_to_last() {
    // UC-2 BR-6: prev_match wraps from first to last
    let mut state = SearchState::new();
    state.matches = vec![
        crate::state::search::SearchMatch {
            line: 0,
            col: 0,
            len: 3,
        },
        crate::state::search::SearchMatch {
            line: 1,
            col: 0,
            len: 3,
        },
    ];
    state.current = Some(0);
    state.prev_match();
    assert_eq!(state.current, Some(1));
}

// --- UC-3: RenderSearchBarText ---

#[test]
fn search_bar_long_hangul_input_keeps_text_and_caret_aligned() {
    // UC-3 BR-7: Long Korean query text keeps the rendered Search Bar text and caret visually contiguous
    let query = "한글입력이길어질때abc";
    let expected_cells = UnicodeWidthStr::width(query);
    let rendered_cells =
        crate::adapter::outward::view::overlays::search_bar_text_advance_cells(query);

    assert_eq!(rendered_cells, expected_cells);
}

#[test]
fn search_bar_inline_preedit_uses_same_visual_width_as_committed_text() {
    // UC-3 BR-8: Search Bar committed text and IME preedit use the same visual-width rules
    let query = "한글ab";
    let cursor = query.len();
    let preedit = "테스트";
    let expected_cells = UnicodeWidthStr::width(query) + UnicodeWidthStr::width(preedit);
    let caret_cells =
        crate::adapter::outward::view::overlays::search_bar_cursor_advance_cells(
            query, cursor, preedit,
        );

    assert_eq!(caret_cells, expected_cells);
}
