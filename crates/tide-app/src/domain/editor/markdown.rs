// Markdown-to-styled-lines renderer for preview mode.

use unicode_width::{UnicodeWidthChar, UnicodeWidthStr};

use pulldown_cmark::Alignment;
use crate::tide_core::{Color, TextStyle};

use super::highlight::StyledSpan;

/// Color palette for markdown preview rendering.
pub struct MarkdownTheme {
    pub body: Color,
    pub h1: Color,
    pub h2: Color,
    pub h3: Color,
    pub h4: Color,
    pub bold: Color,
    pub italic: Color,
    pub code_fg: Color,
    pub code_bg: Color,
    pub code_block_bg: Color,
    pub link: Color,
    pub blockquote: Color,
    pub rule: Color,
    pub list_marker: Color,
}

impl MarkdownTheme {
    pub fn dark() -> Self {
        Self {
            body: Color::new(0.85, 0.85, 0.85, 1.0),
            h1: Color::new(0.55, 0.75, 1.0, 1.0),
            h2: Color::new(0.55, 0.85, 0.65, 1.0),
            h3: Color::new(0.95, 0.75, 0.45, 1.0),
            h4: Color::new(0.80, 0.65, 0.90, 1.0),
            bold: Color::new(0.95, 0.95, 0.95, 1.0),
            italic: Color::new(0.78, 0.78, 0.78, 1.0),
            code_fg: Color::new(0.90, 0.70, 0.50, 1.0),
            code_bg: Color::new(1.0, 1.0, 1.0, 0.06),
            code_block_bg: Color::new(1.0, 1.0, 1.0, 0.04),
            link: Color::new(0.45, 0.65, 1.0, 1.0),
            blockquote: Color::new(0.55, 0.55, 0.55, 1.0),
            rule: Color::new(0.35, 0.35, 0.35, 1.0),
            list_marker: Color::new(0.55, 0.75, 1.0, 1.0),
        }
    }

    pub fn light() -> Self {
        Self {
            body: Color::new(0.15, 0.15, 0.15, 1.0),
            h1: Color::new(0.10, 0.35, 0.70, 1.0),
            h2: Color::new(0.10, 0.50, 0.25, 1.0),
            h3: Color::new(0.60, 0.40, 0.10, 1.0),
            h4: Color::new(0.45, 0.25, 0.60, 1.0),
            bold: Color::new(0.05, 0.05, 0.05, 1.0),
            italic: Color::new(0.25, 0.25, 0.25, 1.0),
            code_fg: Color::new(0.60, 0.30, 0.10, 1.0),
            code_bg: Color::new(0.0, 0.0, 0.0, 0.06),
            code_block_bg: Color::new(0.0, 0.0, 0.0, 0.04),
            link: Color::new(0.15, 0.35, 0.80, 1.0),
            blockquote: Color::new(0.45, 0.45, 0.45, 1.0),
            rule: Color::new(0.70, 0.70, 0.70, 1.0),
            list_marker: Color::new(0.10, 0.35, 0.70, 1.0),
        }
    }
}

/// A single preview line with styled spans and optional full-row background.
pub struct PreviewLine {
    pub spans: Vec<StyledSpan>,
    pub bg_color: Option<Color>,
}

/// Wrap text into lines that fit within `max_width` display columns.
fn wrap_cell_text(text: &str, max_width: usize) -> Vec<String> {
    use unicode_width::UnicodeWidthChar;
    if max_width == 0 {
        return vec![String::new()];
    }
    let mut lines = Vec::new();
    let mut current = String::new();
    let mut current_width = 0usize;
    for ch in text.chars() {
        let cw = ch.width().unwrap_or(1);
        if current_width + cw > max_width && current_width > 0 {
            lines.push(current);
            current = String::new();
            current_width = 0;
        }
        current.push(ch);
        current_width += cw;
    }
    lines.push(current);
    if lines.is_empty() {
        lines.push(String::new());
    }
    lines
}

