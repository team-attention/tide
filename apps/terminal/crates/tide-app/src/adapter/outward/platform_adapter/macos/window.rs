//! NSWindow wrapper implementing PlatformWindow.

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::io::Write;
use std::os::unix::net::UnixStream;
use std::rc::Rc;
use std::sync::atomic::{AtomicU64, Ordering};

use objc2::rc::Retained;
use objc2::runtime::{AnyObject, Bool, NSObject};
use objc2::{declare_class, msg_send, msg_send_id, mutability, ClassType, DeclaredClass};
use objc2_app_kit::{
    NSApplication, NSApplicationActivationOptions, NSApplicationActivationPolicy,
    NSBackingStoreType, NSRunningApplication, NSView, NSWindow, NSWindowStyleMask,
};
use objc2_foundation::MainThreadMarker;
use objc2_foundation::{CGFloat, NSMutableArray, NSPoint, NSRect, NSSize, NSString};
use raw_window_handle::{
    AppKitDisplayHandle, AppKitWindowHandle, DisplayHandle, HandleError, HasDisplayHandle,
    HasWindowHandle, RawDisplayHandle, RawWindowHandle, WindowHandle,
};

use crate::tide_core::TideWindowId;

use super::super::{CursorIcon, EventCallback, PlatformWindow, WindowConfig};

/// Initial window background color (dark gray) to avoid white flash before
/// the first GPU frame renders. RGB values in 0.0–1.0 range.
const INITIAL_BG_RED: f64 = 0.08;
const INITIAL_BG_GREEN: f64 = 0.08;
const INITIAL_BG_BLUE: f64 = 0.10;
const NS_WINDOW_COLLECTION_BEHAVIOR_MANAGED: usize = 1 << 2;
const NS_WINDOW_COLLECTION_BEHAVIOR_FULL_SCREEN_PRIMARY: usize = 1 << 7;
const NS_WINDOW_COLLECTION_BEHAVIOR_PRIMARY: usize = 1 << 16;
const NOTIFICATION_TARGET_PREFIX: &str = "tide-target:";
static NOTIFICATION_DELIVERY_SEQUENCE: AtomicU64 = AtomicU64::new(1);
pub(crate) const NOTIFICATION_AUTHORIZATION_OPTIONS: usize = 0x07;
pub(crate) const FOREGROUND_NOTIFICATION_PRESENTATION_OPTIONS: usize = 0x12;

use super::ime_proxy::ImeProxyView;
use super::view::TideView;

extern "C" {
    static _dispatch_main_q: std::ffi::c_void;
    fn dispatch_async_f(
        queue: *const std::ffi::c_void,
        context: *mut std::ffi::c_void,
        work: unsafe extern "C" fn(*mut std::ffi::c_void),
    );
}

// ── TideWindow: NSWindow subclass for accessibility ──

