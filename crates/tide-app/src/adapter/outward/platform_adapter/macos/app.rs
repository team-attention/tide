//! NSApplication setup and main event loop.

use std::cell::RefCell;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, AtomicPtr, Ordering};

use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, Bool};
use objc2::{msg_send, msg_send_id};
use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy};
use objc2_foundation::{MainThreadMarker, NSString};

use super::super::{EventCallback, WakeCallback, WindowConfig};

use super::window::MacosWindow;

/// Global view pointer so background-thread wakers can trigger redraws
/// via `performSelectorOnMainThread`.
static GLOBAL_VIEW: AtomicPtr<std::ffi::c_void> = AtomicPtr::new(std::ptr::null_mut());

/// Coalescing flag: prevents duplicate wakeup scheduling when a wakeup
/// is already pending. Cleared by the main thread in triggerRedraw.
static WAKEUP_PENDING: AtomicBool = AtomicBool::new(false);
const NS_APPLICATION_ACTIVATE_ALL_WINDOWS: usize = 1 << 0;

fn main_bundle_identifier() -> Option<Retained<NSString>> {
    unsafe {
        let bundle_cls = AnyClass::get("NSBundle")?;
        let bundle: Retained<AnyObject> = msg_send_id![bundle_cls, mainBundle];
        msg_send_id![&bundle, bundleIdentifier]
    }
}

fn activate_existing_tide_instance_if_running() -> bool {
    unsafe {
        let Some(bundle_identifier) = main_bundle_identifier() else {
            return false;
        };
        let Some(running_application_cls) = AnyClass::get("NSRunningApplication") else {
            return false;
        };

        let current_application: Retained<AnyObject> =
            msg_send_id![running_application_cls, currentApplication];
        let current_pid: i32 = msg_send![&current_application, processIdentifier];

        let running_applications: Retained<AnyObject> = msg_send_id![
            running_application_cls,
            runningApplicationsWithBundleIdentifier: &*bundle_identifier
        ];
        let count: usize = msg_send![&running_applications, count];
        for index in 0..count {
            let running_application: Retained<AnyObject> =
                msg_send_id![&running_applications, objectAtIndex: index];
            let process_identifier: i32 = msg_send![&running_application, processIdentifier];
            let terminated: Bool = msg_send![&running_application, isTerminated];
            if process_identifier <= 0
                || process_identifier == current_pid
                || terminated.as_bool()
            {
                continue;
            }

            let _: Bool = msg_send![&running_application, unhide];
            let activated: Bool = msg_send![
                &running_application,
                activateWithOptions: NS_APPLICATION_ACTIVATE_ALL_WINDOWS
            ];
            if activated.as_bool() {
                log::info!(
                    "Reused existing Tide instance pid={} for bundle {}",
                    process_identifier,
                    bundle_identifier
                );
                return true;
            }

            log::warn!(
                "Found an existing Tide instance pid={} but activateWithOptions failed; continuing current launch",
                process_identifier
            );
        }

        false
    }
}

/// macOS platform entry point.
pub struct MacosApp;