/// Render a collected table into preview lines.
fn render_table(
    rows: &[Vec<String>],
    _alignments: &[Alignment],
    header_count: usize,
    theme: &MarkdownTheme,
    indent: usize,
    effective_width: usize,
    result: &mut Vec<PreviewLine>,
) {
    if rows.is_empty() {
        return;
    }
    let num_cols = rows.iter().map(|r| r.len()).max().unwrap_or(0);
    if num_cols == 0 {
        return;
    }

    // Calculate column widths (minimum 3 for readability)
    let mut col_widths: Vec<usize> = vec![3; num_cols];
    for row in rows {
        for (i, cell) in row.iter().enumerate() {
            if i < num_cols {
                col_widths[i] = col_widths[i].max(cell.width());
            }
        }
    }

    // Clamp total width to effective_width
    let border_overhead = num_cols + 1; // one │ per column + closing │
    let padding_overhead = num_cols * 2; // 1 space on each side of each cell
    let total_content_width: usize = col_widths.iter().sum();
    let total_width = total_content_width + border_overhead + padding_overhead;
    if total_width > effective_width && total_content_width > 0 {
        let available = effective_width.saturating_sub(border_overhead + padding_overhead);
        let scale = available as f64 / total_content_width as f64;
        for w in &mut col_widths {
            *w = ((*w as f64 * scale).floor() as usize).max(1);
        }
    }

    let border_style = TextStyle {
        foreground: theme.blockquote,
        background: None,
        bold: false, dim: false, italic: false, underline: false,
    };
    let header_style = TextStyle {
        foreground: theme.bold,
        background: None,
        bold: true, dim: false, italic: false, underline: false,
    };
    let cell_style = TextStyle {
        foreground: theme.body,
        background: None,
        bold: false, dim: false, italic: false, underline: false,
    };
    let indent_style = TextStyle {
        foreground: theme.body,
        background: None,
        bold: false, dim: false, italic: false, underline: false,
    };

    // Helper: build a horizontal rule line
    let make_rule = |left: &str, mid: &str, right: &str, fill: &str| -> PreviewLine {
        let mut text = String::new();
        text.push_str(left);
        for (i, w) in col_widths.iter().enumerate() {
            text.push_str(&fill.repeat(*w + 2)); // +2 for padding
            if i + 1 < num_cols {
                text.push_str(mid);
            }
        }
        text.push_str(right);
        PreviewLine {
            spans: vec![
                StyledSpan { text: " ".repeat(indent), style: indent_style },
                StyledSpan { text, style: border_style },
            ],
            bg_color: None,
        }
    };

    // Helper: build one visual line of a (possibly multi-line) row
    let make_visual_line = |wrapped_cells: &[Vec<String>], line_idx: usize, is_header: bool| -> PreviewLine {
        let style = if is_header { header_style } else { cell_style };
        let mut spans = vec![
            StyledSpan { text: " ".repeat(indent), style: indent_style },
            StyledSpan { text: "\u{2502}".to_string(), style: border_style },
        ];
        for (i, w) in col_widths.iter().enumerate() {
            let line_text = wrapped_cells.get(i)
                .and_then(|lines| lines.get(line_idx))
                .map(|s| s.as_str())
                .unwrap_or("");
            let line_w = line_text.width();
            let pad_right = w.saturating_sub(line_w);
            let padded = format!(" {}{} ", line_text, " ".repeat(pad_right));
            spans.push(StyledSpan { text: padded, style });
            spans.push(StyledSpan { text: "\u{2502}".to_string(), style: border_style });
        }
        PreviewLine { spans, bg_color: None }
    };

    // Top border ┌───┬───┐
    result.push(make_rule("\u{250C}", "\u{252C}", "\u{2510}", "\u{2500}"));

    for (ri, row) in rows.iter().enumerate() {
        // Row separator ├───┼───┤ (between every row, including between data rows)
        if ri > 0 {
            result.push(make_rule("\u{251C}", "\u{253C}", "\u{2524}", "\u{2500}"));
        }

        // Wrap each cell to fit its column width
        let wrapped_cells: Vec<Vec<String>> = (0..num_cols).map(|i| {
            let cell_text = row.get(i).map(|s| s.as_str()).unwrap_or("");
            wrap_cell_text(cell_text, col_widths[i])
        }).collect();
        let row_height = wrapped_cells.iter().map(|lines| lines.len()).max().unwrap_or(1);
        let is_header = ri < header_count;

        for line_idx in 0..row_height {
            result.push(make_visual_line(&wrapped_cells, line_idx, is_header));
        }
    }

    // Bottom border └───┴───┘
    result.push(make_rule("\u{2514}", "\u{2534}", "\u{2518}", "\u{2500}"));
}

