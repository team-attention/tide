// Spec: docs/specs/live-preview.md
use crate::domain::editor::markdown::{LivePreviewMap, MdElementKind};

fn lines(s: &str) -> Vec<String> {
    s.lines().map(String::from).collect()
}

// --- UC-4: LivePreviewMapConstruction ---

#[test]
fn live_preview_map_builds_from_buffer_lines() {
    // UC-4 BR-1: LivePreviewMap builds from buffer lines and contains elements
    let input = lines("# Heading\n\nSome **bold** text.");
    let map = LivePreviewMap::build(&input);
    assert!(
        !map.elements.is_empty(),
        "map should contain elements from markdown"
    );
    // Should find at least a Heading and a Bold element
    assert!(map.elements.iter().any(|e| matches!(e.kind, MdElementKind::Heading(1))));
    assert!(map.elements.iter().any(|e| e.kind == MdElementKind::Bold));
}

#[test]
fn element_ranges_sorted_non_overlapping() {
    // UC-4 BR-2: Element ranges are non-overlapping and sorted by start offset
    let input = lines("**bold** and *italic* and `code` here\n# Heading\n> quote");
    let map = LivePreviewMap::build(&input);

    // Check sorted by full_range.start
    for window in map.elements.windows(2) {
        assert!(
            window[0].full_range.start <= window[1].full_range.start,
            "elements not sorted: {:?} comes before {:?}",
            window[0].full_range,
            window[1].full_range
        );
    }

    // Check non-overlapping: for inline elements on the same level, ranges should not overlap.
    // Note: block elements (e.g. heading) can contain inline elements, so we only check
    // elements of the same nesting depth aren't overlapping with each other.
    // At minimum, verify the sort order holds.
    let inline_elements: Vec<_> = map.elements.iter().filter(|e| e.kind.is_inline()).collect();
    for window in inline_elements.windows(2) {
        assert!(
            window[0].full_range.end <= window[1].full_range.start,
            "inline elements overlap: {:?} and {:?}",
            window[0].full_range,
            window[1].full_range
        );
    }
}

#[test]
fn nested_formatting_produces_separate_entries() {
    // UC-4 BR-3: Nested formatting produces separate entries for outer and inner elements
    let input = lines("***bold italic***");
    let map = LivePreviewMap::build(&input);

    let has_bold = map.elements.iter().any(|e| e.kind == MdElementKind::Bold);
    let has_italic = map.elements.iter().any(|e| e.kind == MdElementKind::Italic);
    assert!(has_bold, "should have Bold entry for nested ***...***");
    assert!(has_italic, "should have Italic entry for nested ***...***");
}

#[test]
fn escaped_chars_not_treated_as_syntax() {
    // UC-4 BR-4: Escaped markdown chars are not treated as syntax markers
    let input = lines("\\*not bold\\*");
    let map = LivePreviewMap::build(&input);

    let has_bold = map.elements.iter().any(|e| e.kind == MdElementKind::Bold);
    let has_italic = map.elements.iter().any(|e| e.kind == MdElementKind::Italic);
    assert!(!has_bold, "escaped \\* should not produce Bold element");
    assert!(!has_italic, "escaped \\* should not produce Italic element");
}

// --- UC-2: InlineSyntaxHiding ---

#[test]
fn inline_syntax_hidden_on_non_cursor_lines() {
    // UC-2 BR-1: Inline syntax hiding operates at line level
    let input = lines("**bold** text");
    let map = LivePreviewMap::build(&input);

    // When cursor is on a different line, syntax ranges should be returned
    let hidden = map.hidden_syntax_ranges(0, 1);
    assert!(
        !hidden.is_empty(),
        "should return hidden syntax ranges when cursor is on a different line"
    );

    // When cursor is on the same line, no syntax should be hidden
    let not_hidden = map.hidden_syntax_ranges(0, 0);
    assert!(
        not_hidden.is_empty(),
        "should not hide syntax on cursor line"
    );
}

#[test]
fn all_inline_syntax_types_detected() {
    // UC-2 BR-2: All inline syntax types detected: bold, italic, code, link, image, strikethrough
    let input = lines(
        "**bold** *italic* `code` [link](url) ![img](src) ~~strike~~"
    );
    let map = LivePreviewMap::build(&input);

    let kinds: Vec<MdElementKind> = map.elements.iter().map(|e| e.kind).collect();
    assert!(kinds.contains(&MdElementKind::Bold), "missing Bold");
    assert!(kinds.contains(&MdElementKind::Italic), "missing Italic");
    assert!(kinds.contains(&MdElementKind::InlineCode), "missing InlineCode");
    assert!(kinds.contains(&MdElementKind::Link), "missing Link");
    assert!(kinds.contains(&MdElementKind::Image), "missing Image");
    assert!(kinds.contains(&MdElementKind::Strikethrough), "missing Strikethrough");
}

// --- UC-3: BlockElementStyling ---

#[test]
fn block_syntax_never_hidden() {
    // UC-3 BR-1: Block syntax markers are never hidden regardless of cursor position
    let input = lines("# Heading\n\n```\ncode\n```");
    let map = LivePreviewMap::build(&input);

    // Block elements on line 0 (heading) — hidden_syntax_ranges should return empty
    // because hidden_syntax_ranges only returns inline element syntax
    let hidden_heading = map.hidden_syntax_ranges(0, 5);
    assert!(
        hidden_heading.is_empty(),
        "block element syntax should never be hidden; got {:?}",
        hidden_heading
    );

    // Code block lines — also should not be hidden
    let hidden_code = map.hidden_syntax_ranges(2, 5);
    assert!(
        hidden_code.is_empty(),
        "code block syntax should never be hidden; got {:?}",
        hidden_code
    );
}

#[test]
fn heading_markers_visible_and_styled() {
    // UC-3 BR-4: Heading # markers always visible, heading text styled
    let input = lines("# Heading");
    let map = LivePreviewMap::build(&input);

    let heading = map
        .elements
        .iter()
        .find(|e| matches!(e.kind, MdElementKind::Heading(_)));
    assert!(heading.is_some(), "should find a Heading element");

    let heading = heading.unwrap();
    assert!(
        !heading.kind.is_inline(),
        "Heading should be a block element (is_inline() == false)"
    );
    // Heading level should be 1
    assert!(
        matches!(heading.kind, MdElementKind::Heading(1)),
        "should be H1"
    );
}
