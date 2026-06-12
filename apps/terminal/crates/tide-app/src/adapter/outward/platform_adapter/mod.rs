//! Platform abstraction layer for Tide.
//!
//! Provides native windowing, input, and IME support via platform-specific backends.
//! Currently implements macOS via `objc2`; Windows/Linux backends can be added later.

#[cfg(target_os = "macos")]
pub mod macos;

use crate::tide_core::{Key, Modifiers, TideWindowId};
use raw_window_handle::{HasDisplayHandle, HasWindowHandle};

// ──────────────────────────────────────────────
// Platform Events
// ──────────────────────────────────────────────

/// Platform-agnostic event delivered by the native backend.
/// `Deserialize` enables the E2E test driver to inject synthetic events
/// (`test-inject-event`) through the real event path.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum PlatformEvent {
    /// A key was pressed. `chars` contains the text produced (if any).
    KeyDown {
        key: Key,
        modifiers: Modifiers,
        chars: Option<String>,
    },
    /// A key was released.
    KeyUp {
        key: Key,
        modifiers: Modifiers,
    },
    /// Modifier key state changed (Shift, Ctrl, Alt, Meta).
    ModifiersChanged(Modifiers),

    // ── IME ──
    /// IME committed final text (composition done).
    ImeCommit(String),
    /// IME preedit (composition in progress).
    ImePreedit {
        text: String,
        cursor: Option<usize>,
    },

    // ── Mouse ──
    MouseDown {
        button: MouseButton,
        position: (f64, f64),
    },
    MouseUp {
        button: MouseButton,
        position: (f64, f64),
    },
    MouseMoved {
        position: (f64, f64),
    },
    Scroll {
        dx: f32,
        dy: f32,
        position: (f64, f64),
    },

    // ── Window ──
    Resized {
        width: u32,
        height: u32,
    },
    ScaleFactorChanged(f64),
    Focused(bool),
    CloseRequested,
    RedrawRequested,
    Fullscreen {
        is_fullscreen: bool,
        /// Current window inner size at the time of the fullscreen transition.
        /// Included so the app thread doesn't need to query the window.
        width: u32,
        height: u32,
    },
    /// The window's occlusion state changed (fully obscured or visible again).
    Occluded(bool),

    /// The window's first responder is a non-Tide view (e.g. WKWebView).
    /// Emitted from performKeyEquivalent so the app can update focus state
    /// before processing the shortcut.
    WebViewFocused,

    /// Begin an event batch: suppress rendering until the matching `BatchEnd`.
    /// Used by ImeProxyView to flush deferred IME events atomically so that
    /// intermediate states (e.g. Backspace before replacement commit) never
    /// render a partial frame.
    BatchStart,
    /// End an event batch and allow rendering to proceed.
    BatchEnd,
    /// A macOS system notification created by Tide was activated by the user.
    SystemNotificationActivated {
        pane_id: u64,
    },
    /// The macOS notification center reported the bundled app's current
    /// notification-authorization status.
    NotificationAuthorizationStatusChanged {
        status: crate::state::NotificationAuthorizationStatus,
    },
}

/// Mouse button identifiers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum MouseButton {
    Left,
    Right,
    Middle,
    Other(u16),
}

// ──────────────────────────────────────────────
// Cursor icons
// ──────────────────────────────────────────────

/// Platform-agnostic cursor icon.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CursorIcon {
    Default,
    IBeam,
    Pointer,
    Grab,
    ColResize,
    RowResize,
}

// ──────────────────────────────────────────────
// Window trait
// ──────────────────────────────────────────────

/// A platform window that can be used for rendering and input.
pub trait PlatformWindow: HasWindowHandle + HasDisplayHandle {
    fn request_redraw(&self);
    fn set_cursor_icon(&self, icon: CursorIcon);
    fn inner_size(&self) -> (u32, u32);
    fn scale_factor(&self) -> f64;
    fn set_fullscreen(&self, fullscreen: bool);
    fn is_fullscreen(&self) -> bool;

    // ── Per-pane IME proxy management ──

    /// Create an IME proxy view for the given pane. Idempotent.
    fn create_ime_proxy(&self, pane_id: u64);
    /// Remove the IME proxy view for the given pane. No-op if not present.
    fn remove_ime_proxy(&self, pane_id: u64);
    /// Make the proxy for the given pane the first responder (receives keyboard/IME).
    /// Triggers `unmarkText` on the previously focused proxy, clearing any
    /// in-progress IME composition.
    fn focus_ime_proxy(&self, pane_id: u64);
    /// Update the IME candidate window position for a specific pane's proxy.
    fn set_ime_proxy_cursor_area(&self, pane_id: u64, x: f64, y: f64, w: f64, h: f64);

