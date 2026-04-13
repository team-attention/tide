# Spec: Bundle Launch Compatibility

## Overview

### As-Is

- Tide's local macOS bundle build path is `scripts/build-app.sh`, which runs `cargo bundle --release -p tide-app`, applies `Info.plist` fixups, and ad-hoc signs the resulting `Tide.app`.
- Before this change, the checked-in source plist at `crates/tide-app/Info.plist` declared `LSMultipleInstancesProhibited`.
- Before this change, the local bundle build path in `scripts/build-app.sh` explicitly re-stamped `LSMultipleInstancesProhibited` into the built `Tide.app`.
- Before this change, Tide's macOS startup path in `crates/tide-app/src/adapter/outward/platform_adapter/macos/app.rs` queried `NSRunningApplication`, activated an existing Tide instance with the same bundle identifier, and exited before creating a new Window.
- `GlobalAction::NewWindow` in `crates/tide-app/src/application/services/action_service/mod.rs` spawns another Tide process, so the old single-instance startup guard collapsed both "launch another Tide.app" and "open a new Tide Window" into the same reuse path.

### To-Be

- The checked-in Tide bundle metadata must allow multiple Tide instances.
- The local Tide.app build path must preserve multi-instance launch behavior, strip obsolete Carbon launch keys from the bundled plist, and keep the stable bundle identifier for signing.
- Tide's macOS startup path must always create a new Window for a new Tide process instead of reusing an existing Tide instance.

### Approach

1. Update this spec to describe the multi-instance launch contract.
2. Replace the behavior tests that currently lock in single-instance metadata and single-instance startup reuse.
3. Remove `LSMultipleInstancesProhibited` from the source plist and stop stamping it in the built bundle.
4. Remove the macOS startup reuse guard so a new Tide process always reaches `MacosWindow::new`.
5. Rebuild the local `Tide.app` bundle and re-run behavior tests.

## Bounded Contexts

| Context | Role |
|---------|------|
| `bundle` | Owns the checked-in Tide bundle metadata and local bundle build path |
| `platform` | Owns the macOS startup path for a new Tide process |
| `input` | Owns `GlobalAction::NewWindow`, which launches a new Tide process |

## Use Cases

### UC-1: BuildMultiInstanceTideBundle

- **Actor**: Tide maintainer
- **Trigger**: A local `Tide.app` bundle is built
- **Precondition**: The checked-in plist and build script are the source of truth for the local bundle
- **Flow**:
  1. Tide reads the checked-in source plist
  2. Tide omits single-instance Launch Services metadata
  3. Tide omits obsolete Carbon launch keys
  4. `build-app.sh` preserves the multi-instance launch contract, strips obsolete Carbon launch keys, and re-signs the bundle
- **Postcondition**: The local Tide bundle can launch without Tide-owned single-instance constraints
- **Business Rules**:
  - BR-1: The source Tide plist must not declare `LSMultipleInstancesProhibited`
  - BR-2: The source Tide plist must not declare `LSRequiresCarbon`
  - BR-3: The local Tide.app build path must not stamp `LSMultipleInstancesProhibited` before signing
  - BR-4: The local Tide.app build path must strip `LSRequiresCarbon` from the bundled plist before signing
  - BR-5: The local Tide.app build path must re-sign Tide.app with the stable bundle identifier

### UC-2: LaunchIndependentTideInstance

- **Actor**: Tide app
- **Trigger**: A new Tide process launches while another Tide instance is already running
- **Precondition**: The current process has reached the macOS startup path
- **Flow**:
  1. Tide creates a new Window for the new process
  2. Tide does not query existing Tide instances to reuse them
  3. Tide does not activate another Tide instance and exit before Window creation
- **Postcondition**: A newly launched Tide process owns its own Window lifecycle
- **Business Rules**:
  - BR-6: The macOS startup path must not query existing Tide instances before creating a Window
  - BR-7: The macOS startup path must not activate an existing Tide instance before creating a Window
  - BR-8: The macOS startup path must create a Window for the new Tide process

## Invariants

1. Tide.app remains a native AppKit bundle.
2. The local Tide build path keeps producing a signed `.app` bundle.
3. A new Tide process must not be short-circuited into another Tide instance before Window creation.

## Tests

| UC | BR | Test function |
|----|----|---------------|
| UC-1 | BR-1 | `source_tide_info_plist_omits_lsmultipleinstancesprohibited` |
| UC-1 | BR-2 | `source_tide_info_plist_omits_lsrequirescarbon` |
| UC-1 | BR-3 | `local_bundle_build_script_does_not_stamp_lsmultipleinstancesprohibited_before_signing` |
| UC-1 | BR-4 | `local_bundle_build_script_strips_lsrequirescarbon_before_signing` |
| UC-1 | BR-5 | `local_bundle_build_script_re_signs_tide_app_with_the_stable_bundle_identifier` |
| UC-2 | BR-6 | `macos_launch_path_does_not_query_existing_tide_instances_before_creating_a_window` |
| UC-2 | BR-7 | `macos_launch_path_does_not_activate_an_existing_tide_instance_before_creating_a_window` |
| UC-2 | BR-8 | `macos_launch_path_creates_a_window_for_the_new_tide_process` |

## Location

| Module | Path | Change |
|--------|------|--------|
| Spec | `docs/specs/bundle-launch-compatibility.md` | Define the multi-instance Tide bundle launch contract |
| Bundle metadata | `crates/tide-app/Info.plist` | Remove Tide-owned single-instance metadata |
| Build script | `scripts/build-app.sh` | Preserve multi-instance launch behavior while stripping obsolete Carbon metadata and signing |
| Platform adapter | `crates/tide-app/src/adapter/outward/platform_adapter/macos/app.rs` | Remove existing-instance reuse before Window creation |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/bundle_behavior.rs` | Verify the plist, build script, and startup path follow the multi-instance contract |
