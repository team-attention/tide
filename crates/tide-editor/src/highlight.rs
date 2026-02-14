// Syntax highlighting via syntect.

use std::path::Path;

use syntect::highlighting::{Theme, ThemeSet};
use syntect::parsing::{SyntaxReference, SyntaxSet};
use syntect::easy::HighlightLines;

use tide_core::{Color, TextStyle};

/// A styled span of text produced by syntax highlighting.
pub struct StyledSpan {
    pub text: String,
    pub style: TextStyle,
}

pub struct Highlighter {
    syntax_set: SyntaxSet,
    theme: Theme,
    dark_theme: Theme,
    light_theme: Theme,
}

impl Highlighter {
    pub fn new() -> Self {
        let syntax_set = SyntaxSet::load_defaults_newlines();
        let theme_set = ThemeSet::load_defaults();
        let dark_theme = theme_set.themes["base16-eighties.dark"].clone();
        let light_theme = theme_set.themes["InspiredGitHub"].clone();
        let theme = dark_theme.clone();
        Self { syntax_set, theme, dark_theme, light_theme }
    }

    /// Switch syntax highlighting theme for dark/light mode.
    pub fn set_dark_mode(&mut self, dark: bool) {
        self.theme = if dark {
            self.dark_theme.clone()
        } else {
            self.light_theme.clone()
        };
    }

    /// Detect syntax from file extension. Returns None if unknown.
    pub fn detect_syntax(&self, path: &Path) -> Option<&SyntaxReference> {
        let ext = path.extension()?.to_str()?;
        self.syntax_set.find_syntax_by_extension(ext)
    }

    /// Highlight a range of lines. Only processes the visible viewport for performance.
    pub fn highlight_lines(
        &self,
        lines: &[String],
        syntax: &SyntaxReference,
        start_line: usize,
        count: usize,
    ) -> Vec<Vec<StyledSpan>> {
        let mut h = HighlightLines::new(syntax, &self.theme);
        let mut result = Vec::with_capacity(count);

        // Get the theme's default background to filter it out from spans
        let theme_bg = self.theme.settings.background.unwrap_or(
            syntect::highlighting::Color { r: 0, g: 0, b: 0, a: 255 }
        );

        // Process lines from start to build up highlighter state
        for (i, line) in lines.iter().enumerate() {
            let line_with_newline = format!("{}\n", line);
            let regions = h.highlight_line(&line_with_newline, &self.syntax_set);
            match regions {
                Ok(regions) => {
                    if i >= start_line && i < start_line + count {
                        let spans: Vec<StyledSpan> = regions
                            .into_iter()
                            .map(|(style, text)| {
                                let fg = Color::new(
                                    style.foreground.r as f32 / 255.0,
                                    style.foreground.g as f32 / 255.0,
                                    style.foreground.b as f32 / 255.0,
                                    style.foreground.a as f32 / 255.0,
                                );
                                // Filter out theme default background and black
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
                        result.push(spans);
                    }
                }
                Err(_) => {
                    if i >= start_line && i < start_line + count {
                        result.push(Vec::new());
                    }
                }
            }

            if i >= start_line + count {
                break;
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
