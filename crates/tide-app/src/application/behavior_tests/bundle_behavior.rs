// Spec: docs/specs/bundle-launch-compatibility.md

// --- UC-1: BuildLaunchCompatibleTideBundle ---

#[test]
fn source_tide_info_plist_declares_lsmultipleinstancesprohibited() {
    // UC-1 BR-1: The source Tide Info.plist declares LSMultipleInstancesProhibited.
    let plist = include_str!("../../../Info.plist");

    assert!(
        plist.contains("<key>LSMultipleInstancesProhibited</key>")
            && plist.contains("<key>LSMultipleInstancesProhibited</key>\n  <true/>"),
        "expected Tide Info.plist to prohibit multiple instances via Launch Services"
    );
}

#[test]
fn source_tide_info_plist_omits_lsrequirescarbon() {
    // UC-1 BR-2: The source Tide Info.plist omits LSRequiresCarbon.
    let plist = include_str!("../../../Info.plist");

    assert!(
        !plist.contains("<key>LSRequiresCarbon</key>"),
        "expected Tide Info.plist to omit LSRequiresCarbon for the native AppKit bundle"
    );
}

#[test]
fn local_bundle_build_script_stamps_lsmultipleinstancesprohibited_before_signing() {
    // UC-1 BR-3,5: The local Tide.app build path stamps single-instance metadata before signing and re-signs the bundle.
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
fn local_bundle_build_script_strips_lsrequirescarbon_before_signing() {
    // UC-1 BR-4: The local Tide.app build path strips LSRequiresCarbon before signing.
    let script = include_str!("../../../../../scripts/build-app.sh");

    assert!(
        script.contains("Delete :LSRequiresCarbon"),
        "expected build-app.sh to remove LSRequiresCarbon from the bundled Tide.app plist"
    );
}

// --- UC-2: ReuseExistingTideInstanceOnLaunch ---

#[test]
fn macos_launch_path_reuses_an_existing_tide_instance_before_creating_a_window() {
    // UC-2 BR-6,7: The macOS startup path reuses an existing Tide instance
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