/// Render markdown content into styled preview lines with word wrapping.
pub fn render_markdown_preview(
    lines: &[String],
    theme: &MarkdownTheme,
    wrap_width: usize,
) -> Vec<PreviewLine> {
    use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd, HeadingLevel, CodeBlockKind};

    let source: String = lines.join("\n");
    let opts = Options::ENABLE_STRIKETHROUGH | Options::ENABLE_TABLES;
    let parser = Parser::new_ext(&source, opts);

    let mut result: Vec<PreviewLine> = Vec::new();

    // Style stack for nested formatting
    let mut bold = false;
    let mut italic = false;
    let mut in_link = false;
    let mut in_code_block = false;
    let mut heading_level: Option<HeadingLevel> = None;
    let mut in_blockquote = false;
    let mut list_depth: usize = 0;
    let mut ordered_counters: Vec<u64> = Vec::new();
    let mut pending_list_marker: Option<String> = None;

    // Table state
    let mut in_table = false;
    let mut table_alignments: Vec<Alignment> = Vec::new();
    let mut table_rows: Vec<Vec<String>> = Vec::new(); // rows of cells
    let mut table_current_row: Vec<String> = Vec::new();
    let mut table_cell_text = String::new();
    let mut in_table_cell = false;
    let mut table_header_rows: usize = 0;

    // Current line accumulator
    let mut current_spans: Vec<StyledSpan> = Vec::new();
    let mut current_col: usize = 0;
    let mut current_bg: Option<Color> = None;

    let indent = 2; // 2-cell left indent for all content
    let effective_width = wrap_width.saturating_sub(indent);

    let flush_line = |spans: &mut Vec<StyledSpan>, bg: &Option<Color>, out: &mut Vec<PreviewLine>, col: &mut usize| {
        // Add leading indent
        let mut line_spans = vec![StyledSpan {
            text: " ".repeat(indent),
            style: TextStyle {
                foreground: theme.body,
                background: None,
                bold: false, dim: false, italic: false, underline: false,
            },
        }];
        line_spans.append(spans);
        out.push(PreviewLine {
            spans: line_spans,
            bg_color: *bg,
        });
        *col = 0;
    };

    let push_empty_line = |out: &mut Vec<PreviewLine>| {
        out.push(PreviewLine {
            spans: vec![],
            bg_color: None,
        });
    };

    let style_for = |theme: &MarkdownTheme, heading: &Option<HeadingLevel>, bold: bool, italic: bool, in_link: bool, in_code_block: bool, in_blockquote: bool| -> TextStyle {
        if in_code_block {
            return TextStyle {
                foreground: theme.code_fg,
                background: None,
                bold: false, dim: false, italic: false, underline: false,
            };
        }
        if in_link {
            return TextStyle {
                foreground: theme.link,
                background: None,
                bold: false, dim: false, italic: false, underline: true,
            };
        }
        if let Some(level) = heading {
            let color = match level {
                HeadingLevel::H1 => theme.h1,
                HeadingLevel::H2 => theme.h2,
                HeadingLevel::H3 => theme.h3,
                _ => theme.h4,
            };
            return TextStyle {
                foreground: color,
                background: None,
                bold: true, dim: false,
                italic: matches!(level, HeadingLevel::H4 | HeadingLevel::H5 | HeadingLevel::H6),
                underline: false,
            };
        }
        if in_blockquote {
            return TextStyle {
                foreground: theme.blockquote,
                background: None,
                bold, dim: false, italic: true, underline: false,
            };
        }
        if bold && italic {
            return TextStyle {
                foreground: theme.bold,
                background: None,
                bold: true, dim: false, italic: true, underline: false,
            };
        }
        if bold {
            return TextStyle {
                foreground: theme.bold,
                background: None,
                bold: true, dim: false, italic: false, underline: false,
            };
        }
        if italic {
            return TextStyle {
                foreground: theme.italic,
                background: None,
                bold: false, dim: false, italic: true, underline: false,
            };
        }
        TextStyle {
            foreground: theme.body,
            background: None,
            bold: false, dim: false, italic: false, underline: false,
        }
    };

    for event in parser {
        // When inside a table, intercept events to collect cell text
        if in_table {
            match event {
                Event::Start(Tag::TableHead) => {}
                Event::End(TagEnd::TableHead) => {
                    // pulldown-cmark 0.12 may not wrap header cells in TableRow,
                    // so flush accumulated cells if they haven't been pushed yet.
                    if !table_current_row.is_empty() {
                        table_rows.push(table_current_row.clone());
                        table_current_row.clear();
                    }
                    table_header_rows = table_rows.len();
                }
                Event::Start(Tag::TableRow) => {
                    table_current_row.clear();
                }
                Event::End(TagEnd::TableRow) => {
                    table_rows.push(table_current_row.clone());
                    table_current_row.clear();
                }
                Event::Start(Tag::TableCell) => {
                    in_table_cell = true;
                    table_cell_text.clear();
                }
                Event::End(TagEnd::TableCell) => {
                    in_table_cell = false;
                    table_current_row.push(table_cell_text.clone());
                    table_cell_text.clear();
                }
                Event::Text(ref text) if in_table_cell => {
                    table_cell_text.push_str(text);
                }
                Event::Code(ref code) if in_table_cell => {
                    table_cell_text.push_str(code);
                }
                Event::End(TagEnd::Table) => {
                    // Render the collected table
                    let header_count = table_header_rows;
                    if !result.is_empty() {
                        push_empty_line(&mut result);
                    }
                    render_table(&table_rows, &table_alignments, header_count, theme, indent, effective_width, &mut result);
                    push_empty_line(&mut result);
                    in_table = false;
                    table_rows.clear();
                    table_alignments.clear();
                    table_current_row.clear();
                    table_header_rows = 0;
                }
                _ => {
                    // Capture any other text-like events inside cells
                    if in_table_cell {
                        if let Event::SoftBreak = event {
                            table_cell_text.push(' ');
                        }
                    }
                }
            }
            continue;
        }

        match event {
            Event::Start(Tag::Table(alignments)) => {
                in_table = true;
                table_alignments = alignments;
                table_rows.clear();
                table_current_row.clear();
                table_header_rows = 0;
            }
            Event::Start(Tag::Heading { level, .. }) => {
                heading_level = Some(level);
                // Add spacing before headings
                if !result.is_empty() {
                    push_empty_line(&mut result);
                }
            }
            Event::End(TagEnd::Heading(_)) => {
                flush_line(&mut current_spans, &current_bg, &mut result, &mut current_col);
                heading_level = None;
            }
            Event::Start(Tag::Paragraph) => {}
            Event::End(TagEnd::Paragraph) => {
                flush_line(&mut current_spans, &current_bg, &mut result, &mut current_col);
                // Don't push blank line inside list items (loose lists wrap content
                // in paragraphs, but the extra spacing looks wrong in a terminal).
                if list_depth == 0 {
                    push_empty_line(&mut result);
                }
            }
            Event::Start(Tag::BlockQuote(_)) => {
                in_blockquote = true;
            }
            Event::End(TagEnd::BlockQuote(_)) => {
                if !current_spans.is_empty() {
                    flush_line(&mut current_spans, &current_bg, &mut result, &mut current_col);
                }
                in_blockquote = false;
                push_empty_line(&mut result);
            }
            Event::Start(Tag::CodeBlock(kind)) => {
                in_code_block = true;
                current_bg = Some(theme.code_block_bg);
                // Spacing before code block
                if !result.is_empty() {
                    push_empty_line(&mut result);
                }
                // Top padding line with bg
                result.push(PreviewLine {
                    spans: vec![StyledSpan {
                        text: " ".repeat(indent),
                        style: TextStyle {
                            foreground: theme.body,
                            background: None,
                            bold: false, dim: false, italic: false, underline: false,
                        },
                    }],
                    bg_color: current_bg,
                });
                // Show language label if available
                if let CodeBlockKind::Fenced(lang) = &kind {
                    let lang_str = lang.as_ref();
                    if !lang_str.is_empty() {
                        current_spans.push(StyledSpan {
                            text: format!(" {}", lang_str),
                            style: TextStyle {
                                foreground: theme.blockquote,
                                background: None,
                                bold: false, dim: true, italic: true, underline: false,
                            },
                        });
                        flush_line(&mut current_spans, &current_bg, &mut result, &mut current_col);
                    }
                }
            }
            Event::End(TagEnd::CodeBlock) => {
                if !current_spans.is_empty() {
                    flush_line(&mut current_spans, &current_bg, &mut result, &mut current_col);
                }
                // Bottom padding line with bg
                result.push(PreviewLine {
                    spans: vec![StyledSpan {
                        text: " ".repeat(indent),
                        style: TextStyle {
                            foreground: theme.body,
                            background: None,
                            bold: false, dim: false, italic: false, underline: false,
                        },
                    }],
                    bg_color: current_bg,
                });
                current_bg = None;
                in_code_block = false;
                push_empty_line(&mut result);
            }
            Event::Start(Tag::List(start)) => {
                list_depth += 1;
                if let Some(n) = start {
                    ordered_counters.push(n);
                } else {
                    ordered_counters.push(0); // 0 = unordered
                }
            }
            Event::End(TagEnd::List(_)) => {
                if !current_spans.is_empty() {
                    flush_line(&mut current_spans, &current_bg, &mut result, &mut current_col);
                }
                list_depth = list_depth.saturating_sub(1);
                ordered_counters.pop();
                if list_depth == 0 {
                    push_empty_line(&mut result);
                }
            }
            Event::Start(Tag::Item) => {
                let list_indent = "  ".repeat(list_depth.saturating_sub(1));
                let marker = if let Some(counter) = ordered_counters.last_mut() {
                    if *counter > 0 {
                        let m = format!("{}{}. ", list_indent, counter);
                        *counter += 1;
                        m
                    } else {
                        format!("{}\u{2022} ", list_indent) // bullet
                    }
                } else {
                    format!("{}\u{2022} ", list_indent)
                };
                pending_list_marker = Some(marker);
            }
            Event::End(TagEnd::Item) => {
                if !current_spans.is_empty() {
                    flush_line(&mut current_spans, &current_bg, &mut result, &mut current_col);
                }
            }
            Event::Start(Tag::Emphasis) => {
                italic = true;
            }
            Event::End(TagEnd::Emphasis) => {
                italic = false;
            }
            Event::Start(Tag::Strong) => {
                bold = true;
            }
            Event::End(TagEnd::Strong) => {
                bold = false;
            }
            Event::Start(Tag::Link { .. }) => {
                in_link = true;
            }
            Event::End(TagEnd::Link) => {
                in_link = false;
            }
            Event::Start(Tag::Strikethrough) => {}
            Event::End(TagEnd::Strikethrough) => {}
            Event::Text(text) => {
                // Emit pending list marker before first text in a list item.
                // Track marker_width so the first word/line stays with the marker.
                let marker_width = if let Some(marker) = pending_list_marker.take() {
                    let mw = marker.width();
                    current_spans.push(StyledSpan {
                        text: marker,
                        style: TextStyle {
                            foreground: theme.list_marker,
                            background: None,
                            bold: false, dim: false, italic: false, underline: false,
                        },
                    });
                    current_col += mw;
                    mw
                } else {
                    0
                };

                let style = style_for(theme, &heading_level, bold, italic, in_link, in_code_block, in_blockquote);

                if in_code_block {
                    // Code blocks: render line by line, no word wrapping.
                    // Each line from split gets its own output line.
                    let code_lines: Vec<&str> = text.split('\n').collect();
                    let last_idx = code_lines.len() - 1;
                    for (li, line) in code_lines.iter().enumerate() {
                        // Flush previous code line if there's content accumulated
                        if current_col > 0 {
                            flush_line(&mut current_spans, &current_bg, &mut result, &mut current_col);
                        }
                        if !line.is_empty() {
                            let padded = format!(" {}", line);
                            current_col += padded.width();
                            current_spans.push(StyledSpan {
                                text: padded,
                                style,
                            });
                        } else if !(li == last_idx && text.ends_with('\n')) {
                            // Empty line in code block — emit blank line with bg
                            result.push(PreviewLine {
                                spans: vec![StyledSpan {
                                    text: " ".repeat(indent),
                                    style: TextStyle {
                                        foreground: theme.body,
                                        background: None,
                                        bold: false, dim: false, italic: false, underline: false,
                                    },
                                }],
                                bg_color: current_bg,
                            });
                        }
                    }
                } else {
                    // Normal text: word wrap at effective_width
                    let blockquote_prefix = if in_blockquote { "\u{2502} " } else { "" };
                    let prefix_len = blockquote_prefix.width();

                    if current_col == 0 && !blockquote_prefix.is_empty() {
                        current_spans.push(StyledSpan {
                            text: blockquote_prefix.to_string(),
                            style: TextStyle {
                                foreground: theme.blockquote,
                                background: None,
                                bold: false, dim: false, italic: false, underline: false,
                            },
                        });
                        current_col += prefix_len;
                    }

                    // Don't wrap the first word away from a list marker that was just placed
                    let mut wrap_min = prefix_len + marker_width;

                    for word in text.split_inclusive(char::is_whitespace) {
                        let word_len = word.width();
                        // If word fits after wrapping to a new line, do a simple word wrap
                        if current_col + word_len > effective_width && current_col > wrap_min && word_len <= effective_width {
                            flush_line(&mut current_spans, &current_bg, &mut result, &mut current_col);
                            if !blockquote_prefix.is_empty() {
                                current_spans.push(StyledSpan {
                                    text: blockquote_prefix.to_string(),
                                    style: TextStyle {
                                        foreground: theme.blockquote,
                                        background: None,
                                        bold: false, dim: false, italic: false, underline: false,
                                    },
                                });
                                current_col += prefix_len;
                            }
                            current_spans.push(StyledSpan {
                                text: word.to_string(),
                                style,
                            });
                            current_col += word_len;
                        } else if current_col + word_len > effective_width {
                            // Word is too wide even on its own line — break character by character
                            let mut char_buf = String::new();
                            for ch in word.chars() {
                                let ch_w = ch.width().unwrap_or(1);
                                if current_col + ch_w > effective_width && current_col > wrap_min {
                                    // Flush accumulated chars
                                    if !char_buf.is_empty() {
                                        current_spans.push(StyledSpan { text: char_buf.clone(), style });
                                        char_buf.clear();
                                    }
                                    flush_line(&mut current_spans, &current_bg, &mut result, &mut current_col);
                                    if !blockquote_prefix.is_empty() {
                                        current_spans.push(StyledSpan {
                                            text: blockquote_prefix.to_string(),
                                            style: TextStyle {
                                                foreground: theme.blockquote,
                                                background: None,
                                                bold: false, dim: false, italic: false, underline: false,
                                            },
                                        });
                                        current_col += prefix_len;
                                    }
                                }
                                char_buf.push(ch);
                                current_col += ch_w;
                            }
                            if !char_buf.is_empty() {
                                current_spans.push(StyledSpan { text: char_buf, style });
                            }
                        } else {
                            // Word fits on current line
                            current_spans.push(StyledSpan {
                                text: word.to_string(),
                                style,
                            });
                            current_col += word_len;
                        }
                        wrap_min = prefix_len; // after first word, normal wrapping
                    }
                }
            }
            Event::Code(code) => {
                // Inline code: `code`
                let just_placed_marker = pending_list_marker.is_some();
                if let Some(marker) = pending_list_marker.take() {
                    current_spans.push(StyledSpan {
                        text: marker.clone(),
                        style: TextStyle {
                            foreground: theme.list_marker,
                            background: None,
                            bold: false, dim: false, italic: false, underline: false,
                        },
                    });
                    current_col += marker.width();
                }
                let code_text = format!(" {} ", code);
                let code_len = code_text.width();
                // Don't wrap inline code away from a list marker that was just placed
                if current_col + code_len > effective_width && current_col > 0 && !just_placed_marker {
                    flush_line(&mut current_spans, &current_bg, &mut result, &mut current_col);
                }
                current_spans.push(StyledSpan {
                    text: code_text,
                    style: TextStyle {
                        foreground: theme.code_fg,
                        background: Some(theme.code_bg),
                        bold: false, dim: false, italic: false, underline: false,
                    },
                });
                current_col += code_len;
            }
            Event::SoftBreak => {
                // Treat soft breaks as spaces (markdown paragraph continuation)
                current_spans.push(StyledSpan {
                    text: " ".to_string(),
                    style: style_for(theme, &heading_level, bold, italic, in_link, in_code_block, in_blockquote),
                });
                current_col += 1;
            }
            Event::HardBreak => {
                flush_line(&mut current_spans, &current_bg, &mut result, &mut current_col);
            }
            Event::Rule => {
                if !current_spans.is_empty() {
                    flush_line(&mut current_spans, &current_bg, &mut result, &mut current_col);
                }
                let rule_len = effective_width.min(60);
                result.push(PreviewLine {
                    spans: vec![
                        StyledSpan {
                            text: " ".repeat(indent),
                            style: TextStyle {
                                foreground: theme.body,
                                background: None,
                                bold: false, dim: false, italic: false, underline: false,
                            },
                        },
                        StyledSpan {
                            text: "\u{2500}".repeat(rule_len),
                            style: TextStyle {
                                foreground: theme.rule,
                                background: None,
                                bold: false, dim: false, italic: false, underline: false,
                            },
                        },
                    ],
                    bg_color: None,
                });
                push_empty_line(&mut result);
            }
            // Ignore other events (HTML, footnotes, etc.)
            _ => {}
        }
    }

    // Flush any remaining content
    if !current_spans.is_empty() {
        flush_line(&mut current_spans, &current_bg, &mut result, &mut current_col);
    }

    result
}

