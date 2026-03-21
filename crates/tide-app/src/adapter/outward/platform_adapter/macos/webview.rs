//! WKWebView wrapper for embedded browser functionality.
//!
//! Uses raw `objc2` message sends to interact with WebKit classes,
//! avoiding a direct WebKit crate dependency.

use std::sync::Mutex;

use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, Bool};
use objc2::{declare_class, msg_send, msg_send_id, mutability, ClassType, DeclaredClass};
use objc2_foundation::{CGFloat, MainThreadMarker, NSObject, NSRect, NSPoint, NSSize, NSString};

/// Global queue for URLs that should open in a new browser tab.
/// Populated by the WKUIDelegate when Cmd+click triggers a new window request.
static NEW_TAB_URLS: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// Global queue for messages received from render pane JS bridge.
/// Populated by WKScriptMessageHandler when JS calls `window.tide.send(json)`.
static BRIDGE_MESSAGES: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// Drain all pending bridge messages. Call from the app event loop.
pub fn drain_bridge_messages() -> Vec<String> {
    let mut queue = BRIDGE_MESSAGES.lock().unwrap_or_else(|e| e.into_inner());
    std::mem::take(&mut *queue)
}

/// Drain all pending new-tab URLs. Call from the app event loop.
pub fn drain_new_tab_urls() -> Vec<String> {
    let mut queue = NEW_TAB_URLS.lock().unwrap_or_else(|e| e.into_inner());
    std::mem::take(&mut *queue)
}

// ---------------------------------------------------------------------------
// WKUIDelegate — handles popups, JavaScript dialogs, etc.
// ---------------------------------------------------------------------------
declare_class!(
    struct TideUIDelegate;

    unsafe impl ClassType for TideUIDelegate {
        type Super = NSObject;
        type Mutability = mutability::MainThreadOnly;
        const NAME: &'static str = "TideUIDelegate";
    }

    impl DeclaredClass for TideUIDelegate {
        type Ivars = ();
    }

    unsafe impl TideUIDelegate {
        #[method_id(init)]
        fn init(this: objc2::rc::Allocated<Self>) -> Option<Retained<Self>> {
            let this = this.set_ivars(());
            unsafe { msg_send_id![super(this), init] }
        }

        /// Handle window.open() / target=_blank — load in same webview (no popup windows).
        #[method_id(webView:createWebViewWithConfiguration:forNavigationAction:windowFeatures:)]
        fn create_webview(
            &self,
            webview: &AnyObject,
            _config: &AnyObject,
            navigation_action: &AnyObject,
            _window_features: &AnyObject,
        ) -> Option<Retained<AnyObject>> {
            unsafe {
                let request: Retained<AnyObject> = msg_send_id![navigation_action, request];
                let _: Option<Retained<AnyObject>> =
                    msg_send_id![webview, loadRequest: &*request];
            }
            None
        }

        /// Handle JavaScript alert() — show native NSAlert.
        #[method(webView:runJavaScriptAlertPanelWithMessage:initiatedByFrame:completionHandler:)]
        fn run_alert(
            &self,
            _webview: &AnyObject,
            message: &NSString,
            _frame: &AnyObject,
            completion: &block2::Block<dyn Fn()>,
        ) {
            unsafe {
                // Show a native NSAlert
                let alert_cls = AnyClass::get("NSAlert").expect("NSAlert class must exist");
                let alert: Retained<AnyObject> = msg_send_id![alert_cls, new];
                let _: () = msg_send![&alert, setMessageText: message];
                let _: () = msg_send![&alert, addButtonWithTitle: &*NSString::from_str("OK")];
                let _: isize = msg_send![&alert, runModal];
            }
            completion.call(());
        }

        /// Handle JavaScript confirm() — show native NSAlert with OK/Cancel.
        #[method(webView:runJavaScriptConfirmPanelWithMessage:initiatedByFrame:completionHandler:)]
        fn run_confirm(
            &self,
            _webview: &AnyObject,
            message: &NSString,
            _frame: &AnyObject,
            completion: &block2::Block<dyn Fn(Bool)>,
        ) {
            let result = unsafe {
                let alert_cls = AnyClass::get("NSAlert").expect("NSAlert class must exist");
                let alert: Retained<AnyObject> = msg_send_id![alert_cls, new];
                let _: () = msg_send![&alert, setMessageText: message];
                let _: () = msg_send![&alert, addButtonWithTitle: &*NSString::from_str("OK")];
                let _: () = msg_send![&alert, addButtonWithTitle: &*NSString::from_str("Cancel")];
                let response: isize = msg_send![&alert, runModal];
                // NSAlertFirstButtonReturn = 1000
                response == 1000
            };
            completion.call((Bool::new(result),));
        }

        /// Handle JavaScript prompt() — show native NSAlert with text field.
        #[method(webView:runJavaScriptTextInputPanelWithPrompt:defaultText:initiatedByFrame:completionHandler:)]
        fn run_prompt(
            &self,
            _webview: &AnyObject,
            prompt: &NSString,
            default_text: Option<&NSString>,
            _frame: &AnyObject,
            completion: &block2::Block<dyn Fn(*mut NSString)>,
        ) {
            unsafe {
                let alert_cls = AnyClass::get("NSAlert").expect("NSAlert class must exist");
                let alert: Retained<AnyObject> = msg_send_id![alert_cls, new];
                let _: () = msg_send![&alert, setMessageText: prompt];
                let _: () = msg_send![&alert, addButtonWithTitle: &*NSString::from_str("OK")];
                let _: () = msg_send![&alert, addButtonWithTitle: &*NSString::from_str("Cancel")];

                // Add a text field to the alert
                let text_field_cls = AnyClass::get("NSTextField").expect("NSTextField class must exist");
                let frame = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(300.0, 24.0));
                let field: Retained<AnyObject> = msg_send_id![
                    msg_send_id![text_field_cls, alloc],
                    initWithFrame: frame
                ];
                if let Some(dt) = default_text {
                    let _: () = msg_send![&field, setStringValue: dt];
                }
                let _: () = msg_send![&alert, setAccessoryView: &*field];

                let response: isize = msg_send![&alert, runModal];
                if response == 1000 {
                    // NSAlertFirstButtonReturn — user clicked OK
                    let value: Retained<NSString> = msg_send_id![&field, stringValue];
                    completion.call((&*value as *const NSString as *mut NSString,));
                } else {
                    completion.call((std::ptr::null_mut(),));
                }
            }
        }
    }
);