declare_class!(
    pub struct TideWindow;

    unsafe impl ClassType for TideWindow {
        type Super = NSWindow;
        type Mutability = mutability::MainThreadOnly;
        const NAME: &'static str = "TideWindow";
    }

    impl DeclaredClass for TideWindow {
        type Ivars = ();
    }

    unsafe impl TideWindow {
        /// Legacy accessibility API override. macOS queries NSWindow
        /// accessibility attributes via this method, not the modern
        /// property-based API.
        #[method_id(accessibilityAttributeValue:)]
        fn accessibility_attribute_value(
            &self,
            attribute: &NSString,
        ) -> Option<Retained<AnyObject>> {
            unsafe {
                let attr = attribute.to_string();

                if attr == "AXFocusedUIElement" {
                    let responder: Option<Retained<AnyObject>> =
                        msg_send_id![self, firstResponder];
                    let ime_cls = objc2::runtime::AnyClass::get("ImeProxyView");
                    let is_ime_proxy = responder.as_ref().map_or(false, |r| {
                        ime_cls.map_or(false, |c| {
                            let yes: Bool = msg_send![&**r, isKindOfClass: c];
                            yes.as_bool()
                        })
                    });
                    if is_ime_proxy {
                        responder
                    } else {
                        msg_send_id![super(self), accessibilityAttributeValue: attribute]
                    }
                } else if attr == "AXChildren" {
                    let arr: Retained<NSMutableArray> = msg_send_id![
                        objc2::runtime::AnyClass::get("NSMutableArray")
                            .expect("NSMutableArray"),
                        new
                    ];
                    let default: Option<Retained<AnyObject>> =
                        msg_send_id![super(self), accessibilityAttributeValue: attribute];
                    if let Some(ref def) = default {
                        // default is an NSArray
                        let _: () = msg_send![&*arr, addObjectsFromArray: &**def];
                    }
                    let content_view: Option<Retained<NSView>> =
                        msg_send_id![self, contentView];
                    if let Some(cv) = content_view {
                        let subviews = cv.subviews();
                        let ime_cls = objc2::runtime::AnyClass::get("ImeProxyView");
                        for i in 0..subviews.len() {
                            let sv = subviews.objectAtIndex(i);
                            let is_ime = ime_cls.map_or(false, |c| {
                                let yes: Bool = msg_send![&*sv, isKindOfClass: c];
                                yes.as_bool()
                            });
                            if is_ime {
                                let _: () = msg_send![&*arr, addObject: &*sv];
                            }
                        }
                    }
                    let obj: Retained<AnyObject> = Retained::cast(arr);
                    Some(obj)
                } else {
                    msg_send_id![super(self), accessibilityAttributeValue: attribute]
                }
            }
        }
    }
);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct NotificationActivationTarget {
    tide_instance_pid: u32,
    tide_window_id: TideWindowId,
    pane_id: u64,
}

fn notification_identifier_for_target(target: NotificationActivationTarget) -> String {
    let delivery_id = NOTIFICATION_DELIVERY_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!(
        "{NOTIFICATION_TARGET_PREFIX}{}:{}:{}:{delivery_id}",
        target.tide_instance_pid,
        target.tide_window_id.get(),
        target.pane_id
    )
}

fn notification_identifier_for_pane(tide_window_id: TideWindowId, pane_id: u64) -> String {
    notification_identifier_for_target(NotificationActivationTarget {
        tide_instance_pid: std::process::id(),
        tide_window_id,
        pane_id,
    })
}

fn notification_target_from_identifier(identifier: &str) -> Option<NotificationActivationTarget> {
    let mut parts = identifier
        .strip_prefix(NOTIFICATION_TARGET_PREFIX)?
        .split(':');
    let tide_instance_pid = parts.next()?.parse::<u32>().ok()?;
    let tide_window_id = parts.next()?.parse::<u64>().ok()?;
    let pane_id = parts.next()?.parse::<u64>().ok()?;
    let _delivery_id = parts.next()?;
    Some(NotificationActivationTarget {
        tide_instance_pid,
        tide_window_id: TideWindowId::new(tide_window_id),
        pane_id,
    })
}

fn notification_relay_socket_path_for_tide_instance(tide_instance_pid: u32) -> std::path::PathBuf {
    std::env::temp_dir().join(format!("tide-{tide_instance_pid}.sock"))
}

fn restore_latest_socket_symlink(tide_instance_pid: u32) {
    let latest = std::env::temp_dir().join("tide-latest.sock");
    let target = notification_relay_socket_path_for_tide_instance(tide_instance_pid);
    let _ = std::fs::remove_file(&latest);
    let _ = std::os::unix::fs::symlink(&target, &latest);
}

fn relay_notification_activation(target: NotificationActivationTarget) -> bool {
    let socket_path = notification_relay_socket_path_for_tide_instance(target.tide_instance_pid);
    let mut stream = match UnixStream::connect(&socket_path) {
        Ok(stream) => stream,
        Err(_) => return false,
    };

    let request = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "activate-notification-target",
        "params": {
            "_caller_window": target.tide_window_id.get(),
            "pane_id": target.pane_id,
        },
    });

    writeln!(
        stream,
        "{}",
        serde_json::to_string(&request).unwrap_or_default()
    )
    .is_ok()
}

fn terminate_current_tide_instance() {
    unsafe {
        let app_cls = objc2::runtime::AnyClass::get("NSApplication").expect("NSApplication");
        let nsapp: Retained<AnyObject> = msg_send_id![app_cls, sharedApplication];
        let _: () = msg_send![&nsapp, terminate: std::ptr::null::<AnyObject>()];
    }
}

