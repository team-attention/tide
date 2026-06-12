// Syntax highlighting via syntect, with incremental state caching.

use std::cell::RefCell;
use std::path::Path;
use std::str::FromStr;

use syntect::highlighting::{
    Color as SyntectColor, HighlightState, Highlighter as SyntectHighlighter,
    RangedHighlightIterator, ScopeSelectors, Style, StyleModifier, Theme, ThemeItem, ThemeSet,
};
use syntect::parsing::{ParseState, ScopeStack, SyntaxDefinition, SyntaxReference, SyntaxSet};

use crate::tide_core::{Color, TextStyle};

pub(crate) const DARK_SYNTAX_THEME_NAME: &str = "tide-dark";
pub(crate) const LIGHT_SYNTAX_THEME_NAME: &str = "tide-light";

/// A styled span of text produced by syntax highlighting.
pub struct StyledSpan {
    pub text: String,
    pub style: TextStyle,
}

/// Monotonic cursor over syntax-highlighted spans.
pub struct StyledSpanCursor<'a> {
    spans: &'a [StyledSpan],
    span_idx: usize,
    span_start_char: usize,
    span_end_char: usize,
    fallback: TextStyle,
}

impl<'a> StyledSpanCursor<'a> {
    pub fn new(spans: &'a [StyledSpan], fallback: TextStyle) -> Self {
        let span_end_char = spans
            .first()
            .map(|span| span.text.chars().count())
            .unwrap_or(0);
        Self {
            spans,
            span_idx: 0,
            span_start_char: 0,
            span_end_char,
            fallback,
        }
    }

    pub fn style_at(&mut self, target_char: usize) -> TextStyle {
        while self.span_idx < self.spans.len() && target_char >= self.span_end_char {
            self.span_idx += 1;
            self.span_start_char = self.span_end_char;
            self.span_end_char += self
                .spans
                .get(self.span_idx)
                .map(|span| span.text.chars().count())
                .unwrap_or(0);
        }

        if self.span_idx < self.spans.len()
            && target_char >= self.span_start_char
            && target_char < self.span_end_char
        {
            self.spans[self.span_idx].style
        } else {
            self.fallback
        }
    }
}

/// Interval (in lines) between cached parse-state checkpoints.
const CHECKPOINT_INTERVAL: usize = 256;

/// Cached highlighting state for incremental re-highlighting on scroll.
struct HighlightCache {
    /// (ParseState, HighlightState) saved every CHECKPOINT_INTERVAL lines.
    checkpoints: Vec<(ParseState, HighlightState)>,
    /// Name of the syntax these checkpoints were built with.
    syntax_name: String,
    /// Number of lines the checkpoints were built from (invalidation key).
    line_count: usize,
}

pub struct Highlighter {
    syntax_set: SyntaxSet,
    theme: Theme,
    dark_theme: Theme,
    light_theme: Theme,
    /// Cached parse states for incremental highlighting (interior mutability
    /// so highlight_lines can remain &self).
    cache: RefCell<HighlightCache>,
}

// Safety: `Highlighter` holds syntect/oniguruma state (SyntaxSet + cached
// ParseState/HighlightState) that uses raw pointers and so is not auto-`Send`.
// A `Highlighter` is owned by an `EditorPane`, which lives only in the app
// thread's pane set and is never accessed from another thread. Localizing the
// `Send` claim here (rather than a blanket `unsafe impl Send for App`) keeps the
// app structurally `Send` while documenting exactly why this holder is safe.
unsafe impl Send for Highlighter {}

fn syntax_color(r: u8, g: u8, b: u8) -> SyntectColor {
    SyntectColor { r, g, b, a: 255 }
}

fn theme_item(scope: &str, color: SyntectColor) -> Option<ThemeItem> {
    Some(ThemeItem {
        scope: ScopeSelectors::from_str(scope).ok()?,
        style: StyleModifier {
            foreground: Some(color),
            background: None,
            font_style: None,
        },
    })
}

fn ensure_light_syntax_contrast(color: Color) -> Color {
    const BG_LUM: f32 = 1.0;
    const MIN_CONTRAST: f32 = 3.15;
    let fg_lum = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
    let contrast = (BG_LUM + 0.05) / (fg_lum + 0.05);
    if contrast >= MIN_CONTRAST {
        return color;
    }

    let target_lum = (BG_LUM + 0.05) / MIN_CONTRAST - 0.05;
    let scale = if fg_lum > 0.001 {
        (target_lum / fg_lum).min(1.0)
    } else {
        1.0
    };
    Color::new(
        (color.r * scale).clamp(0.0, 1.0),
        (color.g * scale).clamp(0.0, 1.0),
        (color.b * scale).clamp(0.0, 1.0),
        color.a,
    )
}

