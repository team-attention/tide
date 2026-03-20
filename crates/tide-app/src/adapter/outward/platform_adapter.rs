// Platform adapter implementations.

use crate::application::ports::outward::platform_port::PlatformPort;

// ── Real implementation (production) ──

pub(crate) struct RealPlatform {
    content_view_ptr: Option<*mut std::ffi::c_void>,
    window_ptr: Option<*mut std::ffi::c_void>,
    window_shown: bool,
}

// Safety: raw pointers are only used for webview management on the main thread.
unsafe impl Send for RealPlatform {}

impl RealPlatform {
    pub fn new() -> Self {
        Self { content_view_ptr: None, window_ptr: None, window_shown: false }
    }
}

impl PlatformPort for RealPlatform {
    fn set_content_view_ptr(&mut self, ptr: Option<*mut std::ffi::c_void>) { self.content_view_ptr = ptr; }
    fn content_view_ptr(&self) -> Option<*mut std::ffi::c_void> { self.content_view_ptr }
    fn set_window_ptr(&mut self, ptr: Option<*mut std::ffi::c_void>) { self.window_ptr = ptr; }
    fn window_ptr(&self) -> Option<*mut std::ffi::c_void> { self.window_ptr }
    fn window_shown(&self) -> bool { self.window_shown }
    fn set_window_shown(&mut self, shown: bool) { self.window_shown = shown; }
}

// ── Noop implementation (tests) ──

pub(crate) struct NoopPlatform;

impl PlatformPort for NoopPlatform {
    fn set_content_view_ptr(&mut self, _ptr: Option<*mut std::ffi::c_void>) {}
    fn content_view_ptr(&self) -> Option<*mut std::ffi::c_void> { None }
    fn set_window_ptr(&mut self, _ptr: Option<*mut std::ffi::c_void>) {}
    fn window_ptr(&self) -> Option<*mut std::ffi::c_void> { None }
    fn window_shown(&self) -> bool { false }
    fn set_window_shown(&mut self, _shown: bool) {}
}
