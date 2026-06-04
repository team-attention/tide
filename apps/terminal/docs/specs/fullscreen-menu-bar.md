# Spec: Fullscreen Menu Bar

## Overview

### As-Is

`MacosApp::run_with_window()` in [crates/tide-app/src/adapter/outward/platform_adapter/macos/app.rs](/Users/you/Workspace/tide/crates/tide-app/src/adapter/outward/platform_adapter/macos/app.rs:43) creates the shared `NSApplication` and starts Tide with `NSApplicationActivationPolicy::Accessory`. `MacosWindow::show_window()` in [crates/tide-app/src/adapter/outward/platform_adapter/macos/window.rs](/Users/you/Workspace/tide/crates/tide-app/src/adapter/outward/platform_adapter/macos/window.rs:770) later promotes the app to `NSApplicationActivationPolicy::Regular` when Tide reveals a `Tide Window`.

Tide never installs an `App Main Menu` on `NSApplication`. A repo-wide search for `NSMenu`, `setMainMenu`, and `mainMenu` inside `crates/tide-app/src/adapter/outward/platform_adapter/macos/` returns no Tide-owned menu setup before this change. That means Tide becomes a regular macOS app window without ever giving AppKit a native menu bar model to reveal in a `Full-Screen Space`.

Apple's AppKit documentation states that `NSApplication.ActivationPolicy.accessory` "doesn't have a menu bar" and that the app menu bar is exposed through `NSApplication.mainMenu`. Tide currently flips to `Regular`, but it never installs that `App Main Menu`, so the user's fullscreen top-edge hover affordance is incomplete.

### To-Be

Tide installs a minimal native `App Main Menu` once per `Tide Instance`. The menu must exist before Tide promotes itself to `NSApplicationActivationPolicy::Regular` and reveals a `Tide Window`.

The installed `App Main Menu` includes the standard top-level roots a macOS app needs to feel native: the Tide app menu plus `File`, `Edit`, `View`, `Window`, and `Help`. Tide also registers the native `Window` and `Help` menus with `NSApplication` so AppKit can attach its standard behaviors.

### Approach

1. Add an `App Main Menu` term to the glossary so the platform behavior has a stable repo term.
2. Add source-based behavior tests that pin one-time `App Main Menu` installation and require `show_window()` to ensure the menu before regular activation.
3. Implement a small menu-builder helper in the macOS `platform` adapter that installs the `App Main Menu` only when `NSApplication.mainMenu` is still empty.
4. Call that helper during app startup and again from `show_window()` so the fullscreen reveal path stays correct even if Tide reaches the reveal path through a different startup sequence later.

## Bounded Contexts

| Context | Path | Role |
|---------|------|------|
| `platform` | `crates/tide-app/src/adapter/outward/platform_adapter/macos/app.rs` | Owns `NSApplication` startup and `App Main Menu` installation |
| `platform` | `crates/tide-app/src/adapter/outward/platform_adapter/macos/window.rs` | Owns `show_window()` and the native reveal/activation sequence |

## Use Cases

### UC-1: InstallAppMainMenuBeforeReveal

- **Actor**: User
- **Trigger**: Tide reveals a `Tide Window`, including inside a `Full-Screen Space`
- **Precondition**: The shared `NSApplication` exists on the main thread
- **Flow**:
  1. Tide prepares to reveal a native `Tide Window`.
  2. Tide ensures the shared `NSApplication` has an `App Main Menu`.
  3. Tide promotes the app to `NSApplicationActivationPolicy::Regular`.
  4. Tide orders the `Tide Window` front and lets AppKit manage fullscreen menu-bar reveal.
- **Postcondition**: A fullscreen Tide reveal happens with a native `App Main Menu` already installed.
- **Business Rules**:
  - BR-1: Tide must install an `App Main Menu` when `NSApplication.mainMenu` is empty.
  - BR-2: `show_window()` must ensure the `App Main Menu` before calling `setActivationPolicy(NSApplicationActivationPolicy::Regular)`.

### UC-2: ExposeStandardMacosMenuRoots

- **Actor**: User
- **Trigger**: The Tide app becomes the active macOS app
- **Precondition**: Tide is running with the shared `NSApplication`
- **Flow**:
  1. Tide builds the native menu bar model.
  2. Tide adds the Tide app menu plus `File`, `Edit`, `View`, `Window`, and `Help` roots.
  3. Tide registers the `Window` and `Help` menus on `NSApplication`.
- **Postcondition**: The visible menu bar has the standard macOS roots Tide needs for native affordance.
- **Business Rules**:
  - BR-3: The `App Main Menu` must expose the Tide app menu plus `File`, `Edit`, `View`, `Window`, and `Help` roots.
  - BR-4: Tide must register native `Window` and `Help` menus on `NSApplication`.

## Invariants

1. Tide still starts with `NSApplicationActivationPolicy::Accessory` until it actually needs to reveal a `Tide Window`.
2. `App Main Menu` installation must be idempotent for a shared `NSApplication`.
3. `show_window()` remains the single place that promotes Tide to `NSApplicationActivationPolicy::Regular` for native reveal.

## Tests

| UC | BR | Test |
|----|----|------|
| UC-1 | BR-1, BR-2 | `macos_show_window_ensures_the_app_main_menu_before_regular_activation` |
| UC-2 | BR-3, BR-4 | `macos_app_main_menu_exposes_standard_macos_menu_roots` |

## Location

| Layer | Path |
|-------|------|
| Spec | `docs/specs/fullscreen-menu-bar.md` |
| Behavior Tests | `crates/tide-app/src/application/behavior_tests/fullscreen_menu_bar_behavior.rs` |
| macOS App | `crates/tide-app/src/adapter/outward/platform_adapter/macos/app.rs` |
| macOS Window Reveal | `crates/tide-app/src/adapter/outward/platform_adapter/macos/window.rs` |
