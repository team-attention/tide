# Spec: Search

In-pane text search: query input, match finding, and result navigation.

## Bounded Contexts

| Context | Role |
|---------|------|
| `tide-app` | SearchState per Pane, search_focus tracking |

## Use Cases

### UC-1: ExecuteSearch

- **Actor**: User
- **Trigger**: Type query in search bar
- **Precondition**: Search bar is open on a Pane
- **Flow**:
  1. User types query text
  2. execute_search_editor() scans all lines for matches
  3. Matches stored with line/col/len
  4. Current match index set
- **Postcondition**: All occurrences found and navigable
- **Business Rules**:
  - BR-1: New SearchState has empty input and no matches
  - BR-2: Search finds all occurrences across lines
  - BR-3: Empty search query clears all matches

### UC-2: NavigateMatches

- **Actor**: User
- **Trigger**: Next/Prev match action (Cmd+G / Cmd+Shift+G)
- **Precondition**: Matches exist
- **Flow**:
  1. next_match() → increment current index
  2. prev_match() → decrement current index
  3. Wrap around at boundaries
- **Postcondition**: Current match index updated
- **Business Rules**:
  - BR-4: Display shows "0/0" when no matches
  - BR-5: next_match wraps from last to first
  - BR-6: prev_match wraps from first to last

## Tests

| UC | BR | Test |
|----|-----|------|
| UC-1 | BR-1 | `new_search_state_has_empty_input` |
| UC-1 | BR-2 | `search_in_editor_finds_all_occurrences` |
| UC-1 | BR-3 | `empty_search_query_clears_matches` |
| UC-2 | BR-4 | `search_display_shows_zero_of_zero_when_empty` |
| UC-2 | BR-5 | `next_match_wraps_around_from_last_to_first` |
| UC-2 | BR-6 | `prev_match_wraps_around_from_first_to_last` |

## Location

| Layer | Crate | Key Files |
|-------|-------|-----------|
| Search | tide-app | `search.rs` |
| Tests | tide-app | `behavior_tests.rs :: mod search_behavior` |