// ---------------------------------------------------------------------------
// WKNavigationDelegate — handles download responses
// ---------------------------------------------------------------------------
declare_class!(
    struct TideNavigationDelegate;

    unsafe impl ClassType for TideNavigationDelegate {
        type Super = NSObject;
        type Mutability = mutability::MainThreadOnly;
        const NAME: &'static str = "TideNavigationDelegate";
    }

    impl DeclaredClass for TideNavigationDelegate {
        type Ivars = ();
    }

    unsafe impl TideNavigationDelegate {
        #[method_id(init)]
        fn init(this: objc2::rc::Allocated<Self>) -> Option<Retained<Self>> {
            let this = this.set_ivars(());
            unsafe { msg_send_id![super(this), init] }
        }

        /// Handle navigation action — intercept Cmd+click to open in new tab.
        /// WKNavigationActionPolicy: .cancel = 0, .allow = 1
        #[method(webView:decidePolicyForNavigationAction:decisionHandler:)]
        fn decide_policy_for_action(
            &self,
            _webview: &AnyObject,
            navigation_action: &AnyObject,
            decision_handler: &block2::Block<dyn Fn(i64)>,
        ) {
            unsafe {
                // Check modifier flags for Cmd key (NSEventModifierFlagCommand = 1 << 20)
                let modifier_flags: usize = msg_send![navigation_action, modifierFlags];
                let cmd_held = modifier_flags & (1 << 20) != 0;

                // WKNavigationType: linkActivated = 0
                let nav_type: isize = msg_send![navigation_action, navigationType];
                let is_link_click = nav_type == 0;

                if cmd_held && is_link_click {
                    // Cmd+click on a link: queue URL for new tab, cancel navigation
                    let request: Retained<AnyObject> = msg_send_id![navigation_action, request];
                    let url_obj: Option<Retained<AnyObject>> = msg_send_id![&request, URL];
                    if let Some(url) = url_obj {
                        let abs: Option<Retained<AnyObject>> = msg_send_id![&url, absoluteString];
                        if let Some(s) = abs {
                            let utf8: *const std::ffi::c_char = msg_send![&s, UTF8String];
                            if !utf8.is_null() {
                                let url_str = std::ffi::CStr::from_ptr(utf8).to_string_lossy().into_owned();
                                if let Ok(mut queue) = NEW_TAB_URLS.lock() {
                                    queue.push(url_str);
                                }
                            }
                        }
                    }
                    decision_handler.call((0,)); // .cancel — don't navigate current webview
                    return;
                }

                decision_handler.call((1,)); // .allow
            }
        }

        /// Handle navigation response — detect downloads and open in system browser.
        /// WKNavigationResponsePolicy: .allow = 1, .cancel = 0, .download = 2
        #[method(webView:decidePolicyForNavigationResponse:decisionHandler:)]
        fn decide_policy_for_response(
            &self,
            _webview: &AnyObject,
            navigation_response: &AnyObject,
            decision_handler: &block2::Block<dyn Fn(i64)>,
        ) {
            unsafe {
                let can_show: Bool = msg_send![navigation_response, canShowMIMEType];
                if can_show.as_bool() {
                    // WebView can render this content — allow it
                    decision_handler.call((1,)); // .allow
                } else {
                    // WebView can't render (likely a download) — open in system browser
                    let response: Retained<AnyObject> = msg_send_id![navigation_response, response];
                    let url: Option<Retained<AnyObject>> = msg_send_id![&response, URL];
                    if let Some(url) = url {
                        let workspace_cls = AnyClass::get("NSWorkspace").expect("NSWorkspace class");
                        let shared: Retained<AnyObject> = msg_send_id![workspace_cls, sharedWorkspace];
                        let _: Bool = msg_send![&shared, openURL: &*url];
                    }
                    decision_handler.call((0,)); // .cancel
                }
            }
        }
    }
);

