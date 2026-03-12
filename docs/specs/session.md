# Spec: Session

Session save/load: persist and restore App state across launches.

## Bounded Contexts

| Context | Role |
|---------|------|
| `tide-app` | Session serialization/deserialization |

## Use Cases

### UC-1: SaveLoadSession

- **Actor**: System
- **Trigger**: App quit (save) or App launch (load)
- **Precondition**: None
- **Flow**:
  1. Save: serialize layout, focus, preferences to JSON
  2. Load: deserialize JSON, restore layout and preferences
- **Postcondition**: App state preserved across sessions
- **Business Rules**:
  - BR-1: Session preserves dark_mode preference
  - BR-2: Session preserves file tree visibility and width
  - BR-3: Session without sidebar fields uses defaults (left side, outer position)

## Tests

| UC | BR | Test |
|----|-----|------|
| UC-1 | BR-1 | `session_preserves_dark_mode_preference` |
| UC-1 | BR-2 | `session_preserves_file_tree_visibility` |
| UC-1 | BR-3 | `session_without_sidebar_fields_uses_defaults` |

## Location

| Layer | Crate | Key Files |
|-------|-------|-----------|
| Session | tide-app | `session.rs` |
| Tests | tide-app | `behavior_tests.rs :: mod session_behavior` |
