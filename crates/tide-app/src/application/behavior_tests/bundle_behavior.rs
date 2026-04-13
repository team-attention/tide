// Spec: docs/specs/agent-notification-routing.md

// --- UC-12: PreventSecondLaunchOnNotificationActivation ---

#[test]
fn source_tide_info_plist_declares_lsmultipleinstancesprohibited() {
    // UC-12 BR-37: The source Tide Info.plist declares LSMultipleInstancesProhibited.
    let plist = include_str!("../../../Info.plist");

    assert!(
        plist.contains("<key>LSMultipleInstancesProhibited</key>")
            && plist.contains("<key>LSMultipleInstancesProhibited</key>\n  <true/>"),
        "expected Tide Info.plist to prohibit multiple instances via Launch Services"
    );
}

#[test]
fn local_bundle_build_script_stamps_lsmultipleinstancesprohibited_before_signing() {
    // UC-12 BR-38: The local Tide.app build path stamps single-instance metadata before signing.
    let script = include_str!("../../../../../scripts/build-app.sh");

    assert!(
        script.contains("LSMultipleInstancesProhibited"),
        "expected build-app.sh to stamp LSMultipleInstancesProhibited into the built Tide.app"
    );
    assert!(
        script.contains("codesign --force --deep --sign - --identifier com.eatnug.tide"),
        "expected build-app.sh to re-sign Tide.app with the stable bundle identifier"
    );
}

#[test]
fn macos_launch_path_reuses_an_existing_tide_instance_before_creating_a_window() {
    // UC-12 BR-41: The macOS startup path reuses an existing Tide instance
    // before creating a second Window.
    let source = include_str!("../../adapter/outward/platform_adapter/macos/app.rs");

    let reuse_guard = source
        .find("runningApplicationsWithBundleIdentifier")
        .expect("expected MacosApp::run to query existing Tide instances");
    let activate_existing = source
        .find("activateWithOptions")
        .expect("expected MacosApp::run to activate an existing Tide instance");
    let create_window = source
        .find("MacosWindow::new")
        .expect("expected MacosApp::run to create a Tide window");

    assert!(
        reuse_guard < create_window,
        "expected Tide to check for an existing instance before creating a Window"
    );
    assert!(
        activate_existing < create_window,
        "expected Tide to activate the existing instance before creating a Window"
    );
}
