# Spec: Launcher

Launcher Pane resolution: how a placeholder Pane becomes a concrete PaneKind.

## Bounded Contexts

| Context | Role |
|---------|------|
| `tide-app` | Hosts Launcher, resolves to concrete PaneKind |

## Use Cases

### UC-1: ResolveLauncher

- **Actor**: User
- **Trigger**: Key press in Launcher (T/E/O/B or Korean IME equivalent)
- **Precondition**: Focused Pane is a Launcher
- **Flow**:
  1. Match input character to LauncherChoice:
     - 'e'/'E'/'ㄷ' → NewFile (Editor)
     - 't'/'T'/'ㅅ' → Terminal (via preedit for Korean)
     - 'o'/'O' → OpenFile
     - 'b'/'B' → Browser
  2. Replace PaneKind::Launcher with resolved PaneKind in-place
  3. Queue IME proxy removal (old) and creation (new) for same PaneId
- **Postcondition**: Launcher replaced by concrete PaneKind
- **Business Rules**:
  - BR-1: 'e' resolves to Editor PaneKind
  - BR-2: 'E' (capital) also resolves to Editor
  - BR-3: Korean jamo 'ㄷ' (mapped to 'e' key) resolves to Editor
  - BR-4: Korean jamo 'ㅅ' (mapped to 't' key) resolves to Terminal via preedit
  - BR-5: Non-matching text is ignored (Launcher remains)
  - BR-6: Resolution queues IME proxy remove + create for same PaneId

## Tests

| UC | BR | Test |
|----|-----|------|
| UC-1 | BR-1 | `pressing_e_in_launcher_pane_resolves_to_editor_pane_kind` |
| UC-1 | BR-2 | `pressing_capital_e_in_launcher_pane_resolves_to_editor_pane_kind` |
| UC-1 | BR-3 | `korean_ime_commit_resolves_launcher_pane_to_editor_pane_kind` |
| UC-1 | BR-4 | `korean_ime_preedit_resolves_launcher_pane_to_terminal_pane_kind` |
| UC-1 | BR-5 | `non_matching_text_in_launcher_pane_is_ignored` |
| UC-1 | BR-6 | `resolve_launcher_queues_ime_proxy_remove_and_create_for_same_id` |

## Location

| Layer | Crate | Key Files |
|-------|-------|-----------|
| Launcher | tide-app | `action/pane_lifecycle.rs` |
| Tests | tide-app | `behavior_tests.rs :: mod launcher_behavior` |