fn is_light_theme(theme: &Theme) -> bool {
    theme.name.as_deref() == Some(LIGHT_SYNTAX_THEME_NAME)
}

fn style_with_foreground(mut style: TextStyle, foreground: Color) -> TextStyle {
    style.foreground = foreground;
    style
}

fn push_styled_token(out: &mut Vec<StyledSpan>, text: String, style: TextStyle) {
    if !text.is_empty() {
        out.push(StyledSpan { text, style });
    }
}

fn light_rust_import_token_style(token: &str, base: TextStyle) -> TextStyle {
    match token {
        "use" | "crate" | "self" | "super" => {
            style_with_foreground(base, Color::rgb(0.686, 0.0, 0.859))
        }
        _ if token
            .chars()
            .next()
            .is_some_and(|ch| ch.is_ascii_uppercase()) =>
        {
            style_with_foreground(base, Color::rgb(0.149, 0.498, 0.6))
        }
        _ => style_with_foreground(base, Color::rgb(0.0, 0.063, 0.502)),
    }
}

fn enhance_light_rust_import_spans(spans: Vec<StyledSpan>, line: &str) -> Vec<StyledSpan> {
    if !line.trim_start().starts_with("use ") {
        return spans;
    }

    let mut out = Vec::new();
    for span in spans {
        let mut token = String::new();
        for ch in span.text.chars() {
            if ch == '_' || ch.is_ascii_alphanumeric() {
                token.push(ch);
                continue;
            }

            if !token.is_empty() {
                let style = light_rust_import_token_style(&token, span.style);
                push_styled_token(&mut out, std::mem::take(&mut token), style);
            }

            let punctuation_style = style_with_foreground(span.style, Color::rgb(0.0, 0.0, 0.0));
            push_styled_token(&mut out, ch.to_string(), punctuation_style);
        }

        if !token.is_empty() {
            let style = light_rust_import_token_style(&token, span.style);
            push_styled_token(&mut out, token, style);
        }
    }
    out
}

fn build_light_syntax_theme(theme_set: &ThemeSet) -> Theme {
    let mut theme = theme_set.themes["base16-ocean.light"].clone();
    theme.name = Some(LIGHT_SYNTAX_THEME_NAME.to_string());
    theme.settings.foreground = Some(syntax_color(0, 0, 0));
    theme.settings.background = Some(syntax_color(255, 255, 255));
    theme.scopes.clear();

    // Token role colors follow VS Code Light+.
    let rules = [
        ("source, text", syntax_color(0, 0, 0)),
        ("comment, punctuation.definition.comment", syntax_color(0, 128, 0)),
        (
            "keyword, storage.type, storage.modifier, keyword.control, keyword.other.ts, storage.type.js, storage.type.class.js",
            syntax_color(175, 0, 219),
        ),
        ("entity.name.type, support.type, support.class", syntax_color(38, 127, 153)),
        (
            "entity.name.function, support.function, meta.function-call entity.name.function",
            syntax_color(121, 94, 38),
        ),
        (
            "variable, variable.function, variable.other, variable.language, meta.property.object",
            syntax_color(0, 16, 128),
        ),
        (
            "entity.name.macro, meta.macro, support.macro",
            syntax_color(121, 94, 38),
        ),
        (
            "string.quoted.single.js, string.quoted.double.js, string.quoted.other.js",
            syntax_color(163, 21, 21),
        ),
        (
            "string, punctuation.definition.string",
            syntax_color(163, 21, 21),
        ),
        ("constant.numeric", syntax_color(9, 134, 88)),
        ("constant.language, constant.other", syntax_color(0, 112, 193)),
        ("variable.parameter, variable.other.member", syntax_color(0, 16, 128)),
        ("entity.name.tag, entity.other.attribute-name", syntax_color(128, 0, 0)),
        ("keyword.operator", syntax_color(0, 0, 0)),
        ("punctuation, meta.brace, meta.group", syntax_color(0, 0, 0)),
    ];

    theme.scopes.extend(
        rules
            .into_iter()
            .filter_map(|(scope, color)| theme_item(scope, color)),
    );
    theme
}

