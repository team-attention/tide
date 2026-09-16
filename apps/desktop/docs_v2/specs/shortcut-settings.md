# Spec: Shortcut Settings
## Scope
Settings shows searchable app shortcuts, key recording, individual reset and
Reset all to defaults. Applies immediately and persists across app restarts.
## Evidence
Native menus own pane toggles/zoom/close; renderer handlers own search, composer,
thread navigation and editor save. UI prefs are persisted by Electron Main.
## Decisions
Use one shared shortcut catalog for labels, defaults and matching. Native menu
accelerators and renderer handlers read the same overrides. Reject conflicting
bindings with the action name; never silently steal another command. Escape
cancels recording. Capture suppresses normal app commands, including menu keys.
Preserve OS/text editing navigation semantics; identify those as system controls
in the list. No provider CLI or embedded website keymaps are rewritten.
## Out Of Scope
Multi-key chords and provider/website-owned bindings.
## Domain Model
Shortcut definition, scope, default accelerators and optional override.
## Contracts
UI preference key tide.shortcuts; recording and preference-change preload events.
## Flow
Settings → record → validate → save → native menu and renderer update.
## Invariants
Old key stops triggering after rebind. Reset deletes overrides, including aliases.
IME composition never records or invokes app shortcuts. No unrelated prefs reset.
## Tests
Catalog/matching, conflict, capture cancellation, persistence, per-row/all reset,
native menu synchronization, renderer routing, and settings component interaction.
## Implementation Notes
Reuse existing Settings styling and preference storage. Keep registry pure and
renderer capture logic outside domain code.

## Verification
- Desktop: 1,497 tests passed, 2 skipped; typecheck and production build passed.
- Mounted Settings test covers conflict feedback, Escape cancellation, recording,
  preference persistence, old-key removal, individual reset and all-default reset.
- Real Electron app smoke recorded Cmd+Shift+Y for Toggle left rail, verified the
  native menu accelerator and persisted preference, and reset all defaults.
- Native edit fallback suppression is scoped to the host window, preserving
  Browser Runtime ownership. Menu-capture suppression is released on cancel,
  blur and unmount. Customized thread keys suppress stale Option-number badges.
- Catalog owns command metadata/matching; Settings owns recording/UI; preference
  adapter owns persistence; menu/window wiring owns native accelerators.