fn hide_current_tide_instance() {
    unsafe {
        let app_cls = objc2::runtime::AnyClass::get("NSApplication").expect("NSApplication");
        let nsapp: Retained<AnyObject> = msg_send_id![app_cls, sharedApplication];
        let _: () = msg_send![&nsapp, hide: std::ptr::null::<AnyObject>()];
    }
}

fn suppress_current_tide_instance_after_successful_relay() {
    let should_hide = super::app::any_window_matches(|window| window.window_revealed.get());
    if should_hide {
        hide_current_tide_instance();
    } else {
        terminate_current_tide_instance();
    }
}

fn notification_authorization_options() -> usize {
    NOTIFICATION_AUTHORIZATION_OPTIONS
}

pub(crate) fn foreground_notification_presentation_options() -> usize {
    FOREGROUND_NOTIFICATION_PRESENTATION_OPTIONS
}

fn default_notification_sound() -> Option<Retained<AnyObject>> {
    unsafe {
        let sound_cls = objc2::runtime::AnyClass::get("UNNotificationSound")?;
        Some(msg_send_id![sound_cls, defaultSound])
    }
}

fn map_notification_authorization_status(
    raw_status: isize,
) -> crate::state::NotificationAuthorizationStatus {
    match raw_status {
        0 => crate::state::NotificationAuthorizationStatus::NotDetermined,
        1 => crate::state::NotificationAuthorizationStatus::Denied,
        2 => crate::state::NotificationAuthorizationStatus::Authorized,
        3 => crate::state::NotificationAuthorizationStatus::Provisional,
        4 => crate::state::NotificationAuthorizationStatus::Ephemeral,
        _ => crate::state::NotificationAuthorizationStatus::Unknown,
    }
}

struct EmitNotificationAuthorizationStatusCtx {
    status: crate::state::NotificationAuthorizationStatus,
}

struct RefreshNotificationAuthorizationStatusCtx;

unsafe extern "C" fn emit_notification_authorization_status_on_main_thread(
    ctx_ptr: *mut std::ffi::c_void,
) {
    let ctx = Box::from_raw(ctx_ptr as *mut EmitNotificationAuthorizationStatusCtx);
    super::app::for_each_window(|window| {
        super::emit_event(
            window.tide_window_id,
            &window.callback,
            super::super::PlatformEvent::NotificationAuthorizationStatusChanged {
                status: ctx.status,
            },
            "MacosWindow::notificationAuthorizationStatus",
        );
    });
}

unsafe extern "C" fn refresh_notification_authorization_status_on_main_thread(
    ctx_ptr: *mut std::ffi::c_void,
) {
    let _ctx = Box::from_raw(ctx_ptr as *mut RefreshNotificationAuthorizationStatusCtx);
    super::app::for_each_window(|window| {
        window.refresh_notification_authorization_status();
    });
}

fn schedule_notification_authorization_status_emit(
    status: crate::state::NotificationAuthorizationStatus,
) {
    let ctx = Box::new(EmitNotificationAuthorizationStatusCtx { status });
    unsafe {
        dispatch_async_f(
            &_dispatch_main_q,
            Box::into_raw(ctx) as *mut std::ffi::c_void,
            emit_notification_authorization_status_on_main_thread,
        );
    }
}

fn schedule_notification_authorization_status_refresh() {
    let ctx = Box::new(RefreshNotificationAuthorizationStatusCtx);
    unsafe {
        dispatch_async_f(
            &_dispatch_main_q,
            Box::into_raw(ctx) as *mut std::ffi::c_void,
            refresh_notification_authorization_status_on_main_thread,
        );
    }
}

pub struct TideNotificationCenterDelegateIvars {
    tide_window_id: TideWindowId,
    callback: Rc<RefCell<EventCallback>>,
}

