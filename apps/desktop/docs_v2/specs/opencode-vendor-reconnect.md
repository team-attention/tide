# Spec: opencode authed-but-unusable vendor → Reconnect

## Scope
Reconcile the opencode vendor on-ramp's "Connected" status with what opencode can
ACTUALLY serve, so a vendor whose credential exists but yields no usable models
(e.g. an expired OAuth token) is shown as needing reconnect instead of a misleading
green "Connected".

## Evidence
- `opencode auth list` reports a credential's EXISTENCE, not its validity. A user
  with an expired Anthropic OAuth token still shows `● Anthropic oauth`.
- `opencode models` only enumerates providers it can actually use. With the same
  expired token, `opencode models anthropic` → `Provider not found: anthropic` and
  anthropic is absent from the full list (verified 2026-06-16; the token's
  `auth.json` `expires` was 2026-01-03, ~5 months past).
- So the vendor on-ramp (built from `auth list`) said "Connected" while the model
  picker (built from `opencode models`) had no anthropic group — the user's report.
- This corrects the earlier "anthropic-OAuth absent from models (quirk)" note in
  [[v2-opencode-model-vendor-selection]]: the real cause was an expired token, not
  OAuth per se. openai (valid token) appears in both.

## Decisions
- A connected vendor is **usable** when opencode enumerates ≥1 model whose `vendor`
  segment matches the vendor id. When connected but NOT usable → "Reconnect".
- Reconnect reuses the existing connect path (the per-vendor method sheet →
  `opencode auth login -p <id>` browser flow, or paste-an-API-key). No new auth code.
- If the model catalog is EMPTY (e.g. `opencode models` timed out), we have no
  signal → leave connected vendors as-is (never show spurious "Reconnect").
- User chose this over "list models anyway" (false promise) and "hide the badge".

## Out Of Scope
- Auto-refreshing opencode tokens (opencode owns that).
- Surfacing per-model availability inside the model picker (the picker already only
  lists usable models; that is correct).

## Contracts
- `OpencodeVendorDto.usable?: boolean` — meaningful only when `connected`. Absent ⇒
  treated as usable (back-compat / unknown).

## Flow
1. Backend `provider-detection.enumerateOpencodeVendors()` cross-references the
   model catalog (`enumerateOpencodeModels()`) via the pure
   `reconcileVendorUsability(vendors, models)` and sets `usable` per connected vendor.
2. `thread.listed` carries `usable` in `opencodeVendors`.
3. Renderer maps it through `events.ts` → `setOpencodeVendors` → onramp vendor view.
4. `OpencodeConnectPanel` renders a "Reconnect" tile (clickable, opens the method
   sheet) for `connected && usable === false`; plain "Connected" otherwise.
5. `isOpencodeUsable()` requires a vendor that is connected AND not-unusable (or a
   concrete model), so a sole expired vendor opens the on-ramp, not an empty menu.

## Invariants
- `connected`/`method` are still read verbatim from `auth list` (never fabricated).
- A non-connected vendor is unaffected (still "Connect").

## Tests
- `reconcileVendorUsability`: connected+has-models ⇒ usable true; connected+no-models
  (non-empty catalog) ⇒ usable false; empty catalog ⇒ unchanged; non-connected
  untouched.
- `isOpencodeUsable`: only an expired (usable:false) vendor connected + no concrete
  models ⇒ false.

## Implementation Notes
- Model `vendor` segment is the opencode provider id (`anthropic`, `openai`), which
  matches the vendor tile id — no mapping needed.