    /// Return a raw pointer to the content NSView (macOS) for subview management.
    /// Returns `None` on platforms that don't support native subviews.
    fn content_view_ptr(&self) -> Option<*mut std::ffi::c_void> {
        None
    }

    /// Return a raw pointer to the NSWindow (macOS) for first responder management.
    /// Returns `None` on platforms that don't support this.
    fn window_ptr(&self) -> Option<*mut std::ffi::c_void> {
        None
    }

    /// Reveal the window (set alpha to 1). Called after the first frame renders
    /// so the user never sees a blank window during GPU initialization.
    fn show_window(&self) {}

    /// Close the native window after the owning `App` accepts the close request.
    fn close_window(&self) {}

    /// Send a macOS system notification via UNUserNotificationCenter.
    /// Silent fail if permission is not granted.
    fn send_system_notification(&self, _title: &str, _body: &str, _pane_id: u64) {}

    /// Request macOS notification permission proactively.
    fn request_notification_permission(&self) {}

    /// Request user attention (dock bounce). Uses informational (single bounce).
    fn request_user_attention(&self) {}
}

// ──────────────────────────────────────────────
// Window configuration
// ──────────────────────────────────────────────

/// Configuration for creating a platform window.
#[derive(Clone)]
pub struct WindowConfig {
    pub title: String,
    pub width: f64,
    pub height: f64,
    pub min_width: f64,
    pub min_height: f64,
    pub transparent_titlebar: bool,
}

impl Default for WindowConfig {
    fn default() -> Self {
        Self {
            title: "Tide".to_string(),
            width: 960.0,
            height: 640.0,
            min_width: 400.0,
            min_height: 300.0,
            transparent_titlebar: true,
        }
    }
}

// ──────────────────────────────────────────────
// App callback
// ──────────────────────────────────────────────

/// Callback invoked by the platform for each event.
/// The `&dyn PlatformWindow` reference is valid for the duration of the call.
pub type EventCallback = Box<dyn FnMut(PlatformEvent, &dyn PlatformWindow)>;

/// Callback to wake the event loop from a background thread.
/// Uses Arc so it can be cloned and sent to multiple background threads.
pub type WakeCallback = std::sync::Arc<dyn Fn() + Send + Sync + 'static>;

// ──────────────────────────────────────────────
// Window commands (app thread → main thread)
// ──────────────────────────────────────────────

/// Commands that the app thread sends to the main thread for execution.
/// These wrap all `PlatformWindow` methods that mutate UI state.
#[derive(Debug)]
pub enum WindowCommand {
    RequestRedraw,
    CreateWindow {
        width: f64,
        height: f64,
    },
    CloseWindow,
    ShowWindow,
    SetFullscreen(bool),
    SetCursorIcon(CursorIcon),
    CreateImeProxy(u64),
    RemoveImeProxy(u64),
    FocusImeProxy(u64),
    SetImeCursorArea {
        pane_id: u64,
        x: f64,
        y: f64,
        w: f64,
        h: f64,
    },
    SendSystemNotification {
        title: String,
        body: String,
        pane_id: u64,
    },
    RequestNotificationPermission,
    RequestUserAttention,
    BroadcastSettingsChanged,
}

/// A `WindowCommand` addressed to one `Tide Window`.
#[derive(Debug)]
pub struct WindowCommandEnvelope {
    pub tide_window_id: TideWindowId,
    pub command: WindowCommand,
}