declare_class!(
    pub struct TideNotificationCenterDelegate;

    unsafe impl ClassType for TideNotificationCenterDelegate {
        type Super = NSObject;
        type Mutability = mutability::MainThreadOnly;
        const NAME: &'static str = "TideNotificationCenterDelegate";
    }

    impl DeclaredClass for TideNotificationCenterDelegate {
        type Ivars = TideNotificationCenterDelegateIvars;
    }

    unsafe impl TideNotificationCenterDelegate {
        #[method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:)]
        fn did_receive_notification_response(
            &self,
            _center: &AnyObject,
            response: &AnyObject,
            completion: &block2::Block<dyn Fn()>,
        ) {
            unsafe {
                let notification: Retained<AnyObject> = msg_send_id![response, notification];
                let request: Retained<AnyObject> = msg_send_id![&notification, request];
                let identifier: Retained<NSString> = msg_send_id![&request, identifier];
                if let Some(target) = notification_target_from_identifier(&identifier.to_string()) {
                    if target.tide_instance_pid == std::process::id() {
                        super::app::with_window(target.tide_window_id, |window| {
                            super::emit_event(
                                target.tide_window_id,
                                &window.callback,
                                super::super::PlatformEvent::SystemNotificationActivated {
                                    pane_id: target.pane_id,
                                },
                                "TideNotificationCenterDelegate",
                            );
                        });
                    } else if relay_notification_activation(target) {
                        restore_latest_socket_symlink(target.tide_instance_pid);
                        suppress_current_tide_instance_after_successful_relay();
                    }
                }
            }
            completion.call(());
        }

        #[method(userNotificationCenter:willPresentNotification:withCompletionHandler:)]
        fn will_present_notification(
            &self,
            _center: &AnyObject,
            notification: &AnyObject,
            completion: &block2::Block<dyn Fn(usize)>,
        ) {
            let options = unsafe {
                let request: Retained<AnyObject> = msg_send_id![notification, request];
                let identifier: Retained<NSString> = msg_send_id![&request, identifier];
                if notification_target_from_identifier(&identifier.to_string()).is_some() {
                    foreground_notification_presentation_options()
                } else {
                    0
                }
            };
            completion.call((options,));
        }
    }
);

impl TideNotificationCenterDelegate {
    fn new(
        tide_window_id: TideWindowId,
        callback: Rc<RefCell<EventCallback>>,
        mtm: MainThreadMarker,
    ) -> Retained<Self> {
        let this = mtm
            .alloc::<Self>()
            .set_ivars(TideNotificationCenterDelegateIvars {
                tide_window_id,
                callback,
            });
        unsafe { msg_send_id![super(this), init] }
    }

    fn emit(&self, event: super::super::PlatformEvent) {
        super::emit_event(
            self.ivars().tide_window_id,
            &self.ivars().callback,
            event,
            "TideNotificationCenterDelegate",
        );
    }
}

/// macOS window backed by NSWindow + TideView.
pub struct MacosWindow {
    pub(crate) tide_window_id: TideWindowId,
    pub(crate) ns_window: Retained<NSWindow>,
    pub(crate) view: Retained<TideView>,
    callback: Rc<RefCell<EventCallback>>,
    mtm: MainThreadMarker,
    ime_proxies: RefCell<HashMap<u64, Retained<ImeProxyView>>>,
    window_delegate: Retained<super::view::TideWindowDelegate>,
    notification_center_delegate: Retained<TideNotificationCenterDelegate>,
    window_revealed: Cell<bool>,
    notification_authorization_requested: Cell<bool>,
}

impl MacosWindow {
    fn publish_notification_authorization_status(
        &self,
        status: crate::state::NotificationAuthorizationStatus,
    ) {
        self.notification_authorization_requested
            .set(!status.is_unresolved());
        schedule_notification_authorization_status_emit(status);
    }

    pub(crate) fn refresh_notification_authorization_status(&self) {
        unsafe {
            let center_cls = match objc2::runtime::AnyClass::get("UNUserNotificationCenter") {
                Some(cls) => cls,
                None => {
                    self.publish_notification_authorization_status(
                        crate::state::NotificationAuthorizationStatus::Unknown,
                    );
                    return;
                }
            };
            let center: Retained<AnyObject> = msg_send_id![center_cls, currentNotificationCenter];
            let completion = block2::RcBlock::new(|settings: *mut AnyObject| {
                let status = if settings.is_null() {
                    crate::state::NotificationAuthorizationStatus::Unknown
                } else {
                    let raw_status: isize = msg_send![settings, authorizationStatus];
                    map_notification_authorization_status(raw_status)
                };
                schedule_notification_authorization_status_emit(status);
            });
            let completion_ptr = &*completion as *const block2::Block<dyn Fn(*mut AnyObject)>;
            let _: () = msg_send![&center,
                getNotificationSettingsWithCompletionHandler: completion_ptr
            ];
        }
    }

