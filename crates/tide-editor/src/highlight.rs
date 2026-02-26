// Syntax highlighting via syntect, with incremental state caching.

use std::cell::RefCell;
use std::path::Path;

use syntect::highlighting::{
    HighlightState, Highlighter as SyntectHighlighter, RangedHighlightIterator, Style, Theme,
    ThemeSet,
};
use syntect::parsing::{ParseState, ScopeStack, SyntaxDefinition, SyntaxReference, SyntaxSet};

use tide_core::{Color, TextStyle};

/// A styled span of text produced by syntax highlighting.
pub struct StyledSpan {
    pub text: String,
    pub style: TextStyle,
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

impl Highlighter {
    pub fn new() -> Self {
        let mut builder = SyntaxSet::load_defaults_newlines().into_builder();

        // Load custom JSX/TSX syntax embedded at compile time.
        let jsx_yaml = include_str!("../syntaxes/JSX.sublime-syntax");
        if let Ok(jsx_def) = SyntaxDefinition::load_from_str(jsx_yaml, true, None) {
            builder.add(jsx_def);
        }

        let syntax_set = builder.build();
        let theme_set = ThemeSet::load_defaults();
        let dark_theme = theme_set.themes["base16-eighties.dark"].clone();
        let light_theme = theme_set.themes["InspiredGitHub"].clone();
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
            cache.syntax_name = syntax_name;
            cache.line_count = line_count;
        }

        // Determine where to start parsing: find the nearest checkpoint at or
        // before start_line.
        let checkpoint_idx = start_line / CHECKPOINT_INTERVAL;
        let resume_line;

        let highlighter = SyntectHighlighter::new(&self.theme);
        let (mut parse_state, mut highlight_state) = if checkpoint_idx > 0
            && checkpoint_idx <= cache.checkpoints.len()
        {
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
        let theme_bg = self.theme.settings.background.unwrap_or(
            syntect::highlighting::Color {
                r: 0,
                g: 0,
                b: 0,
                a: 255,
            },
        );

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
                cache.checkpoints
                    .push((parse_state.clone(), highlight_state.clone()));
            }

            // Only build StyledSpans for visible lines.
            if i >= start_line {
                let regions: Vec<(Style, &str)> =
                    RangedHighlightIterator::new(&mut highlight_state, &ops, &line_with_newline, &highlighter)
                        .map(|(style, text, _range)| (style, text))
                        .collect();

                let spans: Vec<StyledSpan> = regions
                    .into_iter()
                    .map(|(style, text)| {
                        let fg = Color::new(
                            style.foreground.r as f32 / 255.0,
                            style.foreground.g as f32 / 255.0,
                            style.foreground.b as f32 / 255.0,
                            style.foreground.a as f32 / 255.0,
                        );
                        let is_theme_bg = style.background.r == theme_bg.r
                            && style.background.g == theme_bg.g
                            && style.background.b == theme_bg.b;
                        let is_black = style.background.r == 0
                            && style.background.g == 0
                            && style.background.b == 0;
                        let bg =
                            if style.background.a > 0 && !is_theme_bg && !is_black {
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
                result.push(spans);
            } else {
                // Still need to advance highlight_state for non-visible lines.
                for _ in RangedHighlightIterator::new(&mut highlight_state, &ops, &line_with_newline, &highlighter) {}
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
