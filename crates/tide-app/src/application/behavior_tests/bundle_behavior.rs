// Spec: docs/specs/window-launch.md
use crate::application::ports::inward::ActionPort;
use crate::application::ports::outward::process_port::ProcessPort;
use crate::tide_input::GlobalAction;
use crate::tide_platform::WindowCommand;
use crate::App;
use std::cell::Cell;
use std::io;
use std::path::Path;
use std::rc::Rc;

fn test_app() -> App {
    let mut app = App::new();
    app.window.cached_cell_size = crate::tide_core::Size::new(8.0, 16.0);
    app.window.window_size = (960, 640);
    app
}

#[derive(Clone)]
struct RecordingProcess {
    launched_windows: Rc<Cell<u32>>,
}

impl ProcessPort for RecordingProcess {
    fn open_with_default_app(&self, _path: &Path) -> io::Result<()> {
        Ok(())
    }

    fn reveal_in_finder(&self, _path: &Path) -> io::Result<()> {
        Ok(())
    }

    fn open_url(&self, _url: &str) -> io::Result<()> {
        Ok(())
    }

    fn launch_new_tide_window(&self) -> io::Result<()> {
        self.launched_windows
            .set(self.launched_windows.get().saturating_add(1));
        Ok(())
    }
}

// --- UC-1: DispatchNewWindowGlobalAction ---

#[test]
fn new_window_global_action_queues_create_window_without_process_launch() {
    // single-process-multi-window UC-1 BR-2, BR-3: NewWindow requests an in-process Tide Window.
    let mut app = test_app();
    let launched_windows = Rc::new(Cell::new(0));
    app.ports.process = Box::new(RecordingProcess {
        launched_windows: Rc::clone(&launched_windows),
    });

    app.handle_global_action(GlobalAction::NewWindow);

    assert_eq!(launched_windows.get(), 0);
    assert!(matches!(
        app.pending_platform_commands.last(),
        Some(WindowCommand::CreateWindow)
    ));
}

#[test]
fn system_process_prefers_open_n_for_bundled_tide_windows() {
    // UC-1 BR-2: `SystemProcess` prefers `open -n <Tide.app>` for bundled Tide launches.
    let source = include_str!("../../adapter/outward/process_adapter/mod.rs");

    assert!(source.contains("fn launch_new_tide_window(&self)"));
    assert!(source.contains("std::env::current_exe()"));
    assert!(source.contains("std::process::Command::new(\"open\")"));
    assert!(source.contains(".arg(\"-n\")"));
}

// --- UC-2: LaunchAnotherBundledTideWindow ---

#[test]
fn source_tide_info_plist_does_not_prohibit_multiple_instances() {
    // UC-2 BR-3: The source Tide `Info.plist` must not declare `LSMultipleInstancesProhibited`.
    let plist = include_str!("../../../Info.plist");

    assert!(
        !plist.contains("<key>LSMultipleInstancesProhibited</key>"),
        "expected Tide Info.plist to allow multiple Tide windows"
    );
}

#[test]
fn local_bundle_build_script_does_not_stamp_lsmultipleinstancesprohibited_before_signing() {
    // UC-2 BR-4: The local Tide.app build path must not stamp `LSMultipleInstancesProhibited`.
    let script = include_str!("../../../../../scripts/build-app.sh");

    assert!(
        !script.contains("LSMultipleInstancesProhibited"),
        "expected build-app.sh not to stamp single-instance metadata into Tide.app"
    );
    assert!(
        script.contains("codesign --force --deep --sign - --identifier com.eatnug.tide"),
        "expected build-app.sh to re-sign Tide.app with the stable bundle identifier"
    );
}

#[test]
fn macos_launch_path_does_not_reuse_an_existing_tide_instance_before_creating_a_window() {
    // UC-2 BR-5: `MacosApp::run` must not reuse an existing Tide instance before creating a Tide Window.
    let source = include_str!("../../adapter/outward/platform_adapter/macos/app.rs");

    assert!(
        !source.contains("activate_existing_tide_instance_if_running()"),
        "expected MacosApp::run not to reuse an existing Tide instance during ordinary launch"
    );
    assert!(
        !source.contains("runningApplicationsWithBundleIdentifier"),
        "expected MacosApp::run not to query running Tide instances during ordinary launch"
    );
    assert!(
        source.contains("MacosWindow::new"),
        "expected MacosApp::run to still create a Tide Window"
    );
}