    fn request_notification_authorization(&self, options: usize) {
        self.refresh_notification_authorization_status();
        if self.notification_authorization_requested.replace(true) {
            return;
        }

        unsafe {
            let center_cls = match objc2::runtime::AnyClass::get("UNUserNotificationCenter") {
                Some(cls) => cls,
                None => return,
            };
            let center: Retained<AnyObject> = msg_send_id![center_cls, currentNotificationCenter];
            let completion = block2::RcBlock::new(|granted: Bool, error: *mut AnyObject| {
                if error.is_null() {
                    log::info!(
                        "Notification authorization request completed: granted={}",
                        granted.as_bool()
                    );
                } else {
                    log::warn!(
                        "Notification authorization request completed with an NSError pointer; Tide will refresh authorization status from UNUserNotificationCenter."
                    );
                }
                schedule_notification_authorization_status_refresh();
            });
            let completion_ptr = &*completion as *const block2::Block<dyn Fn(Bool, *mut AnyObject)>;
            let _: () = msg_send![&center,
                requestAuthorizationWithOptions: options
                completionHandler: completion_ptr
            ];
        }
    }

    pub fn new(
        tide_window_id: TideWindowId,
        config: &WindowConfig,
        callback: Rc<RefCell<EventCallback>>,
        mtm: MainThreadMarker,
    ) -> Self {
        let content_rect = NSRect::new(
            NSPoint::new(0.0, 0.0),
            NSSize::new(config.width as CGFloat, config.height as CGFloat),
        );

        let mut style = NSWindowStyleMask::Titled
            | NSWindowStyleMask::Closable
            | NSWindowStyleMask::Miniaturizable
            | NSWindowStyleMask::Resizable;

        if config.transparent_titlebar {
            style |= NSWindowStyleMask::FullSizeContentView;
        }

        let ns_window: Retained<NSWindow> = unsafe {
            let allocated = mtm.alloc::<TideWindow>().set_ivars(());
            let window: Retained<TideWindow> = msg_send_id![
                super(allocated),
                initWithContentRect: content_rect,
                styleMask: style,
                backing: NSBackingStoreType::NSBackingStoreBuffered,
                defer: false
            ];
            Retained::into_super(window)
        };
        unsafe {
            let _: () = msg_send![&ns_window, setReleasedWhenClosed: Bool::NO];
        }
        if config.transparent_titlebar {
            ns_window.setTitlebarAppearsTransparent(true);
            ns_window
                .setTitleVisibility(objc2_app_kit::NSWindowTitleVisibility::NSWindowTitleHidden);
        }
        // Mark Tide windows as the system-managed primary full-screen document window.
        // This keeps Spaces/Stage Manager behavior explicit instead of relying on defaults.
        unsafe {
            let behavior: usize = msg_send![&ns_window, collectionBehavior];
            let behavior = behavior
                | NS_WINDOW_COLLECTION_BEHAVIOR_MANAGED
                | NS_WINDOW_COLLECTION_BEHAVIOR_FULL_SCREEN_PRIMARY
                | NS_WINDOW_COLLECTION_BEHAVIOR_PRIMARY;
            let _: () = msg_send![&ns_window, setCollectionBehavior: behavior];
        }

        // Set minimum size
        ns_window.setMinSize(NSSize::new(
            config.min_width as CGFloat,
            config.min_height as CGFloat,
        ));

        // Set title
        let title = NSString::from_str(&config.title);
        ns_window.setTitle(&title);

        // Create our custom NSView
        let view = TideView::new(tide_window_id, Rc::clone(&callback), mtm);

        // Set as content view
        ns_window.setContentView(Some(&view));
        // makeFirstResponder expects &NSResponder
        let responder: &objc2_app_kit::NSResponder = &view;
        ns_window.makeFirstResponder(Some(responder));

        // Set dark background to avoid white flash before first GPU frame
        unsafe {
            use objc2::msg_send_id;
            use objc2::runtime::AnyClass;
            let bg_color: Retained<objc2::runtime::AnyObject> = msg_send_id![
                AnyClass::get("NSColor").expect("NSColor class must exist"),
                colorWithRed: INITIAL_BG_RED,
                green: INITIAL_BG_GREEN,
                blue: INITIAL_BG_BLUE,
                alpha: 1.0_f64
            ];
            let _: () = msg_send![&ns_window, setBackgroundColor: &*bg_color];
        }

        // Start invisible — show_window() reveals after the first frame renders,
        // so the user never sees a blank window during GPU initialization.
        unsafe {
            let _: () = msg_send![&ns_window, setAlphaValue: 0.0_f64];
        }

        // Set the window delegate for resize/focus/close events
        let delegate =
            super::view::TideWindowDelegate::new(tide_window_id, Rc::clone(&callback), mtm);
        unsafe {
            let _: () = msg_send![&ns_window, setDelegate: &*delegate];
        }
        // Keep the delegate alive for exactly this Tide Window lifetime.

        let notification_center_delegate =
            TideNotificationCenterDelegate::new(tide_window_id, Rc::clone(&callback), mtm);

        let window = MacosWindow {
            tide_window_id,
            ns_window,
            view,
            callback: Rc::clone(&callback),
            mtm,
            ime_proxies: RefCell::new(HashMap::new()),
            window_delegate: delegate,
            notification_center_delegate,
            window_revealed: Cell::new(false),
            notification_authorization_requested: Cell::new(false),
        };
        window.install_notification_center_delegate();
        window
    }

