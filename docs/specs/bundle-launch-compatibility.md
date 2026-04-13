# Spec: Bundle Launch Compatibility

## Overview

### As-Is

- Tide's local macOS bundle build path is `scripts/build-app.sh`, which runs `cargo bundle --release -p tide-app`, applies `Info.plist` fixups, and ad-hoc signs the resulting `Tide.app`.
- The checked-in source plist at `crates/tide-app/Info.plist` currently carries both `LSMultipleInstancesProhibited` and `LSRequiresCarbon`.
- Tide's macOS startup path in `crates/tide-app/src/adapter/outward/platform_adapter/macos/app.rs` already reuses an existing Tide instance before creating another Window.
- A local Tide.app launch on macOS 26 aborts inside `NSApplication::sharedApplication` before Tide creates a `Window`, so the failure boundary is bundle launch compatibility, not later app logic.

### To-Be

- The checked-in Tide bundle metadata keeps the explicit single-instance Launch Services contract.
- The checked-in Tide bundle metadata omits obsolete Carbon launch keys that are not required for a native AppKit bundle.
- The local Tide.app build path keeps stamping the single-instance key, strips obsolete Carbon launch keys from the bundled plist, and keeps the stable bundle identifier for signing.
- Tide's macOS startup path keeps reusing an existing Tide instance before creating another Window.

### Approach

1. Define the bundle launch compatibility boundary in a dedicated spec and behavior tests.
2. Assert that the checked-in Tide source plist keeps `LSMultipleInstancesProhibited`.
3. Assert that the checked-in Tide source plist omits `LSRequiresCarbon`.
4. Keep the existing build-script and macOS single-instance launch checks.
5. Remove `LSRequiresCarbon` from the checked-in Tide source plist and rebuild the bundle.

## Bounded Contexts

| Context | Role |
|---------|------|
| `bundle` | Owns the checked-in Tide bundle metadata and local bundle build path |
| `platform` | Owns the macOS startup path and existing-instance activation |

## Use Cases

### UC-1: BuildLaunchCompatibleTideBundle

- **Actor**: Tide maintainer
- **Trigger**: A local `Tide.app` bundle is built
- **Precondition**: The checked-in plist and build script are the source of truth for the local bundle
- **Flow**:
  1. Tide reads the checked-in source plist
  2. Tide keeps the single-instance Launch Services key
  3. Tide omits obsolete Carbon launch keys
4. `build-app.sh` stamps the built bundle, strips obsolete Carbon launch keys, and re-signs it
- **Postcondition**: The local Tide bundle metadata is compatible with current native launch expectations
- **Business Rules**:
  - BR-1: The source Tide plist must declare `LSMultipleInstancesProhibited`
  - BR-2: The source Tide plist must not declare `LSRequiresCarbon`
  - BR-3: The local Tide.app build path must stamp `LSMultipleInstancesProhibited` before signing
  - BR-4: The local Tide.app build path must strip `LSRequiresCarbon` from the bundled plist before signing
  - BR-5: The local Tide.app build path must re-sign Tide.app with the stable bundle identifier

### UC-2: ReuseExistingTideInstanceOnLaunch

- **Actor**: Tide app
- **Trigger**: Tide launches while another Tide instance is already running
- **Precondition**: The current process has a valid bundle identifier
- **Flow**:
  1. Tide queries running applications with its bundle identifier
  2. Tide activates the existing Tide instance
  3. Tide exits before creating a second Window
- **Postcondition**: Tide preserves the single-instance launch contract
- **Business Rules**:
  - BR-6: The macOS startup path must query existing Tide instances before creating a Window
  - BR-7: The macOS startup path must activate the existing Tide instance before creating a Window

## Invariants

1. Tide.app remains a native AppKit bundle.
2. Tide.app remains single-instance at the Launch Services layer.
3. The local Tide build path keeps producing a signed `.app` bundle.

## Tests

| UC | BR | Test function |
|----|----|---------------|
| UC-1 | BR-1 | `source_tide_info_plist_declares_lsmultipleinstancesprohibited` |
| UC-1 | BR-2 | `source_tide_info_plist_omits_lsrequirescarbon` |
| UC-1 | BR-3 | `local_bundle_build_script_stamps_lsmultipleinstancesprohibited_before_signing` |
| UC-1 | BR-4 | `local_bundle_build_script_strips_lsrequirescarbon_before_signing` |
| UC-1 | BR-5 | `local_bundle_build_script_stamps_lsmultipleinstancesprohibited_before_signing` |
| UC-2 | BR-6 | `macos_launch_path_reuses_an_existing_tide_instance_before_creating_a_window` |
| UC-2 | BR-7 | `macos_launch_path_reuses_an_existing_tide_instance_before_creating_a_window` |

## Location

| Module | Path | Change |
|--------|------|--------|
| Spec | `docs/specs/bundle-launch-compatibility.md` | Define the bundle launch compatibility contract |
| Bundle metadata | `crates/tide-app/Info.plist` | Remove obsolete Carbon launch metadata while preserving single-instance metadata |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/bundle_behavior.rs` | Verify the checked-in plist, build script, and macOS single-instance launch path |
