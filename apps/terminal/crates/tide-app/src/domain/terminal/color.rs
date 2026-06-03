// Color palette and conversion logic for Terminal

use alacritty_terminal::vte::ansi::{Color as AnsiColor, NamedColor, Rgb as AnsiRgb};

use crate::tide_core::Color;

use super::Terminal;

impl Terminal {
    /// Convert a named ANSI color to RGB, respecting dark/light mode.
    pub(crate) fn named_color_to_rgb(dark_mode: bool, named: NamedColor) -> Color {
        if dark_mode {
            Self::named_color_dark(named)
        } else {
            Self::named_color_light(named)
        }
    }

    /// Dark mode ANSI palette
    fn named_color_dark(named: NamedColor) -> Color {
        match named {
            // Normal colors
            NamedColor::Black => Color::rgb(0.1, 0.1, 0.14),
            NamedColor::Red => Color::rgb(1.0, 0.33, 0.33), // #FF5555
            NamedColor::Green => Color::rgb(0.31, 0.98, 0.48), // #50FA7B
            NamedColor::Yellow => Color::rgb(0.94, 0.9, 0.55), // #F0E68D
            NamedColor::Blue => Color::rgb(0.39, 0.58, 1.0), // #6495FF
            NamedColor::Magenta => Color::rgb(0.74, 0.45, 1.0), // #BD73FF
            NamedColor::Cyan => Color::rgb(0.35, 0.87, 0.93), // #59DEED
            NamedColor::White => Color::rgb(0.78, 0.8, 0.87), // #C7CCDE

            // Bright colors
            NamedColor::BrightBlack => Color::rgb(0.4, 0.42, 0.53), // #676B87
            NamedColor::BrightRed => Color::rgb(1.0, 0.47, 0.42),   // #FF786B
            NamedColor::BrightGreen => Color::rgb(0.45, 1.0, 0.6),  // #73FF99
            NamedColor::BrightYellow => Color::rgb(1.0, 0.98, 0.55), // #FFFA8D
            NamedColor::BrightBlue => Color::rgb(0.53, 0.7, 1.0),   // #87B3FF
            NamedColor::BrightMagenta => Color::rgb(0.85, 0.6, 1.0), // #D999FF
            NamedColor::BrightCyan => Color::rgb(0.47, 0.94, 1.0),  // #78F0FF
            NamedColor::BrightWhite => Color::rgb(0.95, 0.96, 0.98), // #F2F5FA

            // Special
            NamedColor::Foreground => Color::rgb(0.9, 0.91, 0.95), // #E6E8F2
            NamedColor::Background => Color::rgb(0.0, 0.0, 0.0),   // Transparent → pane BG shows
            _ => Color::rgb(0.9, 0.91, 0.95),
        }
    }

    /// Light mode ANSI palette — muted colors on white editor background.
    /// White/BrightWhite stay light so they work as background colors.
    fn named_color_light(named: NamedColor) -> Color {
        match named {
            // Normal colors
            NamedColor::Black => Color::rgb(0.18, 0.18, 0.18),
            NamedColor::Red => Color::rgb(0.65, 0.35, 0.35),
            NamedColor::Green => Color::rgb(0.31, 0.50, 0.35),
            NamedColor::Yellow => Color::rgb(0.54, 0.46, 0.26),
            NamedColor::Blue => Color::rgb(0.36, 0.44, 0.62),
            NamedColor::Magenta => Color::rgb(0.49, 0.38, 0.58),
            NamedColor::Cyan => Color::rgb(0.31, 0.49, 0.53),
            NamedColor::White => Color::rgb(0.85, 0.83, 0.80),

            // Bright colors
            NamedColor::BrightBlack => Color::rgb(0.40, 0.38, 0.35),
            NamedColor::BrightRed => Color::rgb(0.72, 0.43, 0.40),
            NamedColor::BrightGreen => Color::rgb(0.39, 0.58, 0.41),
            NamedColor::BrightYellow => Color::rgb(0.62, 0.52, 0.30),
            NamedColor::BrightBlue => Color::rgb(0.43, 0.52, 0.72),
            NamedColor::BrightMagenta => Color::rgb(0.58, 0.45, 0.68),
            NamedColor::BrightCyan => Color::rgb(0.38, 0.57, 0.60),
            NamedColor::BrightWhite => Color::rgb(0.95, 0.93, 0.90),

            // Special
            NamedColor::Foreground => Color::rgb(0.18, 0.18, 0.18),
            NamedColor::Background => Color::rgb(0.0, 0.0, 0.0), // Transparent → pane BG shows
            _ => Color::rgb(0.18, 0.18, 0.18),
        }
    }