// ---------------------------------------------------------------------------
// LivePreviewMap — source-range → markdown-element mapping for live preview
// ---------------------------------------------------------------------------

use std::ops::Range;

/// The kind of markdown element.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MdElementKind {
    // Inline elements — syntax can be hidden
    Bold,
    Italic,
    InlineCode,
    Link,
    Image,
    Strikethrough,

    // Block elements — syntax always visible, styled
    Heading(u8),  // level 1–6
    CodeBlock,
    BlockQuote,
    ListItem,
    Table,
    HorizontalRule,
}

impl MdElementKind {
    /// Returns true if this element's syntax markers can be hidden (inline elements).
    pub fn is_inline(&self) -> bool {
        matches!(
            self,
            Self::Bold
                | Self::Italic
                | Self::InlineCode
                | Self::Link
                | Self::Image
                | Self::Strikethrough
        )
    }
}

/// A single markdown element with its source location and syntax/content classification.
#[derive(Debug, Clone)]
pub struct MdElement {
    /// Byte range in the source buffer covering the entire element (including syntax markers).
    pub full_range: Range<usize>,
    /// Byte ranges of syntax markers (e.g., the `**` in bold, the `` ` `` in code).
    pub syntax_ranges: Vec<Range<usize>>,
    /// The kind of element.
    pub kind: MdElementKind,
    /// Line range (0-based, half-open) this element spans.
    pub line_range: Range<usize>,
}