impl MacosApp {
    /// Create the NSApplication, window, and run the main event loop.
    ///
    /// `callback` is invoked for every platform event (key, mouse, IME, resize, etc.).
    /// This function does **not** return — it calls `[NSApp run]`.
    pub fn run(config: WindowConfig, callback: EventCallback) -> ! {
        let mtm =
            MainThreadMarker::new().expect("MacosApp::run must be called from the main thread");

        let app = NSApplication::sharedApplication(mtm);
        app.setActivationPolicy(NSApplicationActivationPolicy::Regular);

        if activate_existing_tide_instance_if_running() {
            std::process::exit(0);
        }

        // Create window + view
        let callback = Rc::new(RefCell::new(callback));
        let window = MacosWindow::new(&config, Rc::clone(&callback), mtm);

        // Store the view pointer globally so wakers can trigger redraws
        GLOBAL_VIEW.store(
            Retained::as_ptr(&window.view) as *mut std::ffi::c_void,
            Ordering::Release,
        );

        // Store the window so it lives as long as the app
        MAIN_WINDOW.with(|cell| {
            cell.replace(Some(window));
            if let Some(window) = cell.borrow().as_ref() {
                window.refresh_notification_authorization_status();
            }
        });

        // Emit a synthetic event to trigger Phase 1 initialization immediately,
        // before the run loop starts. Without this, Phase 1 may be delayed until
        // the first event arrives from the run loop (e.g., windowDidBecomeKey),
        // leaving TideView as the first responder. TideView's keyDown is a no-op,
        // so any key presses before Phase 1 are silently dropped.
        super::emit_event(
            &callback,
            super::super::PlatformEvent::RedrawRequested,
            "MacosApp::init",
        );

        // activate() requires macOS 14.0+; keep deprecated variant for macOS 13 compat.
        #[allow(deprecated)]
        app.activateIgnoringOtherApps(true);

        // Run the event loop (never returns)
        unsafe {
            app.run();
        }

        unreachable!("NSApp.run() should never return")
    }

    /// Create a waker that can be sent to background threads.
    /// When invoked, it wakes the run loop and triggers a redraw.
    /// Uses AtomicBool coalescing to skip duplicate wakeups when one is already pending.
    pub fn create_waker() -> WakeCallback {
        std::sync::Arc::new(move || {
            // Skip if a wakeup is already pending (coalescing)
            if WAKEUP_PENDING.swap(true, Ordering::AcqRel) {
                return;
            }

            unsafe {
                use objc2::msg_send_id;
                use objc2::rc::Retained;
                use objc2::runtime::AnyClass;
                use objc2_app_kit::NSEvent;

                // Post an application-defined event to wake CFRunLoop
                let cls = AnyClass::get("NSEvent").expect("NSEvent class must exist");
                let event: Option<Retained<NSEvent>> = msg_send_id![
                    cls,
                    otherEventWithType: 15_usize, // NSEventTypeApplicationDefined
                    location: objc2_foundation::NSPoint::new(0.0, 0.0),
                    modifierFlags: 0_usize,
                    timestamp: 0.0_f64,
                    windowNumber: 0_isize,
                    context: std::ptr::null::<objc2::runtime::AnyObject>(),
                    subtype: 0_i16,
                    data1: 0_isize,
                    data2: 0_isize
                ];
                if let Some(event) = event {
                    if let Some(mtm) = objc2_foundation::MainThreadMarker::new() {
                        let app = NSApplication::sharedApplication(mtm);
                        app.postEvent_atStart(&event, false);
                    }
                }

                // Also trigger a redraw on the view via performSelectorOnMainThread.
                // This ensures triggerRedraw is called on the main thread,
                // which emits RedrawRequested for the next render cycle.
                let view_raw = GLOBAL_VIEW.load(Ordering::Acquire);
                if !view_raw.is_null() {
                    let _: () = objc2::msg_send![
                        view_raw as *const objc2::runtime::AnyObject,
                        performSelectorOnMainThread: objc2::sel!(triggerRedraw),
                        withObject: std::ptr::null::<objc2::runtime::AnyObject>(),
                        waitUntilDone: false
                    ];
                }
            }
        })
    }
}

/// Clear the wakeup coalescing flag. Called from triggerRedraw on the main thread
/// so the next background wakeup can schedule a new redraw.
pub(crate) fn clear_wakeup_pending() {
    WAKEUP_PENDING.store(false, Ordering::Release);
}

thread_local! {
    static MAIN_WINDOW: RefCell<Option<MacosWindow>> = RefCell::new(None);
}

/// Access the main window from within the run loop.
pub(crate) fn with_main_window<R>(f: impl FnOnce(&MacosWindow) -> R) -> Option<R> {
    MAIN_WINDOW.with(|cell| {
        let borrow = cell.borrow();
        borrow.as_ref().map(f)
    })
}
