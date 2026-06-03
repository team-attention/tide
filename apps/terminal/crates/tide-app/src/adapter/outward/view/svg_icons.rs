use crate::tide_core::Color;
use crate::tide_renderer::SvgIconPalette;

pub(crate) fn svg_icon_palette(primary: Color, secondary: Color) -> SvgIconPalette {
    SvgIconPalette { primary, secondary }
}

pub(crate) const SVG_ICON_ADD_PANE: &str = r#"
<svg viewBox="0 0 16 16">
  <path d="M8 3.5V12.5M3.5 8H12.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
</svg>
"#;

pub(crate) const SVG_ICON_SPLIT_HORIZONTAL: &str = r#"
<svg viewBox="0 0 16 16">
  <path data-paint="secondary" d="M3 2.8H13V6.6H3Z" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/>
  <path d="M3 9.4H13V13.2H3Z" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/>
  <path data-paint="secondary" d="M5.2 4.7H10.8M5.2 11.3H10.8" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
</svg>
"#;

pub(crate) const SVG_ICON_SPLIT_VERTICAL: &str = r#"
<svg viewBox="0 0 16 16">
  <path data-paint="secondary" d="M3 3H13V13H3Z" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/>
  <path d="M8 3.5V12.5" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round"/>
  <path data-paint="secondary" d="M5.1 6.4V9.6M10.9 6.4V9.6" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linecap="round"/>
</svg>
"#;

pub(crate) const SVG_ICON_ENTER_STACK_MODE: &str = r#"
<svg viewBox="0 0 16 16">
  <path data-paint="secondary" d="M6.1 2.7H13.2V9.3H6.1Z" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/>
  <path d="M2.8 6H9.9V12.7H2.8Z" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/>
  <path data-paint="secondary" d="M4.7 8.4H8.1M4.7 10.4H7.1" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
</svg>
"#;

pub(crate) const SVG_ICON_ENTER_SPLIT_MODE: &str = r#"
<svg viewBox="0 0 16 16">
  <path data-paint="secondary" d="M3 3H13V13H3Z" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/>
  <path d="M8 3.4V12.6M3.4 8H12.6" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/>
  <path data-paint="secondary" d="M5 5.2H6.4M9.6 10.8H11" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
</svg>
"#;

pub(crate) const SVG_ICON_BROWSER: &str = r#"
<svg viewBox="0 0 16 16">
  <circle data-paint="secondary" cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.35"/>
  <path d="M2.8 8H13.2M8 2.7C6.3 4.2 5.5 6 5.5 8S6.3 11.8 8 13.3M8 2.7C9.7 4.2 10.5 6 10.5 8S9.7 11.8 8 13.3" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linecap="round"/>
</svg>
"#;

pub(crate) const SVG_ICON_OPEN_EXTERNAL: &str = r#"
<svg viewBox="0 0 16 16">
  <path data-paint="secondary" d="M3 6.4V13H9.6" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M7 9L12.8 3.2M9.4 3.2H12.8V6.6" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
"#;

pub(crate) const SVG_ICON_CLOSE: &str = r#"
<svg viewBox="0 0 16 16">
  <path d="M4.7 4.7L11.3 11.3M11.3 4.7L4.7 11.3" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>
</svg>
"#;

pub(crate) const SVG_ICON_BROWSER_BACK: &str = r#"
<svg viewBox="0 0 16 16">
  <path d="M9.8 4.2L6 8L9.8 11.8M6.4 8H12.2" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
"#;

pub(crate) const SVG_ICON_BROWSER_FORWARD: &str = r#"
<svg viewBox="0 0 16 16">
  <path d="M6.2 4.2L10 8L6.2 11.8M3.8 8H9.6" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
"#;

pub(crate) const SVG_ICON_BROWSER_REFRESH: &str = r#"
<svg viewBox="0 0 16 16">
  <path data-paint="secondary" d="M12.4 7.2A4.5 4.5 0 1 0 11 10.7" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/>
  <path d="M12.5 3.5V6.5H9.5M3.5 12.5V9.5H6.5" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
"#;

pub(crate) const SVG_ICON_COPY_URL: &str = r#"
<svg viewBox="0 0 16 16">
  <path data-paint="secondary" d="M6 3H12.2V9.8H6Z" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/>
  <path d="M3.8 6.2H10V13H3.8Z" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/>
</svg>
"#;