// Raw libdispatch FFI for dispatching WebView creation to the main thread.
// `dispatch_get_main_queue()` is a C macro; the actual symbol is `_dispatch_main_q`.
extern "C" {
    static _dispatch_main_q: std::ffi::c_void;
    fn dispatch_sync_f(
        queue: *const std::ffi::c_void,
        context: *mut std::ffi::c_void,
        work: unsafe extern "C" fn(*mut std::ffi::c_void),
    );
}

// ---------------------------------------------------------------------------
// WKScriptMessageHandler — receives window.tide.send() messages from JS
// ---------------------------------------------------------------------------
declare_class!(
    struct TideScriptMessageHandler;

    unsafe impl ClassType for TideScriptMessageHandler {
        type Super = NSObject;
        type Mutability = mutability::MainThreadOnly;
        const NAME: &'static str = "TideScriptMessageHandler";
    }

    impl DeclaredClass for TideScriptMessageHandler {
        type Ivars = ();
    }

    unsafe impl TideScriptMessageHandler {
        #[method_id(init)]
        fn init(this: objc2::rc::Allocated<Self>) -> Option<Retained<Self>> {
            let this = this.set_ivars(());
            unsafe { msg_send_id![super(this), init] }
        }

        /// Called by WebKit when JS calls window.webkit.messageHandlers.tide.postMessage(msg)
        #[method(userContentController:didReceiveScriptMessage:)]
        fn did_receive_message(
            &self,
            _controller: &AnyObject,
            message: &AnyObject,
        ) {
            unsafe {
                let body: Retained<AnyObject> = msg_send_id![message, body];
                // body is an NSString (we JSON.stringify in the bridge)
                let utf8: *const std::ffi::c_char = msg_send![&body, UTF8String];
                if !utf8.is_null() {
                    let msg_str = std::ffi::CStr::from_ptr(utf8).to_string_lossy().into_owned();
                    let mut queue = BRIDGE_MESSAGES.lock().unwrap_or_else(|e| e.into_inner());
                    queue.push(msg_str);
                }
            }
        }
    }
);

/// Handle to a WKWebView instance, added as a subview of the parent NSView.
pub struct WebViewHandle {
    webview: Retained<AnyObject>,
    /// Retained so the weak UIDelegate reference stays valid.
    _ui_delegate: Retained<TideUIDelegate>,
    /// Retained so the weak NavigationDelegate reference stays valid.
    _nav_delegate: Retained<TideNavigationDelegate>,
    /// Retained so the WKScriptMessageHandler stays alive.
    _script_handler: Retained<TideScriptMessageHandler>,
}

/// Context passed through `dispatch_sync_f` to create a WKWebView on the main thread.
struct WebViewCreateCtx {
    parent_view: *mut std::ffi::c_void,
    result: Option<WebViewHandle>,
}

