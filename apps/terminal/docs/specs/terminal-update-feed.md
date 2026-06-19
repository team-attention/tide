# Spec: Terminal Update Feed

## Overview

### As-Is

- The Rust Tide Terminal release workflow runs on `v*` tags, builds and notarizes
  `Tide-Terminal-${VERSION}.dmg`, then publishes that DMG only to this monorepo's
  GitHub release.
- The Electron Tide app uses a separate update channel: its release workflow
  publishes update-feed artifacts to a dedicated releases repo, while the
  monorepo release remains the human-facing download.
- Tide Terminal has no dedicated update feed artifact and no dedicated releases
  repo path. A future in-app updater polling this monorepo would share release
  history with the Electron Tide app's `tide-v*` releases.

### To-Be

- Tide Terminal keeps the existing `v*` monorepo release as the canonical human
  download.
- The release workflow also publishes the notarized DMG and a machine-readable
  `latest-mac.json` metadata file to a dedicated Terminal Releases Repo:
  `eatnug/tide-terminal-releases`.
- The dedicated repo is the Terminal Update Feed. It is product-specific, so a
  future Tide Terminal updater does not need to filter mixed monorepo releases.
- This slice builds the update-feed path only. It does not add a runtime updater
  framework or a UI affordance inside Tide Terminal.

### Approach

1. Add a release metadata script that writes `target/dist/latest-mac.json` from
   the final DMG path, version, file size, hash, and dedicated release URL.
2. Generate metadata after notarization, so the hash describes the final
   distributed DMG.
3. Publish the DMG and metadata to `eatnug/tide-terminal-releases` with a
   dedicated PAT secret, mirroring the Electron Tide app's dedicated update
   channel.
4. Keep publishing the DMG to this monorepo's `v*` release with the default
   `github.token`.

## Bounded Contexts

| Context | Role |
|---------|------|
| `release workflow` | Builds, signs, notarizes, and publishes Tide Terminal release artifacts |
| `Terminal Update Feed` | Product-specific GitHub release channel consumed by future updater clients |
| `release metadata script` | Produces `latest-mac.json` for the final macOS DMG |

## Use Cases

### UC-1: PublishCanonicalTerminalDownload

- **Actor**: Maintainer
- **Trigger**: Push a `v*` tag
- **Precondition**: Signing and Apple notarization secrets are configured
- **Flow**:
  1. GitHub Actions builds the Tide Terminal `.app`
  2. The workflow signs and notarizes the DMG
  3. The workflow publishes the DMG to this monorepo's `v*` GitHub release
- **Postcondition**: Users can keep downloading Tide Terminal from the existing
  monorepo release page
- **Business Rules**:
  - BR-1: The release workflow must continue to trigger on `v*` tags
  - BR-2: The monorepo release must use the default `github.token`

### UC-2: PublishTerminalUpdateFeed

- **Actor**: Release workflow
- **Trigger**: The notarized DMG exists
- **Precondition**: `DESKTOP_RELEASES_TOKEN` can write to the Terminal Releases Repo
- **Flow**:
  1. The workflow runs the release metadata script for the current version
  2. The script writes `latest-mac.json` beside the DMG
  3. The workflow publishes the DMG and metadata to `eatnug/tide-terminal-releases`
- **Postcondition**: The Terminal Update Feed exposes one product-specific latest
  release path for Tide Terminal updater clients
- **Business Rules**:
  - BR-3: The update-feed release must target `eatnug/tide-terminal-releases`
  - BR-4: The update-feed release must use `DESKTOP_RELEASES_TOKEN`
  - BR-5: The update-feed release must upload both the DMG and `latest-mac.json`
  - BR-6: The metadata must include version, DMG artifact name, size, SHA-256,
    release URL, and download URL
  - BR-7: If no version argument is provided, version discovery must tolerate a
    missing or unmatched `Cargo.toml` and fail through the script's explicit
    version error instead of aborting under `set -euo pipefail`
  - BR-8: SHA-256 generation must use the available platform checksum tool,
    preferring `shasum` and falling back to `sha256sum`
  - BR-9: Workflow behavior tests should assert named release steps and their
    required tokens rather than depending on unrelated YAML formatting

## Invariants

1. The monorepo `v*` release remains the canonical human download.
2. The Terminal Update Feed is product-specific and never relies on filtering
   mixed monorepo releases.
3. The metadata hash is computed from the final notarized DMG.
4. Metadata script failures must be explicit and readable when required inputs
   or checksum tools are unavailable.
5. Runtime updater behavior remains out of scope until a dedicated Tide Terminal
   updater client is specified.

## Tests

| UC | BR | Test function |
|----|----|---------------|
| UC-1 | BR-1, BR-2 | `terminal_release_workflow_keeps_the_monorepo_download_release` |
| UC-2 | BR-3, BR-4, BR-5, BR-9 | `terminal_release_workflow_publishes_the_update_feed_to_the_dedicated_repo` |
| UC-2 | BR-6, BR-8 | `terminal_update_metadata_script_writes_latest_mac_json` |
| UC-2 | BR-7 | `terminal_update_metadata_script_reports_missing_default_version_cleanly` |

## Location

| Module | Path | Change |
|--------|------|--------|
| Release metadata | `scripts/build-update-metadata.sh` | Generate `latest-mac.json` for the notarized DMG |
| Release workflow | `.github/workflows/release.yml` | Publish DMG + metadata to the Terminal Releases Repo and keep the monorepo DMG release |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/terminal_update_feed.rs` | Assert the release path and metadata script contract |