    pub(crate) fn install_notification_center_delegate(&self) {
        unsafe {
            if let Some(center_cls) = objc2::runtime::AnyClass::get("UNUserNotificationCenter") {
                let center: Retained<AnyObject> =
                    msg_send_id![center_cls, currentNotificationCenter];
                let _: () = msg_send![&center, setDelegate: &*self.notification_center_delegate];
            }
        }
    }

    pub(crate) fn center_window(&self) {
        self.ns_window.center();
    }

    pub(crate) fn frame_top_left(&self) -> NSPoint {
        let frame = self.ns_window.frame();
        NSPoint::new(frame.origin.x, frame.origin.y + frame.size.height)
    }

    pub(crate) fn cascade_top_left_from(&self, top_left: NSPoint) -> NSPoint {
        unsafe { self.ns_window.cascadeTopLeftFromPoint(top_left) }
    }
}

impl HasWindowHandle for MacosWindow {
    fn window_handle(&self) -> Result<WindowHandle<'_>, HandleError> {
        let ns_view_ptr = Retained::as_ptr(&self.view) as *mut std::ffi::c_void;
        let handle = AppKitWindowHandle::new(
            std::ptr::NonNull::new(ns_view_ptr).expect("view pointer is non-null"),
        );
        let raw = RawWindowHandle::AppKit(handle);
        Ok(unsafe { WindowHandle::borrow_raw(raw) })
    }
}

impl HasDisplayHandle for MacosWindow {
    fn display_handle(&self) -> Result<DisplayHandle<'_>, HandleError> {
        let handle = AppKitDisplayHandle::new();
        let raw = RawDisplayHandle::AppKit(handle);
        Ok(unsafe { DisplayHandle::borrow_raw(raw) })
    }
}

impl PlatformWindow for MacosWindow {
    fn request_redraw(&self) {
        // Schedule triggerRedraw on the main thread (same mechanism the waker uses).
        // The RedrawRequested handler checks `needs_redraw` to skip redundant renders.
        unsafe {
            let _: () = objc2::msg_send![
                &*self.view,
                performSelectorOnMainThread: objc2::sel!(triggerRedraw),
                withObject: std::ptr::null::<objc2::runtime::AnyObject>(),
                waitUntilDone: false
            ];
        }
    }

    fn set_cursor_icon(&self, icon: CursorIcon) {
        unsafe {
            use objc2_app_kit::NSCursor;
            let cursor = match icon {
                CursorIcon::Default => NSCursor::arrowCursor(),
                CursorIcon::IBeam => NSCursor::IBeamCursor(),
                CursorIcon::Pointer => NSCursor::pointingHandCursor(),
                CursorIcon::Grab => NSCursor::openHandCursor(),
                CursorIcon::ColResize => NSCursor::resizeLeftRightCursor(),
                CursorIcon::RowResize => NSCursor::resizeUpDownCursor(),
            };
            cursor.set();
        }
    }

