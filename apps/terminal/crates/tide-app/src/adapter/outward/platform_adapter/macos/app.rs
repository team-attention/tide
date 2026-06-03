//! NSApplication setup and main event loop.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};

use objc2::rc::Retained;
use objc2::runtime::Sel;
use objc2::{msg_send, msg_send_id};
use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy, NSMenu, NSMenuItem};
use objc2_foundation::{MainThreadMarker, NSPoint, NSString};

use super::super::{EventCallback, PlatformWindow, WakeCallback, WindowConfig};
use crate::tide_core::TideWindowId;

use super::view::TideView;
use super::window::MacosWindow;

extern "C" {
    static _dispatch_main_q: std::ffi::c_void;
    fn dispatch_async_f(
        queue: *const std::ffi::c_void,
        context: *mut std::ffi::c_void,
        work: unsafe extern "C" fn(*mut std::ffi::c_void),
    );
}

/// Coalescing flag: prevents duplicate wakeup scheduling when a wakeup
/// is already pending. Cleared by the main thread in triggerRedraw.
static WAKEUP_PENDING: AtomicBool = AtomicBool::new(false);

/// macOS platform entry point.
pub struct MacosApp;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct CloseWindowRequest {
    pub remaining_window_count: usize,
}

impl MacosApp {
    /// Create the NSApplication, window, and run the main event loop.
    ///
    /// `callback` is invoked for every platform event (key, mouse, IME, resize, etc.).
    /// This function does **not** return — it calls `[NSApp run]`.
    pub fn run(config: WindowConfig, callback: EventCallback) -> ! {
        let tide_window_id = Self::allocate_window_id();
        Self::run_with_window(tide_window_id, config, callback)
    }

    pub fn run_with_window(
        tide_window_id: TideWindowId,
        config: WindowConfig,
        callback: EventCallback,
    ) -> ! {
        let mtm =
            MainThreadMarker::new().expect("MacosApp::run must be called from the main thread");

        let app = NSApplication::sharedApplication(mtm);
        ensure_app_main_menu(mtm);
        // Start without a Dock icon. show_window() promotes the app to Regular
        // only when this Tide Instance really needs to reveal its Tide Window.
        app.setActivationPolicy(NSApplicationActivationPolicy::Accessory);

        Self::create_window(tide_window_id, config, callback);

        // Run the event loop (never returns)
        unsafe {
            app.run();
        }

        unreachable!("NSApp.run() should never return")
    }

    /// Create and register a native Tide Window while the app is on the main thread.
    pub fn allocate_window_id() -> TideWindowId {
        next_tide_window_id()
    }

    pub fn create_window(
        tide_window_id: TideWindowId,
        config: WindowConfig,
        callback: EventCallback,
    ) -> TideWindowId {
        let mtm = MainThreadMarker::new().expect("MacosApp::create_window must run on main thread");

        let callback = Rc::new(RefCell::new(callback));
        let window = Rc::new(MacosWindow::new(
            tide_window_id,
            &config,
            Rc::clone(&callback),
            mtm,
        ));
        position_window_for_creation(window.as_ref());

        WINDOWS.with(|cell| {
            cell.borrow_mut().insert(tide_window_id, window);
        });

        // Queue the first redraw on the run loop instead of emitting it
        // synchronously. Notification-launched non-owning instances then get a
        // chance to relay activation before any first-frame Tide Window reveal.
        with_window(tide_window_id, |window| {
            window.refresh_notification_authorization_status();
            window.request_redraw();
        });

        tide_window_id
    }

    /// Request closure of one registered Tide Window.
    pub(crate) fn request_close_window(tide_window_id: TideWindowId) -> CloseWindowRequest {
        close_window_now(tide_window_id);
        CloseWindowRequest {
            remaining_window_count: live_window_count(),
        }
    }

    /// Create a waker that can be sent to background threads.
    /// When invoked, it wakes the run loop and triggers a redraw.
    /// Uses AtomicBool coalescing to skip duplicate wakeups when one is already pending.
    pub fn create_waker() -> WakeCallback {
        std::sync::Arc::new(move || {
            if WAKEUP_PENDING.swap(true, Ordering::AcqRel) {
                return;
            }

            unsafe {
                dispatch_async_f(
                    std::ptr::addr_of!(_dispatch_main_q),
                    std::ptr::null_mut(),
                    wake_main_queue,
                );
            }
        })
    }
}

