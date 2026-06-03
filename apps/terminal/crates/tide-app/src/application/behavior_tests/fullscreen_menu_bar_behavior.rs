// Spec: docs/specs/fullscreen-menu-bar.md

// --- UC-1: InstallAppMainMenuBeforeReveal ---

#[test]
fn macos_show_window_ensures_the_app_main_menu_before_regular_activation() {
    // UC-1 BR-1, BR-2: Tide installs the App Main Menu and ensures it before Regular activation.
    let app_source = include_str!("../../adapter/outward/platform_adapter/macos/app.rs");
    let window_source = include_str!("../../adapter/outward/platform_adapter/macos/window.rs");

    assert!(app_source.contains("pub(crate) fn ensure_app_main_menu("));
    assert!(app_source.contains("app.mainMenu().is_some()"));
    assert!(app_source.contains("app.setMainMenu(Some(&menu_bar))"));

    let show_start = window_source
        .find("fn show_window(&self)")
        .expect("expected MacosWindow::show_window");
    let show_body = &window_source[show_start..];
    let ensure_idx = show_body
        .find("super::app::ensure_app_main_menu(self.mtm);")
        .expect("expected show_window() to ensure the App Main Menu");
    let activation_idx = show_body
        .find("app.setActivationPolicy(NSApplicationActivationPolicy::Regular);")
        .expect("expected show_window() to promote Tide to Regular");

    assert!(
        ensure_idx < activation_idx,
        "expected show_window() to install the App Main Menu before Regular activation"
    );
}

// --- UC-2: ExposeStandardMacosMenuRoots ---

#[test]
fn macos_app_main_menu_exposes_standard_macos_menu_roots() {
    // UC-2 BR-3, BR-4: Tide builds the App Main Menu with standard roots and registers Window/Help menus.
    let app_source = include_str!("../../adapter/outward/platform_adapter/macos/app.rs");

    assert!(app_source.contains("\"About Tide\""));
    assert!(app_source.contains("\"Hide Tide\""));
    assert!(app_source.contains("\"Quit Tide\""));
    assert!(app_source.contains("add_menu_root(&menu_bar, mtm, \"File\")"));
    assert!(app_source.contains("add_menu_root(&menu_bar, mtm, \"Edit\")"));
    assert!(app_source.contains("add_menu_root(&menu_bar, mtm, \"View\")"));
    assert!(app_source.contains("let window_menu = add_menu_root(&menu_bar, mtm, \"Window\")"));
    assert!(app_source.contains("let help_menu = add_menu_root(&menu_bar, mtm, \"Help\")"));
    assert!(app_source.contains("app.setWindowsMenu(Some(&window_menu))"));
    assert!(app_source.contains("app.setHelpMenu(Some(&help_menu))"));
}