/// Maps source buffer ranges to markdown elements for live preview rendering.
///
/// Built from `pulldown_cmark` offset iteration. Used by LivePreviewMode to decide
/// which characters to hide or style on each line.
#[derive(Debug, Clone)]
pub struct LivePreviewMap {
    /// All markdown elements found in the buffer, sorted by `full_range.start`.
    pub elements: Vec<MdElement>,
}

/// Helper: convert a byte offset into a 0-based line number using precomputed line starts.
fn byte_offset_to_line(offset: usize, line_starts: &[usize]) -> usize {
    match line_starts.binary_search(&offset) {
        Ok(i) => i,
        Err(i) => i.saturating_sub(1),
    }
}

/// Helper: build a vec of byte offsets where each line begins.
fn build_line_starts(source: &str) -> Vec<usize> {
    let mut starts = vec![0usize];
    for (i, ch) in source.char_indices() {
        if ch == '\n' {
            starts.push(i + 1);
        }
    }
    starts
}

/// Pending element on the parser stack — tracks where a Start event was seen.
struct PendingElement {
    kind: MdElementKind,
    start_byte: usize,
}

impl LivePreviewMap {
    /// Build a `LivePreviewMap` from buffer lines using pulldown_cmark's offset iterator.
    pub fn build(lines: &[String]) -> Self {
        use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd, HeadingLevel};

        let source: String = lines.join("\n");
        let line_starts = build_line_starts(&source);

        let opts = Options::all();
        let parser = Parser::new_ext(&source, opts);
        let offset_iter = parser.into_offset_iter();

        let mut elements: Vec<MdElement> = Vec::new();
        let mut stack: Vec<PendingElement> = Vec::new();