pub(crate) fn ensure_app_main_menu(mtm: MainThreadMarker) {
    let app = NSApplication::sharedApplication(mtm);
    if unsafe { app.mainMenu().is_some() } {
        return;
    }

    let menu_bar = new_menu(mtm, "MainMenu");
    let app_menu = add_menu_root(&menu_bar, mtm, "Tide");
    populate_tide_app_menu(&app_menu, mtm);
    add_menu_root(&menu_bar, mtm, "File");
    add_menu_root(&menu_bar, mtm, "Edit");
    add_menu_root(&menu_bar, mtm, "View");
    let window_menu = add_menu_root(&menu_bar, mtm, "Window");
    let help_menu = add_menu_root(&menu_bar, mtm, "Help");

    unsafe {
        app.setWindowsMenu(Some(&window_menu));
        app.setHelpMenu(Some(&help_menu));
    }
    app.setMainMenu(Some(&menu_bar));
}

fn populate_tide_app_menu(app_menu: &NSMenu, mtm: MainThreadMarker) {
    app_menu.addItem(&new_menu_item(
        mtm,
        "About Tide",
        Some(objc2::sel!(orderFrontStandardAboutPanel:)),
        "",
    ));
    app_menu.addItem(&NSMenuItem::separatorItem(mtm));
    app_menu.addItem(&new_menu_item(
        mtm,
        "Hide Tide",
        Some(objc2::sel!(hide:)),
        "h",
    ));
    app_menu.addItem(&new_menu_item(
        mtm,
        "Hide Others",
        Some(objc2::sel!(hideOtherApplications:)),
        "",
    ));
    app_menu.addItem(&new_menu_item(
        mtm,
        "Show All",
        Some(objc2::sel!(unhideAllApplications:)),
        "",
    ));
    app_menu.addItem(&NSMenuItem::separatorItem(mtm));
    app_menu.addItem(&new_menu_item(
        mtm,
        "Quit Tide",
        Some(objc2::sel!(terminate:)),
        "q",
    ));
}

fn add_menu_root(menu_bar: &NSMenu, mtm: MainThreadMarker, title: &str) -> Retained<NSMenu> {
    let root_item = new_menu_item(mtm, title, None, "");
    let submenu = new_menu(mtm, title);
    root_item.setSubmenu(Some(&submenu));
    menu_bar.addItem(&root_item);
    submenu
}

fn new_menu(mtm: MainThreadMarker, title: &str) -> Retained<NSMenu> {
    let title = NSString::from_str(title);
    unsafe { NSMenu::initWithTitle(mtm.alloc::<NSMenu>(), &title) }
}

fn new_menu_item(
    mtm: MainThreadMarker,
    title: &str,
    action: Option<Sel>,
    key_equivalent: &str,
) -> Retained<NSMenuItem> {
    let title = NSString::from_str(title);
    let key_equivalent = NSString::from_str(key_equivalent);
    unsafe {
        NSMenuItem::initWithTitle_action_keyEquivalent(
            mtm.alloc::<NSMenuItem>(),
            &title,
            action,
            &key_equivalent,
        )
    }
}

unsafe extern "C" fn wake_main_queue(_context: *mut std::ffi::c_void) {
    if let Some(mtm) = MainThreadMarker::new() {
        post_application_defined_event(mtm);
    }

    if let Some(view) = first_live_window_view() {
        let _: () = msg_send![&*view, triggerRedraw];
    } else {
        clear_wakeup_pending();
    }
}