fn build_dark_syntax_theme(theme_set: &ThemeSet) -> Theme {
    let mut theme = theme_set.themes["base16-eighties.dark"].clone();
    theme.name = Some(DARK_SYNTAX_THEME_NAME.to_string());
    theme.settings.foreground = Some(syntax_color(212, 212, 212));
    theme.settings.background = Some(syntax_color(17, 17, 20));
    theme.scopes.clear();

    // Token role colors follow VS Code Dark+.
    let rules = [
        ("source, text", syntax_color(212, 212, 212)),
        (
            "comment, punctuation.definition.comment",
            syntax_color(106, 153, 85),
        ),
        (
            "keyword, storage.type, storage.modifier, keyword.control, keyword.operator.word",
            syntax_color(197, 134, 192),
        ),
        (
            "entity.name.type, support.type, support.class, storage.type.rust",
            syntax_color(78, 201, 176),
        ),
        (
            "entity.name.function, support.function, meta.function-call entity.name.function",
            syntax_color(220, 220, 170),
        ),
        (
            "entity.name.macro, meta.macro, support.macro",
            syntax_color(215, 186, 125),
        ),
        (
            "string, punctuation.definition.string",
            syntax_color(206, 145, 120),
        ),
        (
            "constant.numeric, constant.language",
            syntax_color(181, 206, 168),
        ),
        (
            "variable.parameter, variable.other.member",
            syntax_color(156, 220, 254),
        ),
        (
            "entity.name.tag, entity.other.attribute-name",
            syntax_color(86, 156, 214),
        ),
        (
            "punctuation, meta.brace, meta.group",
            syntax_color(212, 212, 212),
        ),
    ];

    theme.scopes.extend(
        rules
            .into_iter()
            .filter_map(|(scope, color)| theme_item(scope, color)),
    );
    theme
}

impl Highlighter {
    pub fn new() -> Self {
        let mut builder = SyntaxSet::load_defaults_newlines().into_builder();

        // Load custom JSX/TSX syntax embedded at compile time.
        let jsx_yaml = include_str!("syntaxes/JSX.sublime-syntax");
        if let Ok(jsx_def) = SyntaxDefinition::load_from_str(jsx_yaml, true, None) {
            builder.add(jsx_def);
        }

        // Load the dedicated TypeScript syntax for `.ts`/`.mts`/`.cts`. Plain
        // TypeScript has no JSX, so `<…>` is a generic type-argument list (not a
        // tag) — the JSX grammar mis-parses every generic as a JSX tag.
        let ts_yaml = include_str!("syntaxes/TypeScript.sublime-syntax");
        if let Ok(ts_def) = SyntaxDefinition::load_from_str(ts_yaml, true, None) {
            builder.add(ts_def);
        }

        let syntax_set = builder.build();
        let theme_set = ThemeSet::load_defaults();
        let dark_theme = build_dark_syntax_theme(&theme_set);
        let light_theme = build_light_syntax_theme(&theme_set);
        let theme = dark_theme.clone();
        Self {
            syntax_set,
            theme,
            dark_theme,
            light_theme,
            cache: RefCell::new(HighlightCache {
                checkpoints: Vec::new(),
                syntax_name: String::new(),
                line_count: 0,
            }),
        }
    }

    /// Switch syntax highlighting theme for dark/light mode.
    pub fn set_dark_mode(&mut self, dark: bool) {
        self.theme = if dark {
            self.dark_theme.clone()
        } else {
            self.light_theme.clone()
        };
        // Invalidate cache when theme changes.
        self.cache.borrow_mut().checkpoints.clear();
    }

    /// Detect syntax from file extension. Returns None if unknown.
    pub fn detect_syntax(&self, path: &Path) -> Option<&SyntaxReference> {
        let ext = path.extension()?.to_str()?;
        self.syntax_set.find_syntax_by_extension(ext).or_else(|| {
            // Map common extensions missing from syntect defaults
            let fallback = match ext {
                "svelte" | "vue" => "html",
                "mdx" => "md",
                "jsonc" | "json5" => "json",
                "zsh" | "fish" => "sh",
                "h" | "hpp" | "hxx" | "cc" | "cxx" | "c++" | "inl" => "cpp",
                "m" | "mm" => "cpp",
                "yml" => "yaml",
                "dockerfile" => "Dockerfile",
                "toml" => "yaml", // reasonable fallback
                _ => return None,
            };
            self.syntax_set.find_syntax_by_extension(fallback)
        })
    }

