# Spec: Theme

Theme switching and font defaults.

## Bounded Contexts

| Context | Role |
|---------|------|
| `tide-app` | dark_mode flag, font size, cache invalidation |

## Use Cases

### UC-1: ToggleTheme

- **Actor**: User
- **Trigger**: GlobalAction::ToggleTheme
- **Precondition**: App is running
- **Flow**:
  1. Flip dark_mode boolean
  2. Clear all pane_generations (force full redraw with new colors)
- **Postcondition**: Theme switched, all Panes re-rendered
- **Business Rules**:
  - BR-1: App starts in dark mode
  - BR-2: Toggle switches between dark and light
  - BR-3: Toggle clears all pane_generations in RenderCache

### UC-2: FontDefaults

- **Actor**: System
- **Trigger**: App initialization
- **Business Rules**:
  - BR-4: Font size starts at 14

### UC-3: LightModeChrome

- **Actor**: System
- **Trigger**: App renders with `dark_mode = false`
- **Precondition**: A Workspace contains Stage, Terminal Context Surface, and FileTree View chrome
- **Flow**:
  1. Tide uses the `LIGHT` palette for surfaces, text, borders, and chrome accents.
  2. Tide keeps major-region gaps close to the surrounding surface color so borders read as hairline structure, not thick brown rails.
  3. Tide keeps primary chrome text readable against the light pane surface.
  4. Tide renders FileTree View disclosure chevrons with mode-aware opacity so they are visible in dark mode without becoming loud in light mode.
- **Postcondition**: Light mode preserves the same visual hierarchy as dark mode.
- **Business Rules**:
  - BR-5: Light mode major-region gap color must stay visually close to `pane_bg`.
  - BR-6: Light mode subtle borders must stay low-alpha and neutral.
  - BR-7: Light mode primary chrome text must maintain readable contrast on `pane_bg`.
  - BR-8: FileTree View disclosure chevrons must use mode-aware opacity with higher alpha in dark mode than light mode.

### UC-4: LightModeEditorText

- **Actor**: System
- **Trigger**: App renders an Editor Pane with markdown or source-code highlighting in light mode
- **Precondition**: `dark_mode = false`
- **Flow**:
  1. Tide selects the light Markdown theme for Markdown live-preview rendering.
  2. Tide selects a restrained light syntax-highlighting theme for source-code rendering.
  3. Heading, code, and body colors stay readable without neon saturation on the light pane surface.
- **Postcondition**: Editor text remains legible and calm in light mode.
- **Business Rules**:
  - BR-9: Markdown live-preview rendering must choose `MarkdownTheme` from the active theme mode instead of always using the dark Markdown theme.
  - BR-10: Light Markdown heading and code colors must remain darker than the light pane surface.
  - BR-11: Light syntax highlighting must use the restrained `base16-ocean.light` theme.

## Tests

| UC | BR | Test |
|----|-----|------|
| UC-1 | BR-1 | `app_starts_in_dark_mode` |
| UC-1 | BR-2 | `toggle_theme_switches_between_dark_and_light` |
| UC-1 | BR-3 | `toggle_theme_clears_all_pane_generations_in_render_cache` |
| UC-2 | BR-4 | `font_size_starts_at_14` |
| UC-3 | BR-5/BR-6/BR-7 | `light_mode_palette_keeps_borders_subtle_and_text_readable` |
| UC-3 | BR-8 | `file_tree_disclosure_chevrons_use_mode_aware_opacity` |
| UC-4 | BR-9 | `editor_live_preview_rendering_uses_mode_aware_markdown_theme` |
| UC-4 | BR-10 | `light_markdown_theme_uses_quiet_readable_colors` |
| UC-4 | BR-11 | `light_syntax_highlighting_uses_base16_ocean_theme` |

## Location

| Layer | Crate | Key Files |
|-------|-------|-----------|
| Theme | tide-app | `theme.rs`, `domain/editor/highlight.rs`, `domain/editor/markdown.rs`, `domain/pane/editor_rendering.rs`, `adapter/outward/view/chrome/file_tree.rs` |
| Tests | tide-app | `behavior_tests.rs :: mod theme_behavior` |