/// Trampoline called on the main thread by `dispatch_sync_f`.
unsafe extern "C" fn create_webview_on_main_thread(ctx: *mut std::ffi::c_void) {
    let ctx = &mut *(ctx as *mut WebViewCreateCtx);
    ctx.result = WebViewHandle::new_on_main_thread(ctx.parent_view);
}

/// Context passed through `dispatch_sync_f` to navigate on the main thread.
struct NavigateCtx {
    webview: *const AnyObject,
    url_ptr: *const u8,
    url_len: usize,
}

/// Trampoline called on the main thread by `dispatch_sync_f`.
unsafe extern "C" fn navigate_on_main_thread(ctx_ptr: *mut std::ffi::c_void) {
    let ctx = &*(ctx_ptr as *const NavigateCtx);
    let url = std::str::from_utf8_unchecked(std::slice::from_raw_parts(ctx.url_ptr, ctx.url_len));
    let webview = &*ctx.webview;

    let url_cls = AnyClass::get("NSURL").expect("NSURL class");
    let ns_url_str = NSString::from_str(url);
    let nsurl: Option<Retained<AnyObject>> =
        msg_send_id![url_cls, URLWithString: &*ns_url_str];
    let Some(nsurl) = nsurl else { return };

    let req_cls = AnyClass::get("NSURLRequest").expect("NSURLRequest class");
    let request: Retained<AnyObject> =
        msg_send_id![req_cls, requestWithURL: &*nsurl];

    let _: Option<Retained<AnyObject>> =
        msg_send_id![webview, loadRequest: &*request];
}

/// Context passed through `dispatch_sync_f` to set the webview frame.
struct SetFrameCtx {
    webview: *const AnyObject,
    frame: NSRect,
}

/// Trampoline called on the main thread by `dispatch_sync_f`.
unsafe extern "C" fn set_frame_on_main_thread(ctx_ptr: *mut std::ffi::c_void) {
    let ctx = &*(ctx_ptr as *const SetFrameCtx);
    let webview = &*ctx.webview;
    let _: () = msg_send![webview, setFrame: ctx.frame];
}

/// Context passed through `dispatch_sync_f` to show/hide the webview.
struct SetVisibleCtx {
    webview: *const AnyObject,
    hidden: Bool,
}

/// Trampoline called on the main thread by `dispatch_sync_f`.
unsafe extern "C" fn set_visible_on_main_thread(ctx_ptr: *mut std::ffi::c_void) {
    let ctx = &*(ctx_ptr as *const SetVisibleCtx);
    let webview = &*ctx.webview;
    let _: () = msg_send![webview, setHidden: ctx.hidden];
}

/// Context passed through `dispatch_sync_f` to make the webview first responder.
struct MakeFirstResponderCtx {
    webview: *const AnyObject,
    window: *const AnyObject,
}

/// Trampoline called on the main thread by `dispatch_sync_f`.
unsafe extern "C" fn make_first_responder_on_main_thread(ctx_ptr: *mut std::ffi::c_void) {
    let ctx = &*(ctx_ptr as *const MakeFirstResponderCtx);
    let window = &*ctx.window;
    let webview = &*ctx.webview;
    let _: Bool = msg_send![window, makeFirstResponder: webview];
}

/// Context passed through `dispatch_sync_f` to resign first responder.
struct ResignFirstResponderCtx {
    window: *const AnyObject,
    view: *const AnyObject,
}

/// Trampoline called on the main thread by `dispatch_sync_f`.
unsafe extern "C" fn resign_first_responder_on_main_thread(ctx_ptr: *mut std::ffi::c_void) {
    let ctx = &*(ctx_ptr as *const ResignFirstResponderCtx);
    let window = &*ctx.window;
    let view = &*ctx.view;
    let _: Bool = msg_send![window, makeFirstResponder: view];
}

struct RemoveFromParentCtx {
    webview: *const AnyObject,
}

/// Trampoline called on the main thread by `dispatch_sync_f`.
unsafe extern "C" fn remove_from_parent_on_main_thread(ctx_ptr: *mut std::ffi::c_void) {
    let ctx = &*(ctx_ptr as *const RemoveFromParentCtx);
    let _: () = msg_send![ctx.webview, removeFromSuperview];
}

/// Context passed through `dispatch_sync_f` to load HTML string on the main thread.
struct LoadHtmlCtx {
    webview: *const AnyObject,
    html_ptr: *const u8,
    html_len: usize,
}

