// PlatformPtrs — platform pointers.

pub(crate) struct PlatformPtrs {
    pub content_view_ptr: Option<*mut std::ffi::c_void>,
    pub window_ptr: Option<*mut std::ffi::c_void>,
    pub window_shown: bool,
}

impl PlatformPtrs {
    pub fn new() -> Self { Self { content_view_ptr: None, window_ptr: None, window_shown: false } }
}
