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

## Tests

| UC | BR | Test |
|----|-----|------|
| UC-1 | BR-1 | `app_starts_in_dark_mode` |
| UC-1 | BR-2 | `toggle_theme_switches_between_dark_and_light` |
| UC-1 | BR-3 | `toggle_theme_clears_all_pane_generations_in_render_cache` |
| UC-2 | BR-4 | `font_size_starts_at_14` |

## Location

| Layer | Crate | Key Files |
|-------|-------|-----------|
| Theme | tide-app | `app.rs` |
| Tests | tide-app | `behavior_tests.rs :: mod theme_behavior` |