    fn inner_size(&self) -> (u32, u32) {
        let frame = self.view.frame();
        let scale = self.scale_factor();
        (
            (frame.size.width * scale) as u32,
            (frame.size.height * scale) as u32,
        )
    }

    fn scale_factor(&self) -> f64 {
        unsafe {
            let backing: CGFloat = msg_send![&self.ns_window, backingScaleFactor];
            backing
        }
    }

    fn set_fullscreen(&self, fullscreen: bool) {
        let is_fs = self.is_fullscreen();
        if fullscreen != is_fs {
            self.ns_window.toggleFullScreen(None);
        }
    }

    fn is_fullscreen(&self) -> bool {
        let mask = self.ns_window.styleMask();
        mask.contains(NSWindowStyleMask::FullScreen)
    }

    fn create_ime_proxy(&self, pane_id: u64) {
        let mut proxies = self.ime_proxies.borrow_mut();
        if proxies.contains_key(&pane_id) {
            return;
        }
        let proxy = ImeProxyView::new(
            self.tide_window_id,
            Rc::clone(&self.callback),
            self.mtm,
            pane_id,
        );
        unsafe { self.view.addSubview(&proxy) };
        proxies.insert(pane_id, proxy);
    }

    fn remove_ime_proxy(&self, pane_id: u64) {
        let mut proxies = self.ime_proxies.borrow_mut();
        if let Some(proxy) = proxies.remove(&pane_id) {
            unsafe { proxy.removeFromSuperview() };
        }
    }

    fn focus_ime_proxy(&self, pane_id: u64) {
        super::set_last_ime_target(self.tide_window_id, pane_id);
        let proxies = self.ime_proxies.borrow();
        if let Some(proxy) = proxies.get(&pane_id) {
            let responder: &objc2_app_kit::NSResponder = proxy;
            if !self.ns_window.makeFirstResponder(Some(responder)) {
                log::warn!(
                    "makeFirstResponder failed for pane {pane_id} — \
                     first responder may be desynced from focus state"
                );
            }
        } else if pane_id != 0 {
            log::trace!(
                "focus_ime_proxy: no proxy for pane {pane_id} — \
                 proxy may not have been created yet"
            );
        }
    }

    fn set_ime_proxy_cursor_area(&self, pane_id: u64, x: f64, y: f64, w: f64, h: f64) {
        let proxies = self.ime_proxies.borrow();
        if let Some(proxy) = proxies.get(&pane_id) {
            proxy.set_ime_cursor_rect(x, y, w, h);
        }
    }

    fn content_view_ptr(&self) -> Option<*mut std::ffi::c_void> {
        Some(Retained::as_ptr(&self.view) as *mut std::ffi::c_void)
    }

    fn window_ptr(&self) -> Option<*mut std::ffi::c_void> {
        Some(Retained::as_ptr(&self.ns_window) as *mut std::ffi::c_void)
    }

    fn show_window(&self) {
        let app = NSApplication::sharedApplication(self.mtm);
        super::app::ensure_app_main_menu(self.mtm);
        app.setActivationPolicy(NSApplicationActivationPolicy::Regular);
        unsafe {
            self.ns_window.deminiaturize(None);
            self.ns_window.makeKeyAndOrderFront(None);
            self.ns_window.orderFrontRegardless();
            self.ns_window.makeMainWindow();
            let running_app = NSRunningApplication::currentApplication();
            #[allow(deprecated)]
            let activation_options = NSApplicationActivationOptions::NSApplicationActivateAllWindows
                | NSApplicationActivationOptions::NSApplicationActivateIgnoringOtherApps;
            #[allow(deprecated)]
            let _: bool = running_app.activateWithOptions(activation_options);
            let _: () = msg_send![&self.ns_window, setAlphaValue: 1.0_f64];
        }
        self.window_revealed.set(true);
    }

    fn close_window(&self) {
        unsafe {
            let nil_delegate: *const AnyObject = std::ptr::null();
            let _: () = msg_send![&self.ns_window, setDelegate: nil_delegate];
            let _: () = msg_send![&self.ns_window, close];
        }
    }