/// Show a native macOS confirm dialog for window close.
/// Returns true if the user confirms, false if cancelled.
/// Safe to call from any thread — dispatches to main thread via dispatch_sync.
#[cfg(target_os = "macos")]
pub fn show_close_confirm() -> bool {
    use std::sync::atomic::{AtomicBool, Ordering};

    extern "C" {
        static _dispatch_main_q: std::ffi::c_void;
        fn dispatch_sync_f(
            queue: *const std::ffi::c_void,
            context: *mut std::ffi::c_void,
            work: unsafe extern "C" fn(*mut std::ffi::c_void),
        );
    }

    unsafe extern "C" fn show_alert(ctx: *mut std::ffi::c_void) {
        use objc2::msg_send;
        use objc2::msg_send_id;
        use objc2::rc::Retained;
        use objc2::runtime::{AnyClass, AnyObject};
        use objc2_foundation::NSString;

        let result = &*(ctx as *const AtomicBool);
        unsafe {
            let alert_cls = AnyClass::get("NSAlert").expect("NSAlert class must exist");
            let alert: Retained<AnyObject> = msg_send_id![alert_cls, new];
            let _: () =
                msg_send![&alert, setMessageText: &*NSString::from_str("Close this window?")];
            let _: () = msg_send![&alert, setInformativeText: &*NSString::from_str("Running processes in this Tide Window will be terminated.")];
            let _: () = msg_send![&alert, addButtonWithTitle: &*NSString::from_str("Close")];
            let _: () = msg_send![&alert, addButtonWithTitle: &*NSString::from_str("Cancel")];
            let _: () = msg_send![&alert, setAlertStyle: 0_isize];
            let response: isize = msg_send![&alert, runModal];
            result.store(response == 1000, Ordering::SeqCst);
        }
    }

    let confirmed = AtomicBool::new(false);
    unsafe {
        dispatch_sync_f(
            std::ptr::addr_of!(_dispatch_main_q),
            (&confirmed as *const AtomicBool as *mut AtomicBool).cast(),
            show_alert,
        );
    }
    confirmed.load(Ordering::SeqCst)
}

/// Execute a `WindowCommand` on the main thread using the actual window.
pub fn execute_window_command(window: &dyn PlatformWindow, cmd: WindowCommand) {
    match cmd {
        WindowCommand::RequestRedraw => window.request_redraw(),
        WindowCommand::CreateWindow { .. } => {}
        WindowCommand::CloseWindow => window.close_window(),
        WindowCommand::ShowWindow => window.show_window(),
        WindowCommand::SetFullscreen(fs) => window.set_fullscreen(fs),
        WindowCommand::SetCursorIcon(icon) => window.set_cursor_icon(icon),
        WindowCommand::CreateImeProxy(id) => window.create_ime_proxy(id),
        WindowCommand::RemoveImeProxy(id) => window.remove_ime_proxy(id),
        WindowCommand::FocusImeProxy(id) => window.focus_ime_proxy(id),
        WindowCommand::SetImeCursorArea {
            pane_id,
            x,
            y,
            w,
            h,
        } => {
            window.set_ime_proxy_cursor_area(pane_id, x, y, w, h);
        }
        WindowCommand::SendSystemNotification {
            ref title,
            ref body,
            pane_id,
        } => {
            window.send_system_notification(title, body, pane_id);
        }
        WindowCommand::RequestNotificationPermission => {
            window.request_notification_permission();
        }
        WindowCommand::RequestUserAttention => {
            window.request_user_attention();
        }
        WindowCommand::BroadcastSettingsChanged => {}
    }
}

// ──────────────────────────────────────────────
// Window proxy (Send, for app thread)
// ──────────────────────────────────────────────

/// A thread-safe proxy for sending window commands from the app thread.
/// Commands are queued and executed on the main thread.
#[derive(Clone)]
pub struct WindowProxy {
    sink: WindowCommandSink,
    tide_window_id: TideWindowId,
    waker: WakeCallback,
}

#[derive(Clone)]
enum WindowCommandSink {
    Legacy(std::sync::mpsc::Sender<WindowCommand>),
    Targeted(std::sync::mpsc::Sender<WindowCommandEnvelope>),
}

impl WindowProxy {
    pub fn new(cmd_tx: std::sync::mpsc::Sender<WindowCommand>, waker: WakeCallback) -> Self {
        Self {
            sink: WindowCommandSink::Legacy(cmd_tx),
            tide_window_id: TideWindowId::default(),
            waker,
        }
    }

    pub fn new_for_window(
        tide_window_id: TideWindowId,
        cmd_tx: std::sync::mpsc::Sender<WindowCommandEnvelope>,
        waker: WakeCallback,
    ) -> Self {
        Self {
            sink: WindowCommandSink::Targeted(cmd_tx),
            tide_window_id,
            waker,
        }
    }

    pub fn tide_window_id(&self) -> TideWindowId {
        self.tide_window_id
    }

