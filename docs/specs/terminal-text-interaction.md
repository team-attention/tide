# Spec: Terminal Text Interaction

## Overview

### As-Is
`crates/tide-app/src/application/services/text_extract_service/mod.rs` resolves terminal URL clicks from a single visible row, so a Cmd/Ctrl-click on a URL that visually wraps across multiple terminal rows only extracts the clicked fragment. `crates/tide-app/src/domain/pane/mod.rs` also serializes `Terminal Pane` selections by appending `\n` after every selected visible row, so copying text across a terminal wrap inserts a newline that was not part of the logical terminal output.

### To-Be
`Terminal Pane` text interactions preserve logical terminal output across terminal wraps:

- Cmd/Ctrl-click on any visible row segment of a wrapped URL opens the full URL
- Copying a `Terminal Pane` selection across wrapped visible rows keeps the wrapped rows contiguous
- Copying across an actual terminal line break still preserves the newline

### Approach
1. Reconstruct the logical text cluster around the clicked visible terminal row before resolving URLs.
2. Preserve wrap metadata from the terminal sync path so text interaction code can distinguish terminal wraps from hard line breaks.
3. Update `TerminalPane::selected_text()` to suppress synthetic newlines for wrapped visible rows while preserving real line breaks.
4. Cover the behavior with behavior tests for URL activation and copy serialization.

## Bounded Contexts

| Context | Responsibility |
|---------|----------------|
| `application/services/text_extract_service` | Resolve Cmd/Ctrl-click terminal URLs from visible terminal text. |
| `domain/terminal` | Preserve wrap metadata from the synced visible terminal grid. |
| `domain/pane` | Serialize `Terminal Pane` selections for copy and capture flows. |

## Use Cases

### UC-1: ActivateWrappedTerminalUrl
- **Actor**: User
- **Trigger**: Cmd/Ctrl-click inside a wrapped URL rendered in a `Terminal Pane`
- **Precondition**: The clicked `Pane` is a `Terminal Pane`, and the clicked visible rows belong to one logical wrapped terminal line
- **Flow**:
  1. Tide maps the click to a visible terminal row and column
  2. Tide reconstructs the logical wrapped text cluster for that visible row
  3. Tide resolves the URL containing the clicked column within the logical wrapped text
  4. Tide opens a Browser Pane for the full URL
- **Postcondition**: The Browser Pane receives the full URL, not only the clicked visible-row fragment
- **Business Rules**:
  - BR-1: Clicking any visible-row segment of a wrapped URL opens the full logical URL

### UC-2: CopyWrappedTerminalSelection
- **Actor**: User
- **Trigger**: Copy with a `Terminal Pane` selection active
- **Precondition**: The selection spans one or more visible terminal rows
- **Flow**:
  1. Tide serializes the selected terminal text
  2. Tide checks whether each selected visible row ended because of a terminal wrap or a hard line break
  3. Tide writes the serialized text to the clipboard
- **Postcondition**: Clipboard text matches the logical terminal output for the selected range
- **Business Rules**:
  - BR-2: A wrapped visible row does not insert a newline into copied text
  - BR-3: A non-wrapped visible row preserves a newline in copied text when the selection continues to the next row

## Invariants

1. `Terminal Pane` copy output must remain stable for non-wrapped selections.
2. Wrapped URL resolution must use the same visible terminal rows that the user clicked, not unrelated scrollback rows.
3. Terminal text interaction must not require direct mutation from inward adapters.

## Tests

| UC | BR | Test Function |
|----|----|---------------|
| UC-1 | BR-1 | `cmd_clicking_a_wrapped_terminal_url_opens_the_full_url` |
| UC-2 | BR-2 | `copying_terminal_selection_across_wrapped_rows_omits_the_wrap_newline` |
| UC-2 | BR-3 | `copying_terminal_selection_across_a_hard_line_break_preserves_newline` |

## Location

| What | Where |
|------|-------|
| Wrapped URL extraction | `crates/tide-app/src/application/services/text_extract_service/mod.rs` |
| Terminal wrap metadata | `crates/tide-app/src/domain/terminal/mod.rs` |
| Terminal selection serialization | `crates/tide-app/src/domain/pane/mod.rs` |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/terminal_text_interaction.rs` |
