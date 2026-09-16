# Spec: Shortcut Settings
## Overview
### As-Is
ConfigPage lists a subset of GlobalAction, supports recording, and only resets
bound actions using Backspace. Unbound actions are represented with a fake key.
### To-Be
List every GlobalAction, including unassigned actions; search by label or key;
record a replacement; show conflicts; reset a row or all rows to defaults.
### Approach
Use optional Hotkeys, reuse settings persistence, and resolve overrides through
the same KeybindingMap used by Router. Escape cancels capture; closing saves.
## Bounded Contexts
Input owns GlobalAction/Hotkey; ModalStack owns ConfigPage; Workspace service
persists settings; inward adapters route pointer and keyboard actions.
## Use Cases
### UC-1: Configure shortcuts
BR-1: Every serializable GlobalAction appears, including unbound actions.
BR-2: Changing a binding removes its previous key and survives serialization.
BR-3: Conflicting recording leaves both actions unchanged and names the conflict.
BR-4: Individual and all-default resets restore bindings, including unbound ones.
BR-5: Search filters visible rows; recording consumes input without app actions.
## Invariants
No placeholder key may become a real binding. Preserve unrelated settings.
## Tests
UC-1 BR-1..5: catalog completeness, override round-trip, conflict, reset and filter tests.
## Location
Input, ConfigPage, Workspace service, settings view and input adapters.

Recording also accepts function keys (F1–F24). Function keys and Insert must
round-trip through settings serialization; they must never silently disappear
on reload. Bare text keys require a modifier to preserve terminal typing.

## Verification
- Workspace tests: 1,795 passed, 11 explicitly ignored; strict Clippy and
  architecture checks passed. The new ignored windowed test was also run
  explicitly against a development .app bundle and passed.
- Real window: record a New Tab binding without executing it, close Settings,
  invoke the new key, reset all, verify the override stops and Cmd+T works again.
- Development executable launched outside a bundle fails macOS notification
  initialization. Use TIDE_TERMINAL_BIN pointing at the .app's executable for
  the windowed test. No notification runtime change is part of this feature.
