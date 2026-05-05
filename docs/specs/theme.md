# Spec: Theme

Theme switching and font defaults.

## Bounded Contexts

| Context | Role |
|---------|------|
| `tide-app` | dark_mode flag, font size, cache invalidation |
| `ModalStack` | ConfigPage Appearance section for text-first theme controls |

## Use Cases

### UC-1: ToggleTheme

- **Actor**: User
- **Trigger**: `GlobalAction::ToggleTheme` from the ConfigPage Appearance section or a user-configured keybinding
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
  2. Tide uses VS Code Light-style values for editor background, workbench chrome, separators, text, selection, indent guides, and line numbers.
  3. Tide keeps primary chrome text readable against the light editor surface.
  4. Tide renders FileTree View disclosure chevrons with mode-aware opacity so they are visible in dark mode without becoming loud in light mode.
  5. Tide separates inactive chrome, focused chrome, active tabs, Pane backgrounds, and current-line emphasis with visible light-mode value steps.
- **Postcondition**: Light mode preserves the same visual hierarchy as dark mode.
- **Business Rules**:
  - BR-5: Light mode editor content uses a white `pane_bg`, while surrounding chrome uses a light gray workbench surface.
  - BR-6: Light mode borders use a VS Code Light-style `#D4D4D4` separator rather than warm beige hairlines.
  - BR-7: Light mode primary chrome text must maintain readable contrast on `pane_bg`.
  - BR-8: FileTree View disclosure chevrons must use mode-aware opacity with higher alpha in dark mode than light mode.
  - BR-15: Light mode active tabs must use white editor-surface background with charcoal foreground, while inactive chrome uses muted gray foreground.
  - BR-16: Light mode current-line emphasis and indent guides must use VS Code Light-style neutral gray values.

### UC-4: LightModeEditorText

- **Actor**: System
- **Trigger**: App renders an Editor Pane with markdown or source-code highlighting in light mode
- **Precondition**: `dark_mode = false`
- **Flow**:
  1. Tide selects the light Markdown theme for Markdown live-preview rendering.
  2. Tide selects a restrained Tide light syntax palette for source-code rendering.
  3. Body colors stay readable on the light pane surface, while headings, code, links, badges, and terminal ANSI colors stay lighter than normal foreground text.
  4. Tide strengthens muted light syntax foregrounds and editor support text enough for source identifiers to read with solid weight, without collapsing colored text toward near-black.
- **Postcondition**: Editor text remains legible and calm in light mode.
- **Business Rules**:
  - BR-9: Markdown live-preview rendering must choose `MarkdownTheme` from the active theme mode instead of always using the dark Markdown theme.
  - BR-10: Light Markdown heading and code colors must remain readable while staying lighter than normal foreground text.
  - BR-11: Light syntax highlighting must use the restrained Tide light syntax palette.
  - BR-17: Light syntax highlighting must keep source identifiers readable on `pane_bg` without forcing colored spans toward near-black.
  - BR-18: Light editor support text such as gutter numbers must be darker than low-priority chrome text.
  - BR-19: Light mode accent and semantic colors must stay visibly lighter than normal foreground text so line numbers, links, badges, and terminal ANSI colors do not feel heavy.

### UC-5: ConfigureAppearanceTheme

- **Actor**: User
- **Trigger**: User opens ConfigPage and selects the Appearance section
- **Precondition**: ConfigPage is open
- **Flow**:
  1. Tide renders an Appearance section with a text label for the current theme mode.
  2. Tide renders the next theme action as text instead of exposing a titlebar theme icon.
  3. Pressing Enter or clicking the Appearance theme row invokes `GlobalAction::ToggleTheme`.
- **Postcondition**: The current theme mode is visible in ConfigPage text and theme switching remains keyboard/click reachable.
- **Business Rules**:
  - BR-12: ConfigPage Appearance must expose the current theme as text: `Dark` or `Light`.
  - BR-13: ConfigPage Appearance must expose the next theme action as text: `Switch to Light` or `Switch to Dark`.
  - BR-14: Activating the Appearance theme row must toggle theme through the same `GlobalAction::ToggleTheme` path.

## Tests

| UC | BR | Test |
|----|-----|------|
| UC-1 | BR-1 | `app_starts_in_dark_mode` |
| UC-1 | BR-2 | `toggle_theme_switches_between_dark_and_light` |
| UC-1 | BR-3 | `toggle_theme_clears_all_pane_generations_in_render_cache` |
| UC-2 | BR-4 | `font_size_starts_at_14` |
| UC-3 | BR-5/BR-6/BR-7 | `light_mode_palette_keeps_borders_subtle_and_text_readable` |
| UC-3 | BR-8 | `file_tree_disclosure_chevrons_use_mode_aware_opacity` |
| UC-3 | BR-15/BR-16 | `light_mode_palette_separates_chrome_layers_and_current_line` |
| UC-4 | BR-9 | `editor_live_preview_rendering_uses_mode_aware_markdown_theme` |
| UC-4 | BR-10 | `light_markdown_theme_uses_quiet_readable_colors` |
| UC-4 | BR-11 | `light_syntax_highlighting_uses_tide_light_palette` |
| UC-4 | BR-17 | `light_syntax_highlighting_gives_typescript_source_solid_token_colors` |
| UC-4 | BR-18 | `light_editor_support_text_is_crisper_than_inactive_chrome_text` |
| UC-4 | BR-19 | `light_mode_accent_colors_stay_lighter_than_normal_text_weight` |
| UC-5 | BR-12/BR-13 | `config_page_appearance_theme_uses_text_status` |
| UC-5 | BR-14 | `config_page_appearance_theme_toggle_switches_theme` |

## Location

| Layer | Crate | Key Files |
|-------|-------|-----------|
| Theme | tide-app | `theme.rs`, `domain/editor/highlight.rs`, `domain/editor/markdown.rs`, `domain/pane/editor_rendering.rs`, `adapter/outward/view/chrome/file_tree.rs`, `adapter/outward/view/overlays/config_page.rs` |
| Tests | tide-app | `behavior_tests.rs :: mod theme_behavior` |
