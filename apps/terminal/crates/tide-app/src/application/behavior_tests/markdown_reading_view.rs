// Spec: docs/specs/markdown-reading-edit-modes.md (UC-3: ReadingViewVisualTreatment)
use crate::tide_editor::markdown::{render_markdown_preview, MarkdownTheme, PreviewLine};

fn render(src: &str) -> Vec<PreviewLine> {
    let lines: Vec<String> = src.lines().map(|s| s.to_string()).collect();
    render_markdown_preview(&lines, &MarkdownTheme::dark(), 80)
}

fn line_text(pl: &PreviewLine) -> String {
    pl.spans.iter().map(|s| s.text.as_str()).collect()
}

fn is_blank(pl: &PreviewLine) -> bool {
    pl.bg_color.is_none() && pl.spans.iter().all(|s| s.text.trim().is_empty())
}

// --- UC-3: ReadingViewVisualTreatment ---

#[test]
fn reading_view_h1_and_h2_get_underline_rules() {
    // UC-3 BR-8: h1 → ═ rule, h2 → ─ rule, spanning the heading width.
    let out = render("# Title One\n\n## Title Two\n");
    let texts: Vec<String> = out.iter().map(line_text).collect();
    assert!(
        texts.iter().any(|t| t.contains('═')),
        "h1 should be followed by a ═ underline rule"
    );
    assert!(
        texts.iter().any(|t| t.contains('─')),
        "h2 should be followed by a ─ underline rule"
    );
    // h3 gets no rule.
    let h3 = render("### Small\n");
    assert!(
        !h3.iter().map(line_text).any(|t| t.contains('═') || t.contains('─')),
        "h3 should not get an underline rule"
    );
}

#[test]
fn reading_view_collapses_consecutive_blank_lines() {
    // UC-3 BR-9 / INV-3: block spacing is one row, never doubled.
    let out = render("# H\n\nPara one.\n\n## H2\n\nPara two.\n");
    let mut prev_blank = false;
    for pl in &out {
        let blank = is_blank(pl);
        assert!(
            !(blank && prev_blank),
            "no two consecutive blank PreviewLines"
        );
        prev_blank = blank;
    }
}

#[test]
fn reading_view_code_block_tags_language_on_frame() {
    // UC-3 BR-10: lang tag rides the top frame line (no separate extra row).
    let out = render("```bash\ncd x\n```\n");
    let bg_lines: Vec<&PreviewLine> = out.iter().filter(|pl| pl.bg_color.is_some()).collect();
    // top frame (with lang tag) + one code line + bottom frame = 3 backgrounded rows
    assert_eq!(
        bg_lines.len(),
        3,
        "code block frames in 3 background rows (lang tag merged onto the top frame)"
    );
    assert!(
        line_text(bg_lines[0]).contains("bash"),
        "language tag renders on the top frame line"
    );
}