    /// Fallback color computation for 256-color palette indices
    pub(crate) fn indexed_color_fallback(idx: u8) -> Color {
        match idx {
            0 => Color::rgb(0.0, 0.0, 0.0),
            1 => Color::rgb(0.8, 0.0, 0.0),
            2 => Color::rgb(0.0, 0.8, 0.0),
            3 => Color::rgb(0.8, 0.8, 0.0),
            4 => Color::rgb(0.0, 0.0, 0.8),
            5 => Color::rgb(0.8, 0.0, 0.8),
            6 => Color::rgb(0.0, 0.8, 0.8),
            7 => Color::rgb(0.75, 0.75, 0.75),
            8 => Color::rgb(0.5, 0.5, 0.5),
            9 => Color::rgb(1.0, 0.0, 0.0),
            10 => Color::rgb(0.0, 1.0, 0.0),
            11 => Color::rgb(1.0, 1.0, 0.0),
            12 => Color::rgb(0.33, 0.33, 1.0),
            13 => Color::rgb(1.0, 0.0, 1.0),
            14 => Color::rgb(0.0, 1.0, 1.0),
            15 => Color::rgb(1.0, 1.0, 1.0),
            // 16-231: 6x6x6 color cube
            16..=231 => {
                let idx = idx - 16;
                let r = idx / 36;
                let g = (idx % 36) / 6;
                let b = idx % 6;
                Color::rgb(
                    if r == 0 {
                        0.0
                    } else {
                        (55.0 + 40.0 * r as f32) / 255.0
                    },
                    if g == 0 {
                        0.0
                    } else {
                        (55.0 + 40.0 * g as f32) / 255.0
                    },
                    if b == 0 {
                        0.0
                    } else {
                        (55.0 + 40.0 * b as f32) / 255.0
                    },
                )
            }
            // 232-255: grayscale ramp
            _ => {
                let v = (8.0 + 10.0 * (idx - 232) as f32) / 255.0;
                Color::rgb(v, v, v)
            }
        }
    }

    /// Convert color using pre-copied palette (no lock needed)
    pub(crate) fn convert_color(
        dark_mode: bool,
        color: &AnsiColor,
        palette: &[Option<AnsiRgb>; 256],
    ) -> Color {
        match color {
            AnsiColor::Named(named) => Self::named_color_to_rgb(dark_mode, *named),
            AnsiColor::Spec(rgb) => Color::rgb(
                rgb.r as f32 / 255.0,
                rgb.g as f32 / 255.0,
                rgb.b as f32 / 255.0,
            ),
            AnsiColor::Indexed(idx) => {
                // Indices 0-15 → route through our named palette (respects dark/light)
                if *idx < 16 {
                    let named = Self::index_to_named(*idx);
                    return Self::named_color_to_rgb(dark_mode, named);
                }
                if let Some(rgb) = palette[*idx as usize] {
                    Color::rgb(
                        rgb.r as f32 / 255.0,
                        rgb.g as f32 / 255.0,
                        rgb.b as f32 / 255.0,
                    )
                } else {
                    Self::indexed_color_fallback(*idx)
                }
            }
        }
    }