    fn send_system_notification(&self, title: &str, body: &str, pane_id: u64) {
        // Permission is requested proactively during setup; keep a send-path fallback
        // so first-use still works if startup or toggle timing was missed.
        if !self.notification_authorization_requested.get() {
            self.request_notification_permission();
        }
        unsafe {
            let center_cls = match objc2::runtime::AnyClass::get("UNUserNotificationCenter") {
                Some(cls) => cls,
                None => return, // UNUserNotificationCenter not available
            };
            let center: Retained<AnyObject> = msg_send_id![center_cls, currentNotificationCenter];
            let completion = block2::RcBlock::new(|error: *mut AnyObject| {
                if !error.is_null() {
                    log::warn!(
                        "UNUserNotificationCenter.addNotificationRequest returned an NSError pointer for a Tide notification."
                    );
                }
            });
            let completion_ptr = &*completion as *const block2::Block<dyn Fn(*mut AnyObject)>;

            // Create notification content
            let content_cls = objc2::runtime::AnyClass::get("UNMutableNotificationContent")
                .expect("UNMutableNotificationContent");
            let content: Retained<AnyObject> = msg_send_id![content_cls, new];
            let _: () = msg_send![&content, setTitle: &*NSString::from_str(title)];
            let _: () = msg_send![&content, setBody: &*NSString::from_str(body)];
            if let Some(sound) = default_notification_sound() {
                let _: () = msg_send![&content, setSound: &*sound];
            }

            let notif_req_cls = objc2::runtime::AnyClass::get("UNNotificationRequest")
                .expect("UNNotificationRequest");
            let null_trigger: *const AnyObject = std::ptr::null();
            let request: Retained<AnyObject> = msg_send_id![
                notif_req_cls,
                requestWithIdentifier: &*NSString::from_str(&notification_identifier_for_target(NotificationActivationTarget {
                    tide_instance_pid: std::process::id(),
                    tide_window_id: self.tide_window_id,
                    pane_id,
                }))
                content: &*content
                trigger: null_trigger
            ];

            // Add request to notification center (fire-and-forget)
            let _: () = msg_send![&center,
                addNotificationRequest: &*request
                withCompletionHandler: completion_ptr
            ];
        }
    }

    fn request_notification_permission(&self) {
        // Alert + sound + badge, matching the notification send path.
        self.request_notification_authorization(notification_authorization_options());
    }

    fn request_user_attention(&self) {
        // NSApp.requestUserAttention(.informational) — single dock bounce
        unsafe {
            let app_cls = objc2::runtime::AnyClass::get("NSApplication").expect("NSApplication");
            let nsapp: Retained<AnyObject> = msg_send_id![app_cls, sharedApplication];
            let _: () = msg_send![&nsapp, requestUserAttention: 0_isize]; // NSInformationalRequest = 0
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        default_notification_sound, notification_identifier_for_pane,
        notification_target_from_identifier,
    };
    use crate::tide_core::TideWindowId;

    #[test]
    fn notification_identifier_round_trips_the_target_pane_id() {
        let identifier = notification_identifier_for_pane(TideWindowId::new(3), 42);
        let target = notification_target_from_identifier(&identifier).expect("target");
        assert_eq!(target.pane_id, 42);
        assert_eq!(target.tide_window_id, TideWindowId::new(3));
        assert_eq!(target.tide_instance_pid, std::process::id());
    }

    #[test]
    fn notification_identifier_is_unique_per_delivery_for_the_same_pane() {
        let first = notification_identifier_for_pane(TideWindowId::new(5), 7);
        let second = notification_identifier_for_pane(TideWindowId::new(5), 7);

        assert_ne!(first, second);
        assert_eq!(
            notification_target_from_identifier(&first)
                .map(|target| (target.tide_window_id, target.pane_id)),
            Some((TideWindowId::new(5), 7))
        );
        assert_eq!(
            notification_target_from_identifier(&second)
                .map(|target| (target.tide_window_id, target.pane_id)),
            Some((TideWindowId::new(5), 7))
        );
    }

    #[test]
    fn default_notification_sound_is_available_for_notification_delivery() {
        assert!(default_notification_sound().is_some());
    }
}
