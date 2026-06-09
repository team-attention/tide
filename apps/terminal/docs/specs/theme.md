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
  2. Tide selects VS Code Light+ role colors for source-code rendering.
  3. Body colors stay readable on the light pane surface, while headings, code, links, badges, and terminal ANSI colors keep clear contrast and role separation.
  4. Tide strengthens light syntax foregrounds and editor support text enough for source identifiers to read with solid weight while preserving token-role color separation.
- **Postcondition**: Editor text remains legible and calm in light mode.
- **Business Rules**:
  - BR-9: Markdown live-preview rendering must choose `MarkdownTheme` from the active theme mode instead of always using the dark Markdown theme.
  - BR-10: Light Markdown heading and code colors must remain readable while following the same VS Code Light+ role-color family as source-code rendering.
  - BR-11: Light syntax highlighting must use VS Code Light+ role colors for common token classes.
  - BR-17: Light syntax highlighting must keep source identifiers readable on `pane_bg` while preserving token-role color separation.
  - BR-18: Light editor support text such as gutter numbers must be darker than low-priority chrome text.
  - BR-19: Light mode accent and semantic colors must stay visibly distinct from normal foreground text so line numbers, links, badges, and terminal ANSI colors do not collapse into gray.
  - BR-25: Light syntax highlighting must produce multiple visibly distinct token colors for representative Rust source while keeping token ink strong enough on a white editor surface.
  - BR-26: Light Markdown theme roles must stay distinct enough for headings, code, links, and body text to read as separate content classes.

### UC-4A: DarkModeEditorText

- **Actor**: System
- **Trigger**: App renders an Editor Pane with source-code or Markdown highlighting in dark mode
- **Precondition**: `dark_mode = true`
- **Flow**:
  1. Tide selects VS Code Dark+ role colors for source-code rendering.
  2. Tide separates common token roles such as keyword, type, function, string, number, macro, and comment.
  3. Tide keeps Markdown headings, links, list markers, inline code, and body text distinct without using neon colors.
- **Postcondition**: Dark editor text has enough chroma and role separation to scan like a modern code editor.
- **Business Rules**:
  - BR-22: Dark syntax highlighting must use VS Code Dark+ role colors instead of a stock low-variance base theme.
  - BR-23: Dark syntax highlighting must produce multiple visibly distinct token colors for representative Rust source.
  - BR-24: Dark Markdown theme roles must be distinct enough for headings, code, links, and body text to read as separate content classes.
  - BR-27: TypeScript (`.ts`/`.mts`/`.cts`) generic type arguments must be colored as types, never as JSX tags. Plain TypeScript has no JSX, so `<…>` is a generic type-argument list (`Promise<T>`, `Array<Map<string, number>>`); a real comparison `a < b` must stay an operator, not start a tag/generic.

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

### UC-6: DarkModeEditorSurface

- **Actor**: System
- **Trigger**: App renders with `dark_mode = true`
- **Precondition**: A Workspace contains an Editor Pane or Terminal Pane
- **Flow**:
  1. Tide uses a dark neutral app background for the outer shell.
  2. Tide uses a slightly lifted document surface for Pane content so the editor does not read as a raw black canvas.
  3. Tide keeps current-line, scrollbar, and indent-guide overlays quiet on top of that surface.
- **Postcondition**: Dark mode feels like a composed desktop editor surface without changing tab chrome.
- **Business Rules**:
  - BR-20: Dark mode `pane_bg` must be visibly lifted from `surface_bg`.
  - BR-21: Dark mode document overlays must stay low-alpha so they do not become broad stripes.

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
| UC-4 | BR-10 | `light_markdown_theme_uses_vscode_light_plus_role_colors` |
| UC-4 | BR-11 | `light_syntax_highlighting_uses_vscode_light_plus_role_colors` |
| UC-4 | BR-17 | `light_syntax_highlighting_gives_typescript_source_solid_token_colors` |
| UC-4 | BR-18 | `light_editor_support_text_is_crisper_than_inactive_chrome_text` |
| UC-4 | BR-19 | `light_mode_accent_colors_stay_lighter_than_normal_text_weight` |
| UC-4 | BR-25 | `light_syntax_highlighting_gives_rust_source_distinct_token_colors` |
| UC-4 | BR-25 | `light_syntax_highlighting_separates_rust_import_blocks_from_plain_text` |
| UC-4 | BR-26 | `light_markdown_theme_separates_content_roles` |
| UC-4A | BR-22 | `dark_syntax_highlighting_uses_vscode_dark_plus_role_colors` |
| UC-4A | BR-23 | `dark_syntax_highlighting_gives_rust_source_distinct_token_colors` |
| UC-4A | BR-24 | `dark_markdown_theme_separates_content_roles` |
| UC-4A | BR-27 | `dark_typescript_generics_color_as_types_not_jsx_tags` |
| UC-5 | BR-12/BR-13 | `config_page_appearance_theme_uses_text_status` |
| UC-5 | BR-14 | `config_page_appearance_theme_toggle_switches_theme` |
| UC-6 | BR-20/BR-21 | `dark_mode_editor_surface_has_document_depth_without_loud_overlays` |

## Location

| Layer | Crate | Key Files |
|-------|-------|-----------|
| Theme | tide-app | `theme.rs`, `domain/editor/highlight.rs`, `domain/editor/markdown.rs`, `domain/pane/editor_rendering.rs`, `adapter/outward/view/chrome/file_tree.rs`, `adapter/outward/view/overlays/config_page.rs` |
| Tests | tide-app | `behavior_tests.rs :: mod theme_behavior` |
