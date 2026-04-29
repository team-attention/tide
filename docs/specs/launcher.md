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

### UC-2: ClickLauncherChoice

- **Actor**: User
- **Trigger**: User clicks a visible choice row inside a Launcher Pane
- **Precondition**: A visible Pane is `PaneKind::Launcher`
- **Flow**:
  1. Tide computes Launcher choice row geometry from the visible Launcher Pane content rect and `Cell Size`.
  2. Tide hit-tests the pointer against the shared Launcher choice row geometry.
  3. Tide resolves the clicked row to the matching `LauncherChoice`.
  4. Tide calls the existing `resolve_launcher` path, replacing the Launcher Pane in-place.
- **Postcondition**: The clicked Launcher choice becomes the concrete `PaneKind` without requiring keyboard input.
- **Business Rules**:
  - BR-7: Clicking the Browser Launcher choice resolves the Launcher Pane to `PaneKind::Browser`.
  - BR-8: Hovering a Launcher choice row produces a `HoverTarget::LauncherChoice` pointer target.
  - BR-9: Launcher rendering and Launcher click hit-testing use the same choice row geometry.
  - BR-10: Clicking inside a visible Launcher choice icon area resolves the same `LauncherChoice` as clicking the row text.

## Tests

| UC | BR | Test |
|----|-----|------|
| UC-1 | BR-1 | `pressing_e_in_launcher_pane_resolves_to_editor_pane_kind` |
| UC-1 | BR-2 | `pressing_capital_e_in_launcher_pane_resolves_to_editor_pane_kind` |
| UC-1 | BR-3 | `korean_ime_commit_resolves_launcher_pane_to_editor_pane_kind` |
| UC-1 | BR-4 | `korean_ime_preedit_resolves_launcher_pane_to_terminal_pane_kind` |
| UC-1 | BR-5 | `non_matching_text_in_launcher_pane_is_ignored` |
| UC-1 | BR-6 | `resolve_launcher_queues_ime_proxy_remove_and_create_for_same_id` |
| UC-2 | BR-7 | `clicking_browser_launcher_choice_resolves_to_browser_pane_kind` |
| UC-2 | BR-8 | `hovering_launcher_choice_returns_launcher_choice_target` |
| UC-2 | BR-9 | `launcher_choice_hit_testing_uses_rendered_choice_rects` |
| UC-2 | BR-10 | `clicking_launcher_choice_icon_area_resolves_that_choice` |

## Location

| Layer | Crate | Key Files |
|-------|-------|-----------|
| Launcher | tide-app | `application/services/pane_create_service/mod.rs`, `adapter/outward/view/launcher.rs`, `adapter/inward/click_adapter/pane.rs`, `adapter/inward/click_adapter/hit_test.rs` |
| Tests | tide-app | `application/behavior_tests/launcher_behavior.rs` |