pub(crate) const SVG_ICON_FOLDER: &str = r#"
<svg viewBox="0 0 16 16">
  <path d="M2.5 5.1H6.1L7.3 6.5H13.5V12.6H2.5Z" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/>
  <path data-paint="secondary" d="M2.5 5.1V3.8H5.8L7 5.1" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
</svg>
"#;

pub(crate) const SVG_ICON_TERMINAL: &str = r#"
<svg viewBox="0 0 16 16">
  <path data-paint="secondary" d="M2.8 3.5H13.2V12.5H2.8Z" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/>
  <path d="M5 6.1L7 8L5 9.9M8.3 10.1H11" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
"#;

pub(crate) const SVG_ICON_RENAME: &str = r#"
<svg viewBox="0 0 16 16">
  <path data-paint="secondary" d="M3 12.7H9.2" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>
  <path d="M4.1 10.9L10.7 4.3L12.7 6.3L6.1 12.9H4.1Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
  <path d="M9.5 5.5L11.5 7.5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
</svg>
"#;

pub(crate) const SVG_ICON_DELETE: &str = r#"
<svg viewBox="0 0 16 16">
  <path d="M5.4 3.2H10.6M3.8 5.2H12.2" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/>
  <path data-paint="secondary" d="M5 5.2L5.6 13H10.4L11 5.2M7 7.2V10.9M9 7.2V10.9" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
"#;

pub(crate) const SVG_ICON_WORKSPACE_RAIL: &str = r#"
<svg viewBox="0 0 16 16">
  <path data-paint="secondary" d="M2.3 2.6H13.7V13.4H2.3Z" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/>
  <path d="M5.7 3.1V12.9" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/>
  <circle cx="3.9" cy="5.1" r="0.7" fill="currentColor"/>
  <circle data-paint="secondary" cx="3.9" cy="8" r="0.6" fill="currentColor"/>
  <circle data-paint="secondary" cx="3.9" cy="10.9" r="0.6" fill="currentColor"/>
  <path d="M7.7 6.1H12M7.7 9.7H11.2" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linecap="round"/>
</svg>
"#;

pub(crate) const SVG_ICON_DOCK_CONTEXT: &str = r#"
<svg viewBox="0 0 16 16">
  <path data-paint="secondary" d="M4.2 2.4H10.3L12.8 4.9V13.6H4.2Z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
  <path d="M10.3 2.6V5H12.7M6.2 7.5H10.3M6.2 10.3H9.5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
"#;

pub(crate) const SVG_ICON_FILE_TREE: &str = r#"
<svg viewBox="0 0 16 16">
  <path data-paint="secondary" d="M2.3 2.6H13.7V13.4H2.3Z" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/>
  <path d="M10.3 3.1V12.9" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/>
  <path d="M3.9 6.1H8.1M3.9 9.7H7.2" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linecap="round"/>
  <circle cx="12.1" cy="5.1" r="0.7" fill="currentColor"/>
  <circle data-paint="secondary" cx="12.1" cy="8" r="0.6" fill="currentColor"/>
  <circle data-paint="secondary" cx="12.1" cy="10.9" r="0.6" fill="currentColor"/>
</svg>
"#;

pub(crate) const SVG_ICON_CONNECT: &str = r#"
<svg viewBox="0 0 16 16">
  <path data-paint="secondary" d="M6.7 5.1L5.7 4.1C4.8 3.2 3.4 3.2 2.5 4.1C1.6 5 1.6 6.4 2.5 7.3L4.1 8.9C5 9.8 6.4 9.8 7.3 8.9L7.8 8.4" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
  <path data-paint="secondary" d="M9.3 10.9L10.3 11.9C11.2 12.8 12.6 12.8 13.5 11.9C14.4 11 14.4 9.6 13.5 8.7L11.9 7.1C11 6.2 9.6 6.2 8.7 7.1L8.2 7.6" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M4.2 11.8L11.8 4.2" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round"/>
</svg>
"#;

pub(crate) const SVG_ICON_SETTINGS: &str = r#"
<svg viewBox="0 0 16 16">
  <circle data-paint="secondary" cx="8" cy="8" r="3.2" fill="none" stroke="currentColor" stroke-width="1.25"/>
  <circle cx="8" cy="8" r="1.1" fill="currentColor"/>
  <path data-paint="secondary" d="M8 2.4V4.1M8 11.9V13.6M2.4 8H4.1M11.9 8H13.6M4 4L5.2 5.2M10.8 10.8L12 12M4 12L5.2 10.8M10.8 5.2L12 4" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>
</svg>
"#;
