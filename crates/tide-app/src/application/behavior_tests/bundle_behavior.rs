// Spec: docs/specs/bundle-launch-compatibility.md

// --- UC-1: BuildMultiInstanceTideBundle ---

#[test]
fn source_tide_info_plist_omits_lsmultipleinstancesprohibited() {
    // UC-1 BR-1: The source Tide plist must not declare LSMultipleInstancesProhibited.
    let plist = include_str!("../../../Info.plist");

    assert!(
        !plist.contains("<key>LSMultipleInstancesProhibited</key>"),
        "expected Tide Info.plist to omit LSMultipleInstancesProhibited so multiple Tide instances remain launchable"
    );
}

#[test]
fn source_tide_info_plist_omits_lsrequirescarbon() {
    // UC-1 BR-2: The source Tide plist must not declare LSRequiresCarbon.
    let plist = include_str!("../../../Info.plist");

    assert!(
        !plist.contains("<key>LSRequiresCarbon</key>"),
        "expected Tide Info.plist to omit LSRequiresCarbon for the native AppKit bundle"
    );
}

#[test]
fn local_bundle_build_script_does_not_stamp_lsmultipleinstancesprohibited_before_signing() {
    // UC-1 BR-3: The local Tide.app build path must not stamp LSMultipleInstancesProhibited before signing.
    let script = include_str!("../../../../../scripts/build-app.sh");

    assert!(
        !script.contains("LSMultipleInstancesProhibited"),
        "expected build-app.sh to preserve multi-instance launch behavior and not stamp LSMultipleInstancesProhibited"
    );
}

#[test]
fn local_bundle_build_script_strips_lsrequirescarbon_before_signing() {
    // UC-1 BR-4: The local Tide.app build path must strip LSRequiresCarbon from the bundled plist before signing.
    let script = include_str!("../../../../../scripts/build-app.sh");

    assert!(
        script.contains("Delete :LSRequiresCarbon"),
        "expected build-app.sh to remove LSRequiresCarbon from the bundled Tide.app plist"
    );
}

#[test]
fn local_bundle_build_script_re_signs_tide_app_with_the_stable_bundle_identifier() {
    // UC-1 BR-5: The local Tide.app build path must re-sign Tide.app with the stable bundle identifier.
    let script = include_str!("../../../../../scripts/build-app.sh");

    assert!(
        script.contains("codesign --force --deep --sign - --identifier com.eatnug.tide"),
        "expected build-app.sh to re-sign Tide.app with the stable bundle identifier"
    );
}

// --- UC-2: LaunchIndependentTideInstance ---

#[test]
fn macos_launch_path_does_not_query_existing_tide_instances_before_creating_a_window() {
    // UC-2 BR-6: The macOS startup path must not query existing Tide instances before creating a Window.
    let source = include_str!("../../adapter/outward/platform_adapter/macos/app.rs");

    assert!(
        !source.contains("runningApplicationsWithBundleIdentifier"),
        "expected MacosApp::run to stop querying existing Tide instances before creating a Window"
    );
}

#[test]
fn macos_launch_path_does_not_activate_an_existing_tide_instance_before_creating_a_window() {
    // UC-2 BR-7: The macOS startup path must not activate an existing Tide instance before creating a Window.
    let source = include_str!("../../adapter/outward/platform_adapter/macos/app.rs");

    assert!(
        !source.contains("activateWithOptions"),
        "expected MacosApp::run to stop activating an existing Tide instance before creating a Window"
    );
}

#[test]
fn macos_launch_path_creates_a_window_for_the_new_tide_process() {
    // UC-2 BR-8: The macOS startup path must create a Window for the new Tide process.
    let source = include_str!("../../adapter/outward/platform_adapter/macos/app.rs");

    assert!(
        source.contains("MacosWindow::new"),
        "expected MacosApp::run to create a Window for the new Tide process"
    );
}