/// Trampoline called on the main thread by `dispatch_sync_f`.
unsafe extern "C" fn load_html_on_main_thread(ctx_ptr: *mut std::ffi::c_void) {
    let ctx = &*(ctx_ptr as *const LoadHtmlCtx);
    let html = std::str::from_utf8_unchecked(std::slice::from_raw_parts(ctx.html_ptr, ctx.html_len));
    let webview = &*ctx.webview;
    let ns_html = NSString::from_str(html);
    let _: Option<Retained<AnyObject>> = msg_send_id![
        webview,
        loadHTMLString: &*ns_html,
        baseURL: std::ptr::null::<AnyObject>()
    ];
}

/// Context passed through `dispatch_sync_f` to evaluate JavaScript on the main thread.
struct EvalJsCtx {
    webview: *const AnyObject,
    js_ptr: *const u8,
    js_len: usize,
}

/// Trampoline called on the main thread by `dispatch_sync_f`.
unsafe extern "C" fn eval_js_on_main_thread(ctx_ptr: *mut std::ffi::c_void) {
    let ctx = &*(ctx_ptr as *const EvalJsCtx);
    let js = std::str::from_utf8_unchecked(std::slice::from_raw_parts(ctx.js_ptr, ctx.js_len));
    let webview = &*ctx.webview;
    let ns_js = NSString::from_str(js);
    let _: () = msg_send![webview, evaluateJavaScript: &*ns_js completionHandler: std::ptr::null::<AnyObject>()];
}

impl WebViewHandle {
    /// Create a new WKWebView and add it as a subview of the given parent NSView.
    ///
    /// WebKit **must** be initialised on the main thread.  This method dispatches
    /// synchronously to the main queue so callers on any thread are safe.
    ///
    /// # Safety
    /// `parent_view` must be a valid pointer to an NSView that outlives this handle.
    pub unsafe fn new(parent_view: *mut std::ffi::c_void) -> Option<Self> {
        if MainThreadMarker::new().is_some() {
            // Already on the main thread — create directly.
            return Self::new_on_main_thread(parent_view);
        }

        let mut ctx = WebViewCreateCtx { parent_view, result: None };
        dispatch_sync_f(
            &_dispatch_main_q as *const std::ffi::c_void,
            &mut ctx as *mut WebViewCreateCtx as *mut std::ffi::c_void,
            create_webview_on_main_thread,
        );
        ctx.result
    }

    /// Inner creation that **must** run on the main thread.
    ///
    /// # Safety
    /// `parent_view` must be a valid pointer to an NSView.
    unsafe fn new_on_main_thread(parent_view: *mut std::ffi::c_void) -> Option<Self> {
        let parent: &AnyObject = &*(parent_view as *const AnyObject);

        // WKWebViewConfiguration
        let config_cls = AnyClass::get("WKWebViewConfiguration")?;
        let config: Retained<AnyObject> = msg_send_id![config_cls, new];

        // Enable JavaScript popup windows
        let prefs: Retained<AnyObject> = msg_send_id![&config, preferences];
        let _: () = msg_send![&prefs, setJavaScriptCanOpenWindowsAutomatically: Bool::YES];

        // Request desktop content mode (WKWebpagePreferences)
        let page_prefs_cls = AnyClass::get("WKWebpagePreferences");
        if let Some(cls) = page_prefs_cls {
            let page_prefs: Retained<AnyObject> = msg_send_id![cls, new];
            // WKContentMode.desktop = 1
            let _: () = msg_send![&page_prefs, setPreferredContentMode: 1_isize];
            let _: () = msg_send![&config, setDefaultWebpagePreferences: &*page_prefs];
        }

        // WKWebView initWithFrame:configuration:
        let wk_cls = AnyClass::get("WKWebView")?;
        let frame = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(100.0, 100.0));
        let webview: Retained<AnyObject> = msg_send_id![
            msg_send_id![wk_cls, alloc],
            initWithFrame: frame,
            configuration: &*config
        ];