    /// Highlight a range of lines using cached parse-state checkpoints.
    ///
    /// Instead of re-parsing from line 0 every time, we cache the parser
    /// state at regular intervals (every CHECKPOINT_INTERVAL lines). On
    /// scroll, we resume from the nearest checkpoint, reducing work from
    /// O(scroll_position) to O(CHECKPOINT_INTERVAL + visible_rows).
    pub fn highlight_lines(
        &self,
        lines: &[String],
        syntax: &SyntaxReference,
        start_line: usize,
        count: usize,
    ) -> Vec<Vec<StyledSpan>> {
        let syntax_name = syntax.name.clone();
        let line_count = lines.len();

        let mut cache = self.cache.borrow_mut();

        // Invalidate cache if syntax or file changed.
        if cache.syntax_name != syntax_name || cache.line_count != line_count {
            cache.checkpoints.clear();
            cache.syntax_name = syntax_name.clone();
            cache.line_count = line_count;
        }

        // Determine where to start parsing: find the nearest checkpoint at or
        // before start_line.
        let checkpoint_idx = start_line / CHECKPOINT_INTERVAL;
        let resume_line;

        let highlighter = SyntectHighlighter::new(&self.theme);
        let (mut parse_state, mut highlight_state) =
            if checkpoint_idx > 0 && checkpoint_idx <= cache.checkpoints.len() {
                // Resume from a cached checkpoint.
                resume_line = checkpoint_idx * CHECKPOINT_INTERVAL;
                cache.checkpoints[checkpoint_idx - 1].clone()
            } else if checkpoint_idx > 0 {
                // We don't have the requested checkpoint yet. Find the latest one
                // we do have and parse forward from there.
                if cache.checkpoints.is_empty() {
                    resume_line = 0;
                    (
                        ParseState::new(syntax),
                        HighlightState::new(&highlighter, ScopeStack::new()),
                    )
                } else {
                    let have = cache.checkpoints.len();
                    resume_line = have * CHECKPOINT_INTERVAL;
                    cache.checkpoints[have - 1].clone()
                }
            } else {
                resume_line = 0;
                (
                    ParseState::new(syntax),
                    HighlightState::new(&highlighter, ScopeStack::new()),
                )
            };

        // Get the theme's default background to filter it out from spans.
        let theme_bg = self
            .theme
            .settings
            .background
            .unwrap_or(syntect::highlighting::Color {
                r: 0,
                g: 0,
                b: 0,
                a: 255,
            });

        let end_line = (start_line + count).min(lines.len());
        let mut result = Vec::with_capacity(count);

        for i in resume_line..end_line {
            let line = &lines[i];
            let line_with_newline = format!("{}\n", line);

            let ops = match parse_state.parse_line(&line_with_newline, &self.syntax_set) {
                Ok(ops) => ops,
                Err(_) => {
                    if i >= start_line {
                        result.push(Vec::new());
                    }
                    continue;
                }
            };

            // Save checkpoint at interval boundaries.
            let cp_slot = (i + 1) / CHECKPOINT_INTERVAL;
            if (i + 1) % CHECKPOINT_INTERVAL == 0 && cp_slot > cache.checkpoints.len() {
                cache
                    .checkpoints
                    .push((parse_state.clone(), highlight_state.clone()));
            }

            // Only build StyledSpans for visible lines.
            if i >= start_line {
                let regions: Vec<(Style, &str)> = RangedHighlightIterator::new(
                    &mut highlight_state,
                    &ops,
                    &line_with_newline,
                    &highlighter,
                )
                .map(|(style, text, _range)| (style, text))
                .collect();

                let mut spans: Vec<StyledSpan> = regions
                    .into_iter()
                    .map(|(style, text)| {
                        let mut fg = Color::new(
                            style.foreground.r as f32 / 255.0,
                            style.foreground.g as f32 / 255.0,
                            style.foreground.b as f32 / 255.0,
                            style.foreground.a as f32 / 255.0,
                        );
                        if is_light_theme(&self.theme) {
                            fg = ensure_light_syntax_contrast(fg);
                        }
                        let is_theme_bg = style.background.r == theme_bg.r
                            && style.background.g == theme_bg.g
                            && style.background.b == theme_bg.b;
                        let is_black = style.background.r == 0
                            && style.background.g == 0
                            && style.background.b == 0;
                        let bg = if style.background.a > 0 && !is_theme_bg && !is_black {
                            Some(Color::new(
                                style.background.r as f32 / 255.0,
                                style.background.g as f32 / 255.0,
                                style.background.b as f32 / 255.0,
                                style.background.a as f32 / 255.0,
                            ))
                        } else {
                            None
                        };
                        StyledSpan {
                            text: text.trim_end_matches('\n').to_string(),
                            style: TextStyle {
                                foreground: fg,
                                background: bg,
                                bold: style
                                    .font_style
                                    .contains(syntect::highlighting::FontStyle::BOLD),
                                italic: style
                                    .font_style
                                    .contains(syntect::highlighting::FontStyle::ITALIC),
                                dim: false,
                                underline: style
                                    .font_style
                                    .contains(syntect::highlighting::FontStyle::UNDERLINE),
                            },
                        }
                    })
                    .collect();
                if is_light_theme(&self.theme) && syntax_name == "Rust" {
                    spans = enhance_light_rust_import_spans(spans, line);
                }
                result.push(spans);
            } else {
                // Still need to advance highlight_state for non-visible lines.
                for _ in RangedHighlightIterator::new(
                    &mut highlight_state,
                    &ops,
                    &line_with_newline,
                    &highlighter,
                ) {}
            }
        }

        result
    }

    pub fn syntax_set(&self) -> &SyntaxSet {
        &self.syntax_set
    }

    /// Get the plain text syntax (fallback when no syntax detected).
    pub fn plain_text_syntax(&self) -> &SyntaxReference {
        self.syntax_set.find_syntax_plain_text()
    }
}
