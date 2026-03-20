// PlatformPort — native platform pointers and window management.

pub(crate) trait PlatformPort {
    fn set_content_view_ptr(&mut self, ptr: Option<*mut std::ffi::c_void>);
    fn content_view_ptr(&self) -> Option<*mut std::ffi::c_void>;
    fn set_window_ptr(&mut self, ptr: Option<*mut std::ffi::c_void>);
    fn window_ptr(&self) -> Option<*mut std::ffi::c_void>;
    fn window_shown(&self) -> bool;
    fn set_window_shown(&mut self, shown: bool);
}