        // Set a complete Safari user agent so sites like Google serve full
        // CSS/JS instead of degraded experiences for unknown browsers.
        let ua = NSString::from_str(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) \
             AppleWebKit/605.1.15 (KHTML, like Gecko) \
             Version/18.3 Safari/605.1.15",
        );
        let _: () = msg_send![&webview, setCustomUserAgent: &*ua];

        // Enable trackpad swipe gestures for back/forward navigation
        let _: () = msg_send![&webview, setAllowsBackForwardNavigationGestures: Bool::YES];

        // Disable opaque background so rounded corners etc. work
        let _: () = msg_send![&webview, setOpaque: Bool::NO];

        // Hide initially until frame is set
        let _: () = msg_send![&webview, setHidden: Bool::YES];

        // Set up UI delegate for popup handling and JavaScript dialogs
        let mtm = MainThreadMarker::new().expect("must be on main thread for WKWebView");
        let delegate: Retained<TideUIDelegate> = unsafe {
            msg_send_id![mtm.alloc::<TideUIDelegate>(), init]
        };
        let _: () = msg_send![&webview, setUIDelegate: &*delegate];

        // Set up navigation delegate for download handling
        let nav_delegate: Retained<TideNavigationDelegate> = unsafe {
            msg_send_id![mtm.alloc::<TideNavigationDelegate>(), init]
        };
        let _: () = msg_send![&webview, setNavigationDelegate: &*nav_delegate];

        // Set up WKScriptMessageHandler for window.tide.send() bridge (BR-29)
        let script_handler: Retained<TideScriptMessageHandler> = unsafe {
            msg_send_id![mtm.alloc::<TideScriptMessageHandler>(), init]
        };
        let user_content: Retained<AnyObject> = msg_send_id![&config, userContentController];
        let handler_name = NSString::from_str("tide");
        let _: () = msg_send![&user_content, addScriptMessageHandler: &*script_handler, name: &*handler_name];

        // Add as subview
        let _: () = msg_send![parent, addSubview: &*webview];

        Some(Self { webview, _ui_delegate: delegate, _nav_delegate: nav_delegate, _script_handler: script_handler })
    }

    /// Navigate to a URL string.
    ///
    /// WKWebView's `loadRequest:` **must** run on the main thread.  This method
    /// dispatches synchronously to the main queue when called from another thread.
    pub fn navigate(&self, url: &str) {
        if MainThreadMarker::new().is_some() {
            unsafe { self.navigate_inner(url) };
            return;
        }

        let mut ctx = NavigateCtx {
            webview: &*self.webview as *const AnyObject,
            url_ptr: url.as_ptr(),
            url_len: url.len(),
        };
        unsafe {
            dispatch_sync_f(
                &_dispatch_main_q as *const std::ffi::c_void,
                &mut ctx as *mut NavigateCtx as *mut std::ffi::c_void,
                navigate_on_main_thread,
            );
        }
    }

    /// Inner navigate that **must** be called on the main thread.
    unsafe fn navigate_inner(&self, url: &str) {
        let url_cls = AnyClass::get("NSURL").expect("NSURL class");
        let ns_url_str = NSString::from_str(url);
        let nsurl: Option<Retained<AnyObject>> =
            msg_send_id![url_cls, URLWithString: &*ns_url_str];
        let Some(nsurl) = nsurl else { return };

        let req_cls = AnyClass::get("NSURLRequest").expect("NSURLRequest class");
        let request: Retained<AnyObject> =
            msg_send_id![req_cls, requestWithURL: &*nsurl];

        let _: Option<Retained<AnyObject>> =
            msg_send_id![&self.webview, loadRequest: &*request];
    }

    /// Go back in history.
    pub fn go_back(&self) {
        unsafe {
            let _: Option<Retained<AnyObject>> = msg_send_id![&self.webview, goBack];
        }
    }

    /// Go forward in history.
    pub fn go_forward(&self) {
        unsafe {
            let _: Option<Retained<AnyObject>> = msg_send_id![&self.webview, goForward];
        }
    }

    /// Reload the current page.
    pub fn reload(&self) {
        unsafe {
            let _: Option<Retained<AnyObject>> = msg_send_id![&self.webview, reload];
        }
    }

    /// Set the frame rect (in logical points) of the webview.
    ///
    /// AppKit's `setFrame:` **must** run on the main thread.  This method
    /// dispatches synchronously to the main queue when called from another thread.
    pub fn set_frame(&self, x: f64, y: f64, w: f64, h: f64) {
        let frame = NSRect::new(
            NSPoint::new(x as CGFloat, y as CGFloat),
            NSSize::new(w as CGFloat, h as CGFloat),
        );
        if MainThreadMarker::new().is_some() {
            unsafe {
                let _: () = msg_send![&self.webview, setFrame: frame];
            }
            return;
        }
        let mut ctx = SetFrameCtx {
            webview: &*self.webview as *const AnyObject,
            frame,
        };
        unsafe {
            dispatch_sync_f(
                &_dispatch_main_q as *const std::ffi::c_void,
                &mut ctx as *mut SetFrameCtx as *mut std::ffi::c_void,
                set_frame_on_main_thread,
            );
        }
    }

    /// Show or hide the webview.
    ///
    /// AppKit's `setHidden:` **must** run on the main thread.  This method
    /// dispatches synchronously to the main queue when called from another thread.
    pub fn set_visible(&self, visible: bool) {
        let hidden = if visible { Bool::NO } else { Bool::YES };
        if MainThreadMarker::new().is_some() {
            unsafe {
                let _: () = msg_send![&self.webview, setHidden: hidden];
            }
            return;
        }
        let mut ctx = SetVisibleCtx {
            webview: &*self.webview as *const AnyObject,
            hidden,
        };
        unsafe {
            dispatch_sync_f(
                &_dispatch_main_q as *const std::ffi::c_void,
                &mut ctx as *mut SetVisibleCtx as *mut std::ffi::c_void,
                set_visible_on_main_thread,
            );
        }
    }

    /// Returns true if the webview can go back.
    pub fn can_go_back(&self) -> bool {
        unsafe {
            let val: Bool = msg_send![&self.webview, canGoBack];
            val.as_bool()
        }
    }

    /// Returns true if the webview can go forward.
    pub fn can_go_forward(&self) -> bool {
        unsafe {
            let val: Bool = msg_send![&self.webview, canGoForward];
            val.as_bool()
        }
    }

    /// Get the current URL as a string, if any.
    pub fn current_url(&self) -> Option<String> {
        unsafe {
            let url: Option<Retained<AnyObject>> = msg_send_id![&self.webview, URL];
            let url = url?;
            let abs: Option<Retained<AnyObject>> = msg_send_id![&url, absoluteString];
            let abs = abs?;
            // Convert NSString to Rust String
            let ns_str: &AnyObject = &abs;
            let utf8: *const std::ffi::c_char = msg_send![ns_str, UTF8String];
            if utf8.is_null() {
                None
            } else {
                Some(std::ffi::CStr::from_ptr(utf8).to_string_lossy().into_owned())
            }
        }
    }

    /// Get the current page title, if any.
    pub fn current_title(&self) -> Option<String> {
        unsafe {
            let title: Option<Retained<AnyObject>> = msg_send_id![&self.webview, title];
            let title = title?;
            let utf8: *const std::ffi::c_char = msg_send![&title, UTF8String];
            if utf8.is_null() {
                None
            } else {
                Some(std::ffi::CStr::from_ptr(utf8).to_string_lossy().into_owned())
            }
        }
    }

    /// Load HTML content directly via loadHTMLString:baseURL:.
    /// Used for render-mode panes (generative UI) — BR-25.
    pub fn load_html_string(&self, html: &str) {
        let ns_html = NSString::from_str(html);
        if MainThreadMarker::new().is_some() {
            unsafe {
                let _: Option<Retained<AnyObject>> = msg_send_id![
                    &self.webview,
                    loadHTMLString: &*ns_html,
                    baseURL: std::ptr::null::<AnyObject>()
                ];
            }
            return;
        }
        let mut ctx = LoadHtmlCtx {
            webview: &*self.webview as *const AnyObject,
            html_ptr: html.as_ptr(),
            html_len: html.len(),
        };
        unsafe {
            dispatch_sync_f(
                &_dispatch_main_q as *const std::ffi::c_void,
                &mut ctx as *mut LoadHtmlCtx as *mut std::ffi::c_void,
                load_html_on_main_thread,
            );
        }
    }

    /// Evaluate arbitrary JavaScript in the webview.
    /// Used for morphdom updates in render-mode panes.
    pub fn evaluate_javascript(&self, js: &str) {
        let ns_js = NSString::from_str(js);
        if MainThreadMarker::new().is_some() {
            unsafe {
                let _: () = msg_send![&self.webview, evaluateJavaScript: &*ns_js completionHandler: std::ptr::null::<AnyObject>()];
            }
            return;
        }
        let mut ctx = EvalJsCtx {
            webview: &*self.webview as *const AnyObject,
            js_ptr: js.as_ptr(),
            js_len: js.len(),
        };
        unsafe {
            dispatch_sync_f(
                &_dispatch_main_q as *const std::ffi::c_void,
                &mut ctx as *mut EvalJsCtx as *mut std::ffi::c_void,
                eval_js_on_main_thread,
            );
        }
    }

    /// Execute a find-in-page search using WKWebView's performTextSearch API.
    /// Falls back to JavaScript window.find() for broad compatibility.
    pub fn find_string(&self, query: &str, forward: bool) {
        let escaped = query.replace('\\', "\\\\").replace('\'', "\\'");
        let js = if forward {
            format!("window.find('{}', false, false, true)", escaped)
        } else {
            format!("window.find('{}', false, true, true)", escaped)
        };
        let ns_js = NSString::from_str(&js);
        unsafe {
            let _: () = msg_send![&self.webview, evaluateJavaScript: &*ns_js completionHandler: std::ptr::null::<AnyObject>()];
        }
    }

    /// Clear find-in-page highlight by deselecting.
    pub fn clear_find(&self) {
        let ns_js = NSString::from_str("window.getSelection().removeAllRanges()");
        unsafe {
            let _: () = msg_send![&self.webview, evaluateJavaScript: &*ns_js completionHandler: std::ptr::null::<AnyObject>()];
        }
    }

    /// Returns true if the webview is currently loading.
    pub fn is_loading(&self) -> bool {
        unsafe {
            let val: Bool = msg_send![&self.webview, isLoading];
            val.as_bool()
        }
    }

    /// Remove the webview from its superview.
    ///
    /// AppKit's `removeFromSuperview` **must** run on the main thread.
    pub fn remove_from_parent(&self) {
        if MainThreadMarker::new().is_some() {
            unsafe {
                let _: () = msg_send![&self.webview, removeFromSuperview];
            }
            return;
        }
        let mut ctx = RemoveFromParentCtx {
            webview: &*self.webview as *const AnyObject,
        };
        unsafe {
            dispatch_sync_f(
                &_dispatch_main_q as *const std::ffi::c_void,
                &mut ctx as *mut RemoveFromParentCtx as *mut std::ffi::c_void,
                remove_from_parent_on_main_thread,
            );
        }
    }

    /// Make this webview the first responder of the given NSWindow,
    /// so keyboard events route to the webview.
    ///
    /// AppKit's `makeFirstResponder:` **must** run on the main thread.
    ///
    /// # Safety
    /// `window_ptr` must point to a valid NSWindow.
    pub unsafe fn make_first_responder(&self, window_ptr: *mut std::ffi::c_void) {
        if MainThreadMarker::new().is_some() {
            let window: &AnyObject = &*(window_ptr as *const AnyObject);
            let _: Bool = msg_send![window, makeFirstResponder: &*self.webview];
            return;
        }
        let mut ctx = MakeFirstResponderCtx {
            webview: &*self.webview as *const AnyObject,
            window: window_ptr as *const AnyObject,
        };
        dispatch_sync_f(
            &_dispatch_main_q as *const std::ffi::c_void,
            &mut ctx as *mut MakeFirstResponderCtx as *mut std::ffi::c_void,
            make_first_responder_on_main_thread,
        );
    }

    /// Resign first responder from the webview and give it back to `view_ptr`.
    ///
    /// AppKit's `makeFirstResponder:` **must** run on the main thread.
    ///
    /// # Safety
    /// Both `window_ptr` and `view_ptr` must be valid pointers.
    pub unsafe fn resign_first_responder(
        &self,
        window_ptr: *mut std::ffi::c_void,
        view_ptr: *mut std::ffi::c_void,
    ) {
        if MainThreadMarker::new().is_some() {
            let window: &AnyObject = &*(window_ptr as *const AnyObject);
            let view: &AnyObject = &*(view_ptr as *const AnyObject);
            let _: Bool = msg_send![window, makeFirstResponder: view];
            return;
        }
        let mut ctx = ResignFirstResponderCtx {
            window: window_ptr as *const AnyObject,
            view: view_ptr as *const AnyObject,
        };
        dispatch_sync_f(
            &_dispatch_main_q as *const std::ffi::c_void,
            &mut ctx as *mut ResignFirstResponderCtx as *mut std::ffi::c_void,
            resign_first_responder_on_main_thread,
        );
    }
}
