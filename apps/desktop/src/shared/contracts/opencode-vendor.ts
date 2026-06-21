// Process-boundary DTOs for the opencode vendor on-ramp (spec:
// opencode-vendor-onramp.md). opencode is a multi-vendor router; a "vendor" is one
// upstream provider (OpenAI, Anthropic, Qwen, …) the user signs in to with
// `opencode auth login -p <id>`. Auth lives in opencode's machine-global store
// (~/.local/share/opencode/auth.json), shared with the opencode CLI — so a user who
// signed in via their terminal is already connected here, with no import step.

// One vendor tile. `connected`/`method` are read from `opencode auth list` and are
// never fabricated; `popular` marks a curated tile (the rest are connected-but-
// uncurated vendors appended so nothing the user authed is hidden).
export interface OpencodeVendorDto {
  // opencode provider id — exactly what `opencode auth login -p <id>` expects.
  id: string;
  label: string;
  connected: boolean;
  // How it is authed, parsed from `opencode auth list` (e.g. "oauth", "api"). Absent
  // when not connected.
  method?: string;
  // A curated popular tile (shown even when not connected) vs. a vendor surfaced only
  // because it is connected.
  popular?: boolean;
  // Meaningful only when `connected`: true when opencode actually enumerates ≥1 model
  // for this vendor (`opencode models`), false when a credential exists but yields no
  // usable models (e.g. an expired OAuth token) ⇒ the UI shows "Reconnect". Absent ⇒
  // unknown / treated as usable (e.g. the model catalog was unavailable to judge).
  // See docs_v2/specs/opencode-vendor-reconnect.md.
  usable?: boolean;
}

// opencode runtime environment, surfaced where the on-ramp / hub names opencode.
export interface OpencodeEnvironmentDto {
  // `opencode --version` output, when resolvable.
  version?: string;
  // The opencode release Tide is verified against — drives an optional, non-blocking
  // "newer than tested" note. Absent ⇒ no note.
  testedWith?: string;
  // The resolved opencode executable path. Lets the desktop launch the existing
  // provider readiness terminal (`auth login -p <id>`) through the same verbatim-command
  // path the readiness blocker uses, without re-resolving the login-shell PATH.
  executablePath?: string;
}