    /// In dark mode, ensure foreground colors have sufficient contrast against
    /// the dark pane background. Brightens colors that would be invisible.
    pub(crate) fn ensure_dark_fg_contrast(color: Color) -> Color {
        // Relative luminance of dark pane_bg ≈ (0.055, 0.055, 0.063)
        const BG_LUM: f32 = 0.056;
        const MIN_CONTRAST: f32 = 4.5;

        let fg_lum = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;

        // Only adjust when fg is too dark (low contrast on dark bg)
        let contrast = (fg_lum + 0.05) / (BG_LUM + 0.05);
        if contrast < MIN_CONTRAST {
            // Target luminance for minimum contrast
            let target_lum = MIN_CONTRAST * (BG_LUM + 0.05) - 0.05;
            if fg_lum > 0.01 {
                let scale = target_lum / fg_lum;
                Color::new(
                    (color.r * scale).clamp(0.0, 1.0),
                    (color.g * scale).clamp(0.0, 1.0),
                    (color.b * scale).clamp(0.0, 1.0),
                    color.a,
                )
            } else {
                // Near-black: replace with minimum visible gray
                Color::new(target_lum, target_lum, target_lum, color.a)
            }
        } else {
            color
        }
    }

    /// In light mode, ensure foreground colors have sufficient contrast against
    /// the white editor background. Darkens colors that would be invisible.
    pub(crate) fn ensure_light_fg_contrast(color: Color) -> Color {
        const BG_LUM: f32 = 1.0;
        const MIN_CONTRAST: f32 = 2.1;

        let fg_lum = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;

        // Only adjust when fg is brighter than target (low contrast on light bg)
        let contrast = (BG_LUM + 0.05) / (fg_lum + 0.05);
        if contrast < MIN_CONTRAST {
            // Target luminance for minimum contrast
            let target_lum = (BG_LUM + 0.05) / MIN_CONTRAST - 0.05;
            let scale = if fg_lum > 0.001 {
                (target_lum / fg_lum).min(1.0)
            } else {
                0.15
            };
            Color::new(
                (color.r * scale).clamp(0.0, 1.0),
                (color.g * scale).clamp(0.0, 1.0),
                (color.b * scale).clamp(0.0, 1.0),
                color.a,
            )
        } else {
            color
        }
    }

    /// Remap a dark true-color background for light mode.
    /// Extracts the hue direction from the original color, then applies it
    /// as a subtle tint on the white editor background. Preserves green → green,
    /// red → red, etc.
    pub(crate) fn remap_bg_for_light(color: Color) -> Color {
        let max = color.r.max(color.g).max(color.b).max(0.01);
        let hr = color.r / max;
        let hg = color.g / max;
        let hb = color.b / max;
        // Tint the light pane_bg: subtract more from channels that are NOT dominant
        let strength = 0.10;
        Color::new(
            (1.0 - (1.0 - hr) * strength).clamp(0.0, 1.0),
            (1.0 - (1.0 - hg) * strength).clamp(0.0, 1.0),
            (1.0 - (1.0 - hb) * strength).clamp(0.0, 1.0),
            color.a,
        )
    }

    /// Remap a bright true-color background for dark mode.
    /// Extracts the hue direction, applies it as a subtle tint on the
    /// dark pane_bg.
    pub(crate) fn remap_bg_for_dark(color: Color) -> Color {
        let max = color.r.max(color.g).max(color.b).max(0.01);
        let hr = color.r / max;
        let hg = color.g / max;
        let hb = color.b / max;
        let strength = 0.08;
        Color::new(
            (0.067 + hr * strength).clamp(0.0, 1.0),
            (0.068 + hg * strength).clamp(0.0, 1.0),
            (0.077 + hb * strength).clamp(0.0, 1.0),
            color.a,
        )
    }

    /// Map indexed color 0-15 to the corresponding NamedColor.
    pub(crate) fn index_to_named(idx: u8) -> NamedColor {
        match idx {
            0 => NamedColor::Black,
            1 => NamedColor::Red,
            2 => NamedColor::Green,
            3 => NamedColor::Yellow,
            4 => NamedColor::Blue,
            5 => NamedColor::Magenta,
            6 => NamedColor::Cyan,
            7 => NamedColor::White,
            8 => NamedColor::BrightBlack,
            9 => NamedColor::BrightRed,
            10 => NamedColor::BrightGreen,
            11 => NamedColor::BrightYellow,
            12 => NamedColor::BrightBlue,
            13 => NamedColor::BrightMagenta,
            14 => NamedColor::BrightCyan,
            15 => NamedColor::BrightWhite,
            _ => NamedColor::Foreground,
        }
    }
}