        for (event, range) in offset_iter {
            match event {
                // -- Inline Start events -----------------------------------------
                Event::Start(Tag::Strong) => {
                    stack.push(PendingElement {
                        kind: MdElementKind::Bold,
                        start_byte: range.start,
                    });
                }
                Event::End(TagEnd::Strong) => {
                    if let Some(pending) = pop_matching(&mut stack, MdElementKind::Bold) {
                        let full = pending.start_byte..range.end;
                        let syntax = bold_syntax_ranges(&source, &full);
                        let lr = lines_for_range(&full, &line_starts);
                        elements.push(MdElement {
                            full_range: full,
                            syntax_ranges: syntax,
                            kind: MdElementKind::Bold,
                            line_range: lr,
                        });
                    }
                }

                Event::Start(Tag::Emphasis) => {
                    stack.push(PendingElement {
                        kind: MdElementKind::Italic,
                        start_byte: range.start,
                    });
                }
                Event::End(TagEnd::Emphasis) => {
                    if let Some(pending) = pop_matching(&mut stack, MdElementKind::Italic) {
                        let full = pending.start_byte..range.end;
                        let syntax = emphasis_syntax_ranges(&source, &full);
                        let lr = lines_for_range(&full, &line_starts);
                        elements.push(MdElement {
                            full_range: full,
                            syntax_ranges: syntax,
                            kind: MdElementKind::Italic,
                            line_range: lr,
                        });
                    }
                }

                Event::Start(Tag::Strikethrough) => {
                    stack.push(PendingElement {
                        kind: MdElementKind::Strikethrough,
                        start_byte: range.start,
                    });
                }
                Event::End(TagEnd::Strikethrough) => {
                    if let Some(pending) = pop_matching(&mut stack, MdElementKind::Strikethrough) {
                        let full = pending.start_byte..range.end;
                        // Strikethrough uses ~~ on each side
                        let syntax = symmetric_syntax_ranges(&source, &full, '~');
                        let lr = lines_for_range(&full, &line_starts);
                        elements.push(MdElement {
                            full_range: full,
                            syntax_ranges: syntax,
                            kind: MdElementKind::Strikethrough,
                            line_range: lr,
                        });
                    }
                }

                Event::Code(_text) => {
                    // Inline code: range covers the entire ` ... ` including backticks.
                    let full = range.clone();
                    let syntax = inline_code_syntax_ranges(&source, &full);
                    let lr = lines_for_range(&full, &line_starts);
                    elements.push(MdElement {
                        full_range: full,
                        syntax_ranges: syntax,
                        kind: MdElementKind::InlineCode,
                        line_range: lr,
                    });
                }

                // -- Link / Image ------------------------------------------------
                Event::Start(Tag::Link { .. }) => {
                    stack.push(PendingElement {
                        kind: MdElementKind::Link,
                        start_byte: range.start,
                    });
                }
                Event::End(TagEnd::Link) => {
                    if let Some(pending) = pop_matching(&mut stack, MdElementKind::Link) {
                        let full = pending.start_byte..range.end;
                        let syntax = link_syntax_ranges(&source, &full);
                        let lr = lines_for_range(&full, &line_starts);
                        elements.push(MdElement {
                            full_range: full,
                            syntax_ranges: syntax,
                            kind: MdElementKind::Link,
                            line_range: lr,
                        });
                    }
                }

                Event::Start(Tag::Image { .. }) => {
                    stack.push(PendingElement {
                        kind: MdElementKind::Image,
                        start_byte: range.start,
                    });
                }
                Event::End(TagEnd::Image) => {
                    if let Some(pending) = pop_matching(&mut stack, MdElementKind::Image) {
                        let full = pending.start_byte..range.end;
                        let syntax = image_syntax_ranges(&source, &full);
                        let lr = lines_for_range(&full, &line_starts);
                        elements.push(MdElement {
                            full_range: full,
                            syntax_ranges: syntax,
                            kind: MdElementKind::Image,
                            line_range: lr,
                        });
                    }
                }

                // -- Block elements ----------------------------------------------
                Event::Start(Tag::Heading { level, .. }) => {
                    let lvl = match level {
                        HeadingLevel::H1 => 1,
                        HeadingLevel::H2 => 2,
                        HeadingLevel::H3 => 3,
                        HeadingLevel::H4 => 4,
                        HeadingLevel::H5 => 5,
                        HeadingLevel::H6 => 6,
                    };
                    stack.push(PendingElement {
                        kind: MdElementKind::Heading(lvl),
                        start_byte: range.start,
                    });
                }
                Event::End(TagEnd::Heading(_)) => {
                    if let Some(pending) = pop_matching_heading(&mut stack) {
                        let full = pending.start_byte..range.end;
                        let syntax = heading_syntax_ranges(&source, &full);
                        let lr = lines_for_range(&full, &line_starts);
                        elements.push(MdElement {
                            full_range: full,
                            syntax_ranges: syntax,
                            kind: pending.kind,
                            line_range: lr,
                        });
                    }
                }

                Event::Start(Tag::CodeBlock(_)) => {
                    stack.push(PendingElement {
                        kind: MdElementKind::CodeBlock,
                        start_byte: range.start,
                    });
                }
                Event::End(TagEnd::CodeBlock) => {
                    if let Some(pending) = pop_matching(&mut stack, MdElementKind::CodeBlock) {
                        let full = pending.start_byte..range.end;
                        let syntax = code_block_syntax_ranges(&source, &full);
                        let lr = lines_for_range(&full, &line_starts);
                        elements.push(MdElement {
                            full_range: full,
                            syntax_ranges: syntax,
                            kind: MdElementKind::CodeBlock,
                            line_range: lr,
                        });
                    }
                }

                Event::Start(Tag::BlockQuote(_)) => {
                    stack.push(PendingElement {
                        kind: MdElementKind::BlockQuote,
                        start_byte: range.start,
                    });
                }
                Event::End(TagEnd::BlockQuote(_)) => {
                    if let Some(pending) = pop_matching(&mut stack, MdElementKind::BlockQuote) {
                        let full = pending.start_byte..range.end;
                        let syntax = blockquote_syntax_ranges(&source, &full);
                        let lr = lines_for_range(&full, &line_starts);
                        elements.push(MdElement {
                            full_range: full,
                            syntax_ranges: syntax,
                            kind: MdElementKind::BlockQuote,
                            line_range: lr,
                        });
                    }
                }

                Event::Start(Tag::Item) => {
                    stack.push(PendingElement {
                        kind: MdElementKind::ListItem,
                        start_byte: range.start,
                    });
                }
                Event::End(TagEnd::Item) => {
                    if let Some(pending) = pop_matching(&mut stack, MdElementKind::ListItem) {
                        let full = pending.start_byte..range.end;
                        let syntax = list_item_syntax_ranges(&source, &full);
                        let lr = lines_for_range(&full, &line_starts);
                        elements.push(MdElement {
                            full_range: full,
                            syntax_ranges: syntax,
                            kind: MdElementKind::ListItem,
                            line_range: lr,
                        });
                    }
                }

                Event::Start(Tag::Table(_)) => {
                    stack.push(PendingElement {
                        kind: MdElementKind::Table,
                        start_byte: range.start,
                    });
                }
                Event::End(TagEnd::Table) => {
                    if let Some(pending) = pop_matching(&mut stack, MdElementKind::Table) {
                        let full = pending.start_byte..range.end;
                        let lr = lines_for_range(&full, &line_starts);
                        elements.push(MdElement {
                            full_range: full,
                            syntax_ranges: vec![], // table pipes are structural, not hidden
                            kind: MdElementKind::Table,
                            line_range: lr,
                        });
                    }
                }

                Event::Rule => {
                    let full = range.clone();
                    let lr = lines_for_range(&full, &line_starts);
                    elements.push(MdElement {
                        full_range: full.clone(),
                        syntax_ranges: vec![full],
                        kind: MdElementKind::HorizontalRule,
                        line_range: lr,
                    });
                }

                _ => {}
            }
        }

