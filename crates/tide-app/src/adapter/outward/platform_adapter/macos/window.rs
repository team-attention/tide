//! NSWindow wrapper implementing PlatformWindow.

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::rc::Rc;

use objc2::rc::Retained;
use objc2::runtime::{AnyObject, Bool, NSObject};
use objc2::{declare_class, msg_send, msg_send_id, mutability, ClassType, DeclaredClass};
use objc2_app_kit::{NSBackingStoreType, NSView, NSWindow, NSWindowStyleMask};
use objc2_foundation::MainThreadMarker;
use objc2_foundation::{CGFloat, NSMutableArray, NSPoint, NSRect, NSSize, NSString};
use raw_window_handle::{
    AppKitDisplayHandle, AppKitWindowHandle, DisplayHandle, HandleError, HasDisplayHandle,
    HasWindowHandle, RawDisplayHandle, RawWindowHandle, WindowHandle,
};

use super::super::{CursorIcon, EventCallback, PlatformWindow, WindowConfig};

/// Initial window background color (dark gray) to avoid white flash before
/// the first GPU frame renders. RGB values in 0.0–1.0 range.
const INITIAL_BG_RED: f64 = 0.08;
const INITIAL_BG_GREEN: f64 = 0.08;
const INITIAL_BG_BLUE: f64 = 0.10;
const NOTIFICATION_TARGET_PREFIX: &str = "tide-pane:";

use super::ime_proxy::ImeProxyView;
use super::view::TideView;

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

fn notification_identifier_for_pane(pane_id: u64) -> String {
    format!("{NOTIFICATION_TARGET_PREFIX}{pane_id}")
}

fn notification_target_from_identifier(identifier: &str) -> Option<u64> {
    identifier
        .strip_prefix(NOTIFICATION_TARGET_PREFIX)
        .and_then(|value| value.parse::<u64>().ok())
}

pub(crate) const NOTIFICATION_AUTHORIZATION_OPTIONS: usize = 0x07;
pub(crate) const FOREGROUND_NOTIFICATION_PRESENTATION_OPTIONS: usize = 0x12;

fn notification_authorization_options() -> usize {
    NOTIFICATION_AUTHORIZATION_OPTIONS
}

pub(crate) fn foreground_notification_presentation_options() -> usize {
    FOREGROUND_NOTIFICATION_PRESENTATION_OPTIONS
}

pub struct TideNotificationCenterDelegateIvars {
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
                if let Some(pane_id) = notification_target_from_identifier(&identifier.to_string()) {
                    self.emit(super::super::PlatformEvent::SystemNotificationActivated {
                        pane_id,
                    });
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
    fn new(callback: Rc<RefCell<EventCallback>>, mtm: MainThreadMarker) -> Retained<Self> {
        let this = mtm
            .alloc::<Self>()
            .set_ivars(TideNotificationCenterDelegateIvars { callback });
        unsafe { msg_send_id![super(this), init] }
    }

    fn emit(&self, event: super::super::PlatformEvent) {
        super::emit_event(
            &self.ivars().callback,
            event,
            "TideNotificationCenterDelegate",
        );
    }
}

/// macOS window backed by NSWindow + TideView.
pub struct MacosWindow {
    pub(crate) ns_window: Retained<NSWindow>,
    pub(crate) view: Retained<TideView>,
    callback: Rc<RefCell<EventCallback>>,
    mtm: MainThreadMarker,
    ime_proxies: RefCell<HashMap<u64, Retained<ImeProxyView>>>,
    notification_center_delegate: Retained<TideNotificationCenterDelegate>,
    notification_authorization_requested: Cell<bool>,
}

impl MacosWindow {
    fn request_notification_authorization(&self, options: usize) {
        if self.notification_authorization_requested.replace(true) {
            return;
        }

        unsafe {
            let center_cls = match objc2::runtime::AnyClass::get("UNUserNotificationCenter") {
                Some(cls) => cls,
                None => return,
            };
            let center: Retained<AnyObject> = msg_send_id![center_cls, currentNotificationCenter];
            let completion = block2::RcBlock::new(|_granted: Bool, _error: *mut AnyObject| {});
            let completion_ptr = &*completion as *const block2::Block<dyn Fn(Bool, *mut AnyObject)>;
            let _: () = msg_send![&center,
                requestAuthorizationWithOptions: options
                completionHandler: completion_ptr
            ];
        }
    }

    pub fn new(
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
        if config.transparent_titlebar {
            ns_window.setTitlebarAppearsTransparent(true);
            ns_window
                .setTitleVisibility(objc2_app_kit::NSWindowTitleVisibility::NSWindowTitleHidden);
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
        let view = TideView::new(Rc::clone(&callback), mtm);

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

        // Center and show (invisible due to alpha=0, but events still flow)
        ns_window.center();
        ns_window.makeKeyAndOrderFront(None);

        // Set the window delegate for resize/focus/close events
        let delegate = super::view::TideWindowDelegate::new(Rc::clone(&callback), mtm);
        unsafe {
            let _: () = msg_send![&ns_window, setDelegate: &*delegate];
        }
        // Keep the delegate alive by leaking it (lives for the entire app)
        std::mem::forget(delegate);

        let notification_center_delegate =
            TideNotificationCenterDelegate::new(Rc::clone(&callback), mtm);
        unsafe {
            if let Some(center_cls) = objc2::runtime::AnyClass::get("UNUserNotificationCenter") {
                let center: Retained<AnyObject> =
                    msg_send_id![center_cls, currentNotificationCenter];
                let _: () = msg_send![&center, setDelegate: &*notification_center_delegate];
            }
        }

        MacosWindow {
            ns_window,
            view,
            callback: Rc::clone(&callback),
            mtm,
            ime_proxies: RefCell::new(HashMap::new()),
            notification_center_delegate,
            notification_authorization_requested: Cell::new(false),
        }
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
        let proxy = ImeProxyView::new(Rc::clone(&self.callback), self.mtm, pane_id);
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
        super::LAST_IME_TARGET.store(pane_id, std::sync::atomic::Ordering::Relaxed);
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
        unsafe {
            let _: () = msg_send![&self.ns_window, setAlphaValue: 1.0_f64];
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
            let completion = block2::RcBlock::new(|_error: *mut AnyObject| {});
            let completion_ptr = &*completion as *const block2::Block<dyn Fn(*mut AnyObject)>;

            // Create notification content
            let content_cls = objc2::runtime::AnyClass::get("UNMutableNotificationContent")
                .expect("UNMutableNotificationContent");
            let content: Retained<AnyObject> = msg_send_id![content_cls, new];
            let _: () = msg_send![&content, setTitle: &*NSString::from_str(title)];
            let _: () = msg_send![&content, setBody: &*NSString::from_str(body)];

            let notif_req_cls = objc2::runtime::AnyClass::get("UNNotificationRequest")
                .expect("UNNotificationRequest");
            let null_trigger: *const AnyObject = std::ptr::null();
            let request: Retained<AnyObject> = msg_send_id![
                notif_req_cls,
                requestWithIdentifier: &*NSString::from_str(&notification_identifier_for_pane(pane_id))
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