    fn send(&self, cmd: WindowCommand) {
        match &self.sink {
            WindowCommandSink::Legacy(cmd_tx) => {
                let _ = cmd_tx.send(cmd);
            }
            WindowCommandSink::Targeted(cmd_tx) => {
                let _ = cmd_tx.send(WindowCommandEnvelope {
                    tide_window_id: self.tide_window_id,
                    command: cmd,
                });
            }
        }
    }

    /// Send commands and wake the main thread to execute them.
    fn send_and_wake(&self, cmd: WindowCommand) {
        self.send(cmd);
        (self.waker)();
    }

    pub fn request_redraw(&self) {
        self.send_and_wake(WindowCommand::RequestRedraw);
    }

    pub fn create_window(&self, width: f64, height: f64) {
        self.send_and_wake(WindowCommand::CreateWindow { width, height });
    }

    pub fn close_window(&self) {
        self.send_and_wake(WindowCommand::CloseWindow);
    }

    pub fn show_window(&self) {
        self.send_and_wake(WindowCommand::ShowWindow);
    }

    pub fn set_fullscreen(&self, fullscreen: bool) {
        self.send_and_wake(WindowCommand::SetFullscreen(fullscreen));
    }

    pub fn set_cursor_icon(&self, icon: CursorIcon) {
        self.send(WindowCommand::SetCursorIcon(icon));
    }

    pub fn create_ime_proxy(&self, pane_id: u64) {
        self.send_and_wake(WindowCommand::CreateImeProxy(pane_id));
    }

    pub fn remove_ime_proxy(&self, pane_id: u64) {
        self.send_and_wake(WindowCommand::RemoveImeProxy(pane_id));
    }

    pub fn focus_ime_proxy(&self, pane_id: u64) {
        self.send_and_wake(WindowCommand::FocusImeProxy(pane_id));
    }

    pub fn set_ime_proxy_cursor_area(&self, pane_id: u64, x: f64, y: f64, w: f64, h: f64) {
        self.send(WindowCommand::SetImeCursorArea {
            pane_id,
            x,
            y,
            w,
            h,
        });
    }

    pub fn send_system_notification(&self, title: &str, body: &str, pane_id: u64) {
        self.send(WindowCommand::SendSystemNotification {
            title: title.to_string(),
            body: body.to_string(),
            pane_id,
        });
    }

    pub fn request_notification_permission(&self) {
        self.send(WindowCommand::RequestNotificationPermission);
    }

    pub fn request_user_attention(&self) {
        self.send(WindowCommand::RequestUserAttention);
    }

    pub fn broadcast_settings_changed(&self) {
        self.send_and_wake(WindowCommand::BroadcastSettingsChanged);
    }
}

// ── Port adapter implementations ──

use crate::application::ports::outward::platform_port::PlatformPort;

pub(crate) struct RealPlatform {
    content_view_ptr: Option<*mut std::ffi::c_void>,
    window_ptr: Option<*mut std::ffi::c_void>,
    window_shown: bool,
}
unsafe impl Send for RealPlatform {}

impl RealPlatform {
    pub fn new() -> Self {
        Self {
            content_view_ptr: None,
            window_ptr: None,
            window_shown: false,
        }
    }
}

impl PlatformPort for RealPlatform {
    fn set_content_view_ptr(&mut self, ptr: Option<*mut std::ffi::c_void>) {
        self.content_view_ptr = ptr;
    }
    fn content_view_ptr(&self) -> Option<*mut std::ffi::c_void> {
        self.content_view_ptr
    }
    fn set_window_ptr(&mut self, ptr: Option<*mut std::ffi::c_void>) {
        self.window_ptr = ptr;
    }
    fn window_ptr(&self) -> Option<*mut std::ffi::c_void> {
        self.window_ptr
    }
    fn window_shown(&self) -> bool {
        self.window_shown
    }
    fn set_window_shown(&mut self, shown: bool) {
        self.window_shown = shown;
    }
}

pub(crate) struct NoopPlatform;

impl PlatformPort for NoopPlatform {
    fn set_content_view_ptr(&mut self, _ptr: Option<*mut std::ffi::c_void>) {}
    fn content_view_ptr(&self) -> Option<*mut std::ffi::c_void> {
        None
    }
    fn set_window_ptr(&mut self, _ptr: Option<*mut std::ffi::c_void>) {}
    fn window_ptr(&self) -> Option<*mut std::ffi::c_void> {
        None
    }
    fn window_shown(&self) -> bool {
        false
    }
    fn set_window_shown(&mut self, _shown: bool) {}
}