        // Sort by start offset (spec BR-2: sorted by start offset)
        elements.sort_by_key(|e| e.full_range.start);

        LivePreviewMap { elements }
    }

    /// Get all elements that overlap with the given line (0-based).
    pub fn elements_on_line(&self, line: usize) -> Vec<&MdElement> {
        self.elements
            .iter()
            .filter(|e| e.line_range.start <= line && line < e.line_range.end)
            .collect()
    }

    /// Get all inline elements whose syntax should be hidden on the given line
    /// (i.e., cursor is NOT on this line).
    pub fn hidden_syntax_ranges(&self, line: usize, cursor_line: usize) -> Vec<Range<usize>> {
        if line == cursor_line {
            return vec![]; // Never hide syntax on cursor line
        }
        self.elements_on_line(line)
            .into_iter()
            .filter(|e| e.kind.is_inline())
            .flat_map(|e| e.syntax_ranges.clone())
            .collect()
    }

    /// Check if a byte offset falls within any syntax range that should be hidden.
    pub fn is_hidden_at(&self, byte_offset: usize, cursor_line: usize, lines: &[String]) -> bool {
        // Convert byte_offset to a line number
        let mut cumulative = 0usize;
        let mut target_line = 0usize;
        for (i, line) in lines.iter().enumerate() {
            let line_end = cumulative + line.len() + 1; // +1 for \n
            if byte_offset < line_end {
                target_line = i;
                break;
            }
            cumulative = line_end;
            target_line = i + 1;
        }

        let hidden = self.hidden_syntax_ranges(target_line, cursor_line);
        hidden.iter().any(|r| r.contains(&byte_offset))
    }

    /// Get the element kind at a byte offset (used by the renderer for styling).
    pub fn element_style(&self, byte_offset: usize) -> Option<MdElementKind> {
        // Binary search for the first element whose full_range might contain byte_offset.
        let idx = self
            .elements
            .binary_search_by(|e| {
                if e.full_range.end <= byte_offset {
                    std::cmp::Ordering::Less
                } else if e.full_range.start > byte_offset {
                    std::cmp::Ordering::Greater
                } else {
                    std::cmp::Ordering::Equal
                }
            })
            .ok()?;
        Some(self.elements[idx].kind)
    }

    /// Map a visual column to a buffer column on a given line,
    /// accounting for hidden syntax characters in live preview mode.
    /// Used when clicking on a non-cursor line in live preview.
    pub fn visual_to_buffer_col(
        &self,
        line: usize,
        visual_col: usize,
        cursor_line: usize,
        line_content: &str,
        lines: &[String],
    ) -> usize {
        if line == cursor_line {
            return visual_col; // No mapping needed on cursor line
        }
        let hidden = self.hidden_syntax_ranges(line, cursor_line);
        if hidden.is_empty() {
            return visual_col;
        }

        // Compute byte offset of this line in the overall buffer
        let line_byte_start: usize = lines.iter().take(line).map(|l| l.len() + 1).sum();

        let mut display_col = 0usize;
        let mut buffer_col = 0usize;
        let mut byte_offset = line_byte_start;

        for ch in line_content.chars() {
            if ch == '\n' {
                break;
            }
            let char_byte_len = ch.len_utf8();
            let is_hidden = hidden.iter().any(|r| r.contains(&byte_offset));
            byte_offset += char_byte_len;

            if is_hidden {
                buffer_col += 1;
                continue;
            }
            if display_col >= visual_col {
                return buffer_col;
            }
            display_col += UnicodeWidthChar::width(ch).unwrap_or(1);
            buffer_col += 1;
        }
        buffer_col
    }
}

// ---------------------------------------------------------------------------
// Syntax-range extraction helpers
// ---------------------------------------------------------------------------

/// Pop the last matching element from the stack.
fn pop_matching(stack: &mut Vec<PendingElement>, kind: MdElementKind) -> Option<PendingElement> {
    if let Some(pos) = stack.iter().rposition(|p| p.kind == kind) {
        Some(stack.remove(pos))
    } else {
        None
    }
}

/// Pop the last heading element from the stack (any level).
fn pop_matching_heading(stack: &mut Vec<PendingElement>) -> Option<PendingElement> {
    if let Some(pos) = stack
        .iter()
        .rposition(|p| matches!(p.kind, MdElementKind::Heading(_)))
    {
        Some(stack.remove(pos))
    } else {
        None
    }
}

/// Compute line range (0-based, half-open) from a byte range.
fn lines_for_range(byte_range: &Range<usize>, line_starts: &[usize]) -> Range<usize> {
    let start_line = byte_offset_to_line(byte_range.start, line_starts);
    // end is exclusive in the byte range; the last occupied line uses (end - 1)
    let end_byte = if byte_range.end > 0 {
        byte_range.end - 1
    } else {
        0
    };
    let end_line = byte_offset_to_line(end_byte, line_starts);
    start_line..end_line + 1
}

/// Count consecutive occurrences of `ch` at the start of `s`.
fn count_leading(s: &str, ch: char) -> usize {
    s.chars().take_while(|&c| c == ch).count()
}

/// Count consecutive occurrences of `ch` at the end of `s`.
fn count_trailing(s: &str, ch: char) -> usize {
    s.chars().rev().take_while(|&c| c == ch).count()
}