fn post_application_defined_event(mtm: MainThreadMarker) {
    unsafe {
        use objc2::runtime::AnyClass;
        use objc2_app_kit::NSEvent;

        let cls = AnyClass::get("NSEvent").expect("NSEvent class must exist");
        let event: Option<Retained<NSEvent>> = msg_send_id![
            cls,
            otherEventWithType: 15_usize,
            location: NSPoint::new(0.0, 0.0),
            modifierFlags: 0_usize,
            timestamp: 0.0_f64,
            windowNumber: 0_isize,
            context: std::ptr::null::<objc2::runtime::AnyObject>(),
            subtype: 0_i16,
            data1: 0_isize,
            data2: 0_isize
        ];
        if let Some(event) = event {
            let app = NSApplication::sharedApplication(mtm);
            app.postEvent_atStart(&event, false);
        }
    }
}

/// Clear the wakeup coalescing flag. Called from triggerRedraw on the main thread
/// so the next background wakeup can schedule a new redraw.
pub(crate) fn clear_wakeup_pending() {
    WAKEUP_PENDING.store(false, Ordering::Release);
}

thread_local! {
    static WINDOWS: RefCell<HashMap<TideWindowId, Rc<MacosWindow>>> = RefCell::new(HashMap::new());
    static NEXT_TIDE_TERMINAL_WINDOW_ID: RefCell<u64> = RefCell::new(TideWindowId::MAIN.get());
    static NEXT_CASCADE_TOP_LEFT: RefCell<Option<NSPoint>> = const { RefCell::new(None) };
}

fn next_tide_window_id() -> TideWindowId {
    NEXT_TIDE_TERMINAL_WINDOW_ID.with(|cell| {
        let mut next = cell.borrow_mut();
        let id = TideWindowId::new(*next);
        *next = (*next).saturating_add(1);
        id
    })
}

fn live_window_count() -> usize {
    WINDOWS.with(|windows| windows.borrow().len())
}

fn position_window_for_creation(window: &MacosWindow) {
    let existing_window_count = live_window_count();
    let next_top_left = NEXT_CASCADE_TOP_LEFT.with(|cell| *cell.borrow());

    let next = if existing_window_count == 0 {
        window.center_window();
        window.cascade_top_left_from(window.frame_top_left())
    } else if let Some(top_left) = next_top_left {
        window.cascade_top_left_from(top_left)
    } else {
        window.center_window();
        window.cascade_top_left_from(window.frame_top_left())
    };

    NEXT_CASCADE_TOP_LEFT.with(|cell| {
        *cell.borrow_mut() = Some(next);
    });
}

fn close_window_now(tide_window_id: TideWindowId) {
    let window = WINDOWS.with(|cell| cell.borrow_mut().remove(&tide_window_id));

    if let Some(window) = window {
        window.close_window();
    }
    refresh_global_window_handles();
}

fn refresh_global_window_handles() {
    WINDOWS.with(|cell| {
        if let Some(window) = cell.borrow().values().next() {
            window.install_notification_center_delegate();
        }
    });
}

fn first_live_window_view() -> Option<Retained<TideView>> {
    WINDOWS.with(|cell| {
        cell.borrow()
            .values()
            .next()
            .map(|window| window.view.clone())
    })
}

pub(crate) fn window_for_event(tide_window_id: TideWindowId) -> Option<Rc<MacosWindow>> {
    WINDOWS.with(|cell| cell.borrow().get(&tide_window_id).cloned())
}

/// Access a registered window from within the run loop.
pub(crate) fn with_window<R>(
    tide_window_id: TideWindowId,
    f: impl FnOnce(&MacosWindow) -> R,
) -> Option<R> {
    window_for_event(tide_window_id).map(|window| f(window.as_ref()))
}

/// Visit every registered Tide Window from within the run loop.
pub(crate) fn for_each_window(mut f: impl FnMut(&MacosWindow)) {
    let windows: Vec<Rc<MacosWindow>> =
        WINDOWS.with(|cell| cell.borrow().values().cloned().collect());
    for window in windows {
        f(window.as_ref());
    }
}

/// Return true if any registered Tide Window matches a predicate.
pub(crate) fn any_window_matches(mut f: impl FnMut(&MacosWindow) -> bool) -> bool {
    let windows: Vec<Rc<MacosWindow>> =
        WINDOWS.with(|cell| cell.borrow().values().cloned().collect());
    windows.iter().any(|window| f(window.as_ref()))
}