/// Bold syntax: `**...**` or `__...__`.
fn bold_syntax_ranges(source: &str, full: &Range<usize>) -> Vec<Range<usize>> {
    let slice = &source[full.start..full.end];
    let ch = if slice.starts_with('*') { '*' } else { '_' };
    let leading = count_leading(slice, ch);
    let trailing = count_trailing(slice, ch);
    if leading == 0 {
        return vec![];
    }
    vec![
        full.start..full.start + leading,
        full.end - trailing..full.end,
    ]
}

/// Emphasis syntax: `*...*` or `_..._`.
fn emphasis_syntax_ranges(source: &str, full: &Range<usize>) -> Vec<Range<usize>> {
    let slice = &source[full.start..full.end];
    let ch = if slice.starts_with('*') { '*' } else { '_' };
    let leading = count_leading(slice, ch);
    let trailing = count_trailing(slice, ch);
    if leading == 0 {
        return vec![];
    }
    vec![
        full.start..full.start + leading,
        full.end - trailing..full.end,
    ]
}

/// Symmetric delimiter syntax (e.g. `~~strikethrough~~`).
fn symmetric_syntax_ranges(source: &str, full: &Range<usize>, ch: char) -> Vec<Range<usize>> {
    let slice = &source[full.start..full.end];
    let leading = count_leading(slice, ch);
    let trailing = count_trailing(slice, ch);
    if leading == 0 {
        return vec![];
    }
    vec![
        full.start..full.start + leading,
        full.end - trailing..full.end,
    ]
}

/// Inline code syntax: `` `code` `` — backtick(s) on each side.
fn inline_code_syntax_ranges(source: &str, full: &Range<usize>) -> Vec<Range<usize>> {
    let slice = &source[full.start..full.end];
    let leading = count_leading(slice, '`');
    let trailing = count_trailing(slice, '`');
    if leading == 0 {
        return vec![];
    }
    vec![
        full.start..full.start + leading,
        full.end - trailing..full.end,
    ]
}

/// Link syntax: `[text](url)` → syntax = `[`, `](url)`.
fn link_syntax_ranges(source: &str, full: &Range<usize>) -> Vec<Range<usize>> {
    let slice = &source[full.start..full.end];
    let mut ranges = Vec::new();
    // Opening `[`
    if slice.starts_with('[') {
        ranges.push(full.start..full.start + 1);
    }
    // Find `](` — marks end of text, start of URL part
    if let Some(bracket_pos) = slice.find("](") {
        let abs_pos = full.start + bracket_pos;
        ranges.push(abs_pos..full.end); // `](url)`
    }
    ranges
}

/// Image syntax: `![alt](url)` → syntax = `![`, `](url)`.
fn image_syntax_ranges(source: &str, full: &Range<usize>) -> Vec<Range<usize>> {
    let slice = &source[full.start..full.end];
    let mut ranges = Vec::new();
    if slice.starts_with("![") {
        ranges.push(full.start..full.start + 2);
    }
    if let Some(bracket_pos) = slice.find("](") {
        let abs_pos = full.start + bracket_pos;
        ranges.push(abs_pos..full.end);
    }
    ranges
}

/// Heading syntax: `# `, `## `, etc. — the leading `#` chars and the space.
fn heading_syntax_ranges(source: &str, full: &Range<usize>) -> Vec<Range<usize>> {
    let slice = &source[full.start..full.end];
    let hashes = count_leading(slice, '#');
    if hashes == 0 {
        return vec![];
    }
    // Include the space after the hashes if present
    let end = if slice[hashes..].starts_with(' ') {
        full.start + hashes + 1
    } else {
        full.start + hashes
    };
    vec![full.start..end]
}

/// Code block syntax: fenced ``` lines.
fn code_block_syntax_ranges(source: &str, full: &Range<usize>) -> Vec<Range<usize>> {
    let slice = &source[full.start..full.end];
    let mut ranges = Vec::new();

    // Opening fence: first line
    if let Some(nl) = slice.find('\n') {
        ranges.push(full.start..full.start + nl);
    } else {
        ranges.push(full.clone());
        return ranges;
    }

    // Closing fence: last line (if it starts with ``` or ~~~)
    if let Some(last_nl) = slice.rfind('\n') {
        let last_line = &slice[last_nl + 1..];
        let trimmed = last_line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            ranges.push(full.start + last_nl + 1..full.end);
        }
    }

    ranges
}

/// Blockquote syntax: `> ` prefix on each line.
fn blockquote_syntax_ranges(source: &str, full: &Range<usize>) -> Vec<Range<usize>> {
    let slice = &source[full.start..full.end];
    let mut ranges = Vec::new();
    let mut offset = 0;
    for line in slice.split('\n') {
        let trimmed = line.trim_start();
        if trimmed.starts_with('>') {
            let leading_ws = line.len() - trimmed.len();
            let marker_len = if trimmed.starts_with("> ") { 2 } else { 1 };
            let abs_start = full.start + offset + leading_ws;
            ranges.push(abs_start..abs_start + marker_len);
        }
        offset += line.len() + 1; // +1 for the \n
    }
    ranges
}

/// List item syntax: `- `, `* `, `1. `, etc. on the first line.
fn list_item_syntax_ranges(source: &str, full: &Range<usize>) -> Vec<Range<usize>> {
    let slice = &source[full.start..full.end];
    let first_line = slice.split('\n').next().unwrap_or("");
    let trimmed = first_line.trim_start();
    let leading_ws = first_line.len() - trimmed.len();

    // Unordered: - or * or +
    if trimmed.starts_with("- ") || trimmed.starts_with("* ") || trimmed.starts_with("+ ") {
        return vec![full.start + leading_ws..full.start + leading_ws + 2];
    }

    // Ordered: digits followed by . or )
    let digit_count = trimmed.chars().take_while(|c| c.is_ascii_digit()).count();
    if digit_count > 0 {
        let after_digits = &trimmed[digit_count..];
        if after_digits.starts_with(". ") || after_digits.starts_with(") ") {
            let marker_len = digit_count + 2; // digits + ". " or ") "
            return vec![full.start + leading_ws..full.start + leading_ws + marker_len];
        }
    }

    vec![]
}
