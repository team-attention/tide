//! WKWebView wrapper for embedded browser functionality.
//!
//! Uses raw `objc2` message sends to interact with WebKit classes,
//! avoiding a direct WebKit crate dependency.

use crate::tide_core::PaneId;

use std::collections::HashMap;
use std::sync::Mutex;

use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, Bool};
use objc2::{declare_class, msg_send, msg_send_id, mutability, ClassType, DeclaredClass};
use objc2_foundation::{CGFloat, MainThreadMarker, NSObject, NSPoint, NSRect, NSSize, NSString};

/// Global queue for URLs that should open in a new browser tab.
/// Populated by the WKUIDelegate when Cmd+click triggers a new window request.
static NEW_TAB_URLS: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// Wrapper around a raw block pointer for the permission decision handler.
/// SAFETY: These pointers are created by WebKit on the main thread and must be
/// consumed (called + released) on the main thread via `resolve_permission_handler`.
struct BlockPtr(*mut std::ffi::c_void);
unsafe impl Send for BlockPtr {}

/// Pending WKUIDelegate permission completion handler blocks, keyed by pane_id raw value.
/// BR-10: Stores the decisionHandler block pointer until the domain grants/denies the request.
static PENDING_PERMISSION_HANDLERS: std::sync::LazyLock<Mutex<HashMap<u64, BlockPtr>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

/// Pending WKNavigationDelegate certificate challenge completion handler blocks, keyed by pane_id raw value.
/// BR-13: Stores the completionHandler block pointer until the domain proceeds/cancels.
static PENDING_CERT_HANDLERS: std::sync::LazyLock<Mutex<HashMap<u64, BlockPtr>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

/// Wrapper around a raw pointer for retained download delegates.
/// SAFETY: These are Retained<TideDownloadDelegate> converted to raw pointers.
/// Created and consumed on the main thread.
struct DelegatePtr(*mut std::ffi::c_void);
unsafe impl Send for DelegatePtr {}

/// Retained TideDownloadDelegate instances, keyed by pane_id raw value.
/// Prevents deallocation while a WKDownload is active.
static ACTIVE_DOWNLOAD_DELEGATES: std::sync::LazyLock<Mutex<HashMap<u64, DelegatePtr>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

/// Global queue for messages received from render pane JS bridge.
/// Populated by WKScriptMessageHandler when JS calls `window.tide.send(json)`.
static BRIDGE_MESSAGES: Mutex<Vec<String>> = Mutex::new(Vec::new());

fn queue_bridge_message(message: String) {
    let mut queue = BRIDGE_MESSAGES.lock().unwrap_or_else(|e| e.into_inner());
    queue.push(message);
}

/// Global wake callback for triggering redraws from delegate callbacks.
/// Set once at startup via `set_webview_waker`.
static WEBVIEW_WAKER: Mutex<Option<std::sync::Arc<dyn Fn() + Send + Sync>>> = Mutex::new(None);

/// Install the wake callback so navigation delegate can trigger redraws.
pub fn set_webview_waker(waker: std::sync::Arc<dyn Fn() + Send + Sync>) {
    let mut w = WEBVIEW_WAKER.lock().unwrap_or_else(|e| e.into_inner());
    *w = Some(waker);
}

pub fn wake_event_loop() {
    let w = WEBVIEW_WAKER.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(ref waker) = *w {
        waker();
    }
}

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
// WKUIDelegate — handles popups, JavaScript dialogs, permissions, etc.
// ---------------------------------------------------------------------------

struct TideUIDelegateIvars {
    pane_id: PaneId,
}

declare_class!(
    struct TideUIDelegate;

    unsafe impl ClassType for TideUIDelegate {
        type Super = NSObject;
        type Mutability = mutability::MainThreadOnly;
        const NAME: &'static str = "TideUIDelegate";
    }

    impl DeclaredClass for TideUIDelegate {
        type Ivars = TideUIDelegateIvars;
    }

    unsafe impl TideUIDelegate {
        #[method_id(initWithPaneId:)]
        fn init_with_pane_id(
            this: objc2::rc::Allocated<Self>,
            pane_id: usize,
        ) -> Option<Retained<Self>> {
            let this = this.set_ivars(TideUIDelegateIvars {
                pane_id: pane_id as PaneId,
            });
            unsafe { msg_send_id![super(this), init] }
        }

        /// Handle window.open() / target=_blank — open in a new Browser Pane.
        /// Handle popups: window.open() opens a new Browser Pane (UC-7 BR-19),
        /// but target=_blank link clicks load in the same webview to avoid
        /// breaking normal navigation.
        /// WKNavigationType: linkActivated=0, other=-1
        #[method_id(webView:createWebViewWithConfiguration:forNavigationAction:windowFeatures:)]
        fn create_webview(
            &self,
            webview: &AnyObject,
            _config: &AnyObject,
            navigation_action: &AnyObject,
            _window_features: &AnyObject,
        ) -> Option<Retained<AnyObject>> {
            unsafe {
                let nav_type: isize = msg_send![navigation_action, navigationType];
                let request: Retained<AnyObject> = msg_send_id![navigation_action, request];
                let url_obj: Option<Retained<AnyObject>> = msg_send_id![&request, URL];

                if let Some(url) = url_obj {
                    let abs: Option<Retained<AnyObject>> = msg_send_id![&url, absoluteString];
                    if let Some(s) = abs {
                        let utf8: *const std::ffi::c_char = msg_send![&s, UTF8String];
                        if !utf8.is_null() {
                            let url_str = std::ffi::CStr::from_ptr(utf8).to_string_lossy().into_owned();
                            // linkActivated (0) = user clicked a link with target=_blank
                            // → load in same webview (normal navigation)
                            if nav_type == 0 {
                                let ns_url_cls = AnyClass::get("NSURL").expect("NSURL");
                                let ns_url_str = NSString::from_str(&url_str);
                                let ns_url: Retained<AnyObject> =
                                    msg_send_id![ns_url_cls, URLWithString: &*ns_url_str];
                                let req_cls = AnyClass::get("NSURLRequest").expect("NSURLRequest");
                                let req: Retained<AnyObject> =
                                    msg_send_id![req_cls, requestWithURL: &*ns_url];
                                let _: () = msg_send![webview, loadRequest: &*req];
                            } else {
                                // window.open() or other JS-initiated → new tab (UC-7 BR-19)
                                if let Ok(mut queue) = NEW_TAB_URLS.lock() {
                                    queue.push(url_str);
                                }
                            }
                        }
                    }
                }
            }
            wake_event_loop();
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

        /// Handle media capture permission requests (camera, microphone).
        /// BR-10: Permission requests surface through WKUIDelegate instead of silently failing.
        /// WKMediaCaptureType: camera=0, microphone=1, cameraAndMicrophone=2
        /// We store the decisionHandler block and queue a bridge message for the domain to decide.
        #[method(webView:requestMediaCapturePermissionForOrigin:initiatedByFrame:type:decisionHandler:)]
        fn request_media_capture_permission(
            &self,
            _webview: &AnyObject,
            origin: &AnyObject,
            _frame: &AnyObject,
            media_type: isize,
            decision_handler: &block2::Block<dyn Fn(isize)>,
        ) {
            let pane_id = self.ivars().pane_id;

            // Map WKMediaCaptureType to string
            let permission_type = match media_type {
                0 => "camera",
                1 => "microphone",
                2 => "camera_and_microphone",
                _ => "camera",
            };

            // Extract the origin host string
            let origin_str = unsafe {
                let host: Option<Retained<AnyObject>> = msg_send_id![origin, host];
                if let Some(host) = host {
                    let utf8: *const std::ffi::c_char = msg_send![&host, UTF8String];
                    if !utf8.is_null() {
                        std::ffi::CStr::from_ptr(utf8).to_string_lossy().into_owned()
                    } else {
                        String::from("unknown")
                    }
                } else {
                    String::from("unknown")
                }
            };

            // Retain the block so it survives beyond this callback.
            // Block_copy increments the block's reference count.
            let block_ptr = decision_handler as *const block2::Block<dyn Fn(isize)>
                as *const std::ffi::c_void
                as *mut std::ffi::c_void;
            let copied: *mut std::ffi::c_void = unsafe { _Block_copy(block_ptr) };

            // Store the copied block pointer keyed by pane_id
            {
                let mut handlers = PENDING_PERMISSION_HANDLERS
                    .lock()
                    .unwrap_or_else(|e| e.into_inner());
                handlers.insert(pane_id, BlockPtr(copied));
            }

            // Queue a bridge message for the event loop to dispatch to the domain
            queue_bridge_message(
                serde_json::json!({
                    "kind": "browser-permission-request",
                    "pane_id": pane_id,
                    "permission_type": permission_type,
                    "origin": origin_str,
                })
                .to_string(),
            );

            wake_event_loop();
        }
    }
);

// ---------------------------------------------------------------------------
// WKNavigationDelegate — handles download responses
// ---------------------------------------------------------------------------

struct TideNavigationDelegateIvars {
    pane_id: PaneId,
}

declare_class!(
    struct TideNavigationDelegate;

    unsafe impl ClassType for TideNavigationDelegate {
        type Super = NSObject;
        type Mutability = mutability::MainThreadOnly;
        const NAME: &'static str = "TideNavigationDelegate";
    }

    impl DeclaredClass for TideNavigationDelegate {
        type Ivars = TideNavigationDelegateIvars;
    }

    unsafe impl TideNavigationDelegate {
        #[method_id(initWithPaneId:)]
        fn init_with_pane_id(
            this: objc2::rc::Allocated<Self>,
            pane_id: usize,
        ) -> Option<Retained<Self>> {
            let this = this.set_ivars(TideNavigationDelegateIvars {
                pane_id: pane_id as PaneId,
            });
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

        /// Handle navigation response — detect downloads.
        /// WKNavigationResponsePolicy: .allow = 1, .cancel = 0, .download = 2
        /// UC-1 BR-1: Non-renderable responses become in-app downloads when available.
        /// Falls back to NSWorkspace external handoff on pre-macOS 11.3.
        #[method(webView:decidePolicyForNavigationResponse:decisionHandler:)]
        fn decide_policy_for_response(
            &self,
            webview: &AnyObject,
            navigation_response: &AnyObject,
            decision_handler: &block2::Block<dyn Fn(i64)>,
        ) {
            unsafe {
                let can_show: Bool = msg_send![navigation_response, canShowMIMEType];
                if can_show.as_bool() {
                    // WebView can render this content — allow it
                    decision_handler.call((1,)); // .allow
                } else {
                    // Check if WKWebView supports the .download policy (macOS 11.3+)
                    // by checking if the webview responds to navigationResponse:didBecomeDownload:
                    let sel = objc2::sel!(navigationResponse:didBecomeDownload:);
                    let delegate_obj: *const AnyObject = msg_send![webview, navigationDelegate];
                    let supports_download: Bool = if !delegate_obj.is_null() {
                        msg_send![delegate_obj, respondsToSelector: sel]
                    } else {
                        Bool::NO
                    };

                    if supports_download.as_bool() {
                        // macOS 11.3+: return .download policy — WebKit will call
                        // navigationResponse:didBecomeDownload: on the navigation delegate
                        decision_handler.call((2,)); // .download
                    } else {
                        // Pre-macOS 11.3 fallback: open in system browser
                        let response: Retained<AnyObject> = msg_send_id![navigation_response, response];
                        let url: Option<Retained<AnyObject>> = msg_send_id![&response, URL];
                        if let Some(url) = url {
                            let abs: Option<Retained<AnyObject>> = msg_send_id![&url, absoluteString];
                            if let Some(s) = abs {
                                let utf8: *const std::ffi::c_char = msg_send![&s, UTF8String];
                                if !utf8.is_null() {
                                    let url_str =
                                        std::ffi::CStr::from_ptr(utf8).to_string_lossy().into_owned();
                                    queue_bridge_message(serde_json::json!({
                                        "kind": "browser-external-handoff",
                                        "pane_id": self.ivars().pane_id,
                                        "reason": "download",
                                        "url": url_str,
                                    })
                                    .to_string());
                                }
                            }
                            let workspace_cls = AnyClass::get("NSWorkspace").expect("NSWorkspace class");
                            let shared: Retained<AnyObject> = msg_send_id![workspace_cls, sharedWorkspace];
                            let _: Bool = msg_send![&shared, openURL: &*url];
                        }
                        decision_handler.call((0,)); // .cancel
                    }
                }
            }
        }

        /// Called when a navigation response becomes a download (macOS 11.3+).
        /// UC-1: Sets the download's delegate to TideDownloadDelegate for in-app handling.
        #[method(webView:navigationResponse:didBecomeDownload:)]
        fn navigation_response_did_become_download(
            &self,
            _webview: &AnyObject,
            _navigation_response: &AnyObject,
            download: &AnyObject,
        ) {
            let pane_id = self.ivars().pane_id;
            unsafe {
                let mtm = MainThreadMarker::new().expect("delegate callbacks run on main thread");
                let delegate: Retained<TideDownloadDelegate> =
                    msg_send_id![mtm.alloc::<TideDownloadDelegate>(), initWithPaneId: pane_id as usize];
                let _: () = msg_send![download, setDelegate: &*delegate];

                // Retain delegate to prevent deallocation while download is active.
                // Convert to raw pointer — we'll release it when the download finishes/fails.
                let raw = Retained::into_raw(delegate) as *mut std::ffi::c_void;
                let mut delegates = ACTIVE_DOWNLOAD_DELEGATES
                    .lock()
                    .unwrap_or_else(|e| e.into_inner());
                delegates.insert(pane_id, DelegatePtr(raw));
            }
        }

        /// Fired when the webview commits a navigation (URL has changed).
        /// Push the new URL immediately via bridge message so the URL bar
        /// updates without waiting for the next poll cycle.
        #[method(webView:didCommitNavigation:)]
        fn did_commit_navigation(
            &self,
            webview: &AnyObject,
            _navigation: *const AnyObject,
        ) {
            let pane_id = self.ivars().pane_id;
            // Read URL directly from the webview that just committed.
            let url: Option<String> = unsafe {
                let url_obj: Option<Retained<AnyObject>> = msg_send_id![webview, URL];
                url_obj.and_then(|u| {
                    let abs: Option<Retained<AnyObject>> = msg_send_id![&u, absoluteString];
                    abs.and_then(|a| {
                        let utf8: *const std::ffi::c_char = msg_send![&*a, UTF8String];
                        if utf8.is_null() {
                            None
                        } else {
                            Some(std::ffi::CStr::from_ptr(utf8).to_string_lossy().into_owned())
                        }
                    })
                })
            };
            if let Some(url) = url {
                queue_bridge_message(
                    serde_json::json!({
                        "kind": "browser-url-committed",
                        "pane_id": pane_id.to_string(),
                        "url": url,
                    })
                    .to_string(),
                );
            }
            wake_event_loop();
        }

        /// Fired when the webview finishes loading a page.
        #[method(webView:didFinishNavigation:)]
        fn did_finish_navigation(
            &self,
            _webview: &AnyObject,
            _navigation: *const AnyObject,
        ) {
            wake_event_loop();
        }

        /// Handle authentication challenges — intercept server trust errors for certificate prompts.
        /// BR-13: Certificate errors surface explicit user prompt.
        /// completionHandler signature: (NSURLSessionAuthChallengeDisposition, NSURLCredential?) -> Void
        /// Disposition values: useCredential=0, performDefaultHandling=1, cancelAuthenticationChallenge=2
        #[method(webView:didReceiveAuthenticationChallenge:completionHandler:)]
        fn did_receive_authentication_challenge(
            &self,
            _webview: &AnyObject,
            challenge: &AnyObject,
            completion_handler: &block2::Block<dyn Fn(isize, *mut AnyObject)>,
        ) {
            let pane_id = self.ivars().pane_id;

            unsafe {
                let protection_space: Retained<AnyObject> = msg_send_id![challenge, protectionSpace];
                let auth_method: Retained<NSString> = msg_send_id![&protection_space, authenticationMethod];
                let method_str = auth_method.to_string();

                let trust_is_valid = if method_str == "NSURLAuthenticationMethodServerTrust" {
                    protection_space_server_trust_is_valid(&protection_space)
                } else {
                    true
                };

                if should_prompt_for_certificate_error(&method_str, trust_is_valid) {
                    // Extract host from protectionSpace
                    let host: Retained<NSString> = msg_send_id![&protection_space, host];
                    let host_str = host.to_string();

                    // Queue bridge message for domain to handle
                    queue_bridge_message(
                        serde_json::json!({
                            "kind": "browser-certificate-error",
                            "pane_id": pane_id,
                            "host": host_str,
                            "reason": "Server certificate is not trusted",
                        })
                        .to_string(),
                    );

                    // Retain the block so it survives beyond this callback.
                    let block_ptr = completion_handler
                        as *const block2::Block<dyn Fn(isize, *mut AnyObject)>
                        as *const std::ffi::c_void
                        as *mut std::ffi::c_void;
                    let copied: *mut std::ffi::c_void = _Block_copy(block_ptr);

                    // Store the copied block pointer keyed by pane_id
                    {
                        let mut handlers = PENDING_CERT_HANDLERS
                            .lock()
                            .unwrap_or_else(|e| e.into_inner());
                        handlers.insert(pane_id, BlockPtr(copied));
                    }

                    wake_event_loop();
                } else {
                    // Valid server-trust challenges and non-certificate
                    // challenges should continue without surfacing a prompt.
                    completion_handler.call((1, std::ptr::null_mut()));
                }
            }
        }
    }
);

// ---------------------------------------------------------------------------
// WKDownloadDelegate — handles in-app download lifecycle (macOS 11.3+)
// UC-1: Downloads happen in-app instead of handing off to NSWorkspace.
// ---------------------------------------------------------------------------

struct TideDownloadDelegateIvars {
    pane_id: PaneId,
}

declare_class!(
    struct TideDownloadDelegate;

    unsafe impl ClassType for TideDownloadDelegate {
        type Super = NSObject;
        type Mutability = mutability::MainThreadOnly;
        const NAME: &'static str = "TideDownloadDelegate";
    }

    impl DeclaredClass for TideDownloadDelegate {
        type Ivars = TideDownloadDelegateIvars;
    }

    unsafe impl TideDownloadDelegate {
        #[method_id(initWithPaneId:)]
        fn init_with_pane_id(
            this: objc2::rc::Allocated<Self>,
            pane_id: usize,
        ) -> Option<Retained<Self>> {
            let this = this.set_ivars(TideDownloadDelegateIvars {
                pane_id: pane_id as PaneId,
            });
            unsafe { msg_send_id![super(this), init] }
        }

        /// Choose download destination and notify the domain.
        /// WKDownloadDelegate: download:decideDestinationUsingResponse:suggestedFilename:completionHandler:
        /// completionHandler signature: (NSURL?) -> Void
        #[method(download:decideDestinationUsingResponse:suggestedFilename:completionHandler:)]
        fn decide_destination(
            &self,
            download: &AnyObject,
            _response: &AnyObject,
            suggested_filename: &NSString,
            completion_handler: &block2::Block<dyn Fn(*mut AnyObject)>,
        ) {
            let pane_id = self.ivars().pane_id;
            let filename = suggested_filename.to_string();

            // Extract source URL from the download
            let url_str = unsafe {
                let original_request: Option<Retained<AnyObject>> = msg_send_id![download, originalRequest];
                if let Some(req) = original_request {
                    let url_obj: Option<Retained<AnyObject>> = msg_send_id![&req, URL];
                    if let Some(url) = url_obj {
                        let abs: Option<Retained<AnyObject>> = msg_send_id![&url, absoluteString];
                        if let Some(s) = abs {
                            let utf8: *const std::ffi::c_char = msg_send![&s, UTF8String];
                            if !utf8.is_null() {
                                std::ffi::CStr::from_ptr(utf8).to_string_lossy().into_owned()
                            } else {
                                String::new()
                            }
                        } else {
                            String::new()
                        }
                    } else {
                        String::new()
                    }
                } else {
                    String::new()
                }
            };

            // Build destination path: ~/Downloads/{suggestedFilename}
            let destination = unsafe {
                let fm_cls = AnyClass::get("NSFileManager").expect("NSFileManager class");
                let fm: Retained<AnyObject> = msg_send_id![fm_cls, defaultManager];
                // NSSearchPathDirectory.NSDownloadsDirectory = 15
                // NSSearchPathDomainMask.NSUserDomainMask = 1
                let urls: Retained<AnyObject> = msg_send_id![
                    &fm,
                    URLsForDirectory: 15_usize,
                    inDomains: 1_usize
                ];
                let count: usize = msg_send![&urls, count];
                if count > 0 {
                    let downloads_url: Retained<AnyObject> = msg_send_id![&urls, objectAtIndex: 0_usize];
                    let ns_filename = NSString::from_str(&filename);
                    let dest_url: Retained<AnyObject> = msg_send_id![
                        &downloads_url,
                        URLByAppendingPathComponent: &*ns_filename
                    ];
                    let path: Option<Retained<AnyObject>> = msg_send_id![&dest_url, path];
                    if let Some(p) = path {
                        let utf8: *const std::ffi::c_char = msg_send![&p, UTF8String];
                        if !utf8.is_null() {
                            std::ffi::CStr::from_ptr(utf8).to_string_lossy().into_owned()
                        } else {
                            format!("{}/{}", std::env::var("HOME").unwrap_or_default(), filename)
                        }
                    } else {
                        format!("{}/{}", std::env::var("HOME").unwrap_or_default(), filename)
                    }
                } else {
                    format!("{}/Downloads/{}", std::env::var("HOME").unwrap_or_default(), filename)
                }
            };

            // Queue bridge message for domain
            queue_bridge_message(
                serde_json::json!({
                    "kind": "browser-download-started",
                    "pane_id": pane_id,
                    "url": url_str,
                    "destination": destination,
                })
                .to_string(),
            );

            // Call completionHandler with destination NSURL
            unsafe {
                let url_cls = AnyClass::get("NSURL").expect("NSURL class");
                let ns_path = NSString::from_str(&destination);
                let dest_nsurl: Retained<AnyObject> = msg_send_id![
                    url_cls,
                    fileURLWithPath: &*ns_path
                ];
                completion_handler.call((&*dest_nsurl as *const AnyObject as *mut AnyObject,));
            }

            wake_event_loop();
        }

        /// Download failed with error.
        /// WKDownloadDelegate: download:didFailWithError:resumeData:
        #[method(download:didFailWithError:resumeData:)]
        fn download_did_fail(
            &self,
            _download: &AnyObject,
            error: &AnyObject,
            _resume_data: *const AnyObject,
        ) {
            let pane_id = self.ivars().pane_id;

            let reason = unsafe {
                let desc: Retained<NSString> = msg_send_id![error, localizedDescription];
                desc.to_string()
            };

            queue_bridge_message(
                serde_json::json!({
                    "kind": "browser-download-failed",
                    "pane_id": pane_id,
                    "reason": reason,
                })
                .to_string(),
            );

            // Clean up retained delegate — drop releases the Retained reference
            {
                let mut delegates = ACTIVE_DOWNLOAD_DELEGATES
                    .lock()
                    .unwrap_or_else(|e| e.into_inner());
                if let Some(DelegatePtr(ptr)) = delegates.remove(&pane_id) {
                    // SAFETY: ptr was created via Retained::into_raw in navigation_response_did_become_download
                    unsafe { drop(Retained::from_raw(ptr as *mut TideDownloadDelegate)); }
                }
            }

            wake_event_loop();
        }

        /// Download completed successfully.
        /// WKDownloadDelegate: downloadDidFinish:
        #[method(downloadDidFinish:)]
        fn download_did_finish(
            &self,
            _download: &AnyObject,
        ) {
            let pane_id = self.ivars().pane_id;

            queue_bridge_message(
                serde_json::json!({
                    "kind": "browser-download-completed",
                    "pane_id": pane_id,
                })
                .to_string(),
            );

            // Clean up retained delegate — drop releases the Retained reference
            {
                let mut delegates = ACTIVE_DOWNLOAD_DELEGATES
                    .lock()
                    .unwrap_or_else(|e| e.into_inner());
                if let Some(DelegatePtr(ptr)) = delegates.remove(&pane_id) {
                    // SAFETY: ptr was created via Retained::into_raw in navigation_response_did_become_download
                    unsafe { drop(Retained::from_raw(ptr as *mut TideDownloadDelegate)); }
                }
            }

            wake_event_loop();
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
    fn dispatch_async_f(
        queue: *const std::ffi::c_void,
        context: *mut std::ffi::c_void,
        work: unsafe extern "C" fn(*mut std::ffi::c_void),
    );
    /// Block runtime: copy a block to the heap (retains).
    fn _Block_copy(block: *const std::ffi::c_void) -> *mut std::ffi::c_void;
    /// Block runtime: release a heap-copied block.
    fn _Block_release(block: *const std::ffi::c_void);
}

#[link(name = "Security", kind = "framework")]
extern "C" {
    fn SecTrustEvaluateWithError(
        trust: *const std::ffi::c_void,
        error: *mut *const std::ffi::c_void,
    ) -> u8;
}

fn should_prompt_for_certificate_error(auth_method: &str, trust_is_valid: bool) -> bool {
    auth_method == "NSURLAuthenticationMethodServerTrust" && !trust_is_valid
}

unsafe fn protection_space_server_trust_is_valid(protection_space: &AnyObject) -> bool {
    let trust: *const std::ffi::c_void = msg_send![protection_space, serverTrust];
    if trust.is_null() {
        return false;
    }
    SecTrustEvaluateWithError(trust, std::ptr::null_mut()) != 0
}

/// Resolve a pending permission handler by calling the stored decision handler block.
/// BR-10: Called from the sync path when the domain sets permission_decision.
///
/// `granted`: true calls the block with WKPermissionDecision.grant (1),
///            false calls with WKPermissionDecision.deny (0).
pub fn resolve_permission_handler(pane_id: u64, granted: bool) {
    let block_ptr = {
        let mut handlers = PENDING_PERMISSION_HANDLERS
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        handlers.remove(&pane_id)
    };

    if let Some(BlockPtr(ptr)) = block_ptr {
        let decision: isize = if granted { 1 } else { 0 };
        unsafe {
            let block = &*(ptr as *const block2::Block<dyn Fn(isize)>);
            block.call((decision,));
            _Block_release(ptr as *const std::ffi::c_void);
        }
    }
}

/// Resolve a pending certificate challenge handler by calling the stored completion handler block.
/// BR-13/BR-14: Called from the sync path when the domain sets certificate_decision.
///
/// `proceed`: true creates NSURLCredential from serverTrust and calls with useCredential (0),
///            false calls with cancelAuthenticationChallenge (2).
pub fn resolve_cert_handler(pane_id: u64, proceed: bool) {
    let block_ptr = {
        let mut handlers = PENDING_CERT_HANDLERS
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        handlers.remove(&pane_id)
    };

    if let Some(BlockPtr(ptr)) = block_ptr {
        unsafe {
            let block = &*(ptr as *const block2::Block<dyn Fn(isize, *mut AnyObject)>);
            if proceed {
                // useCredential = 0, with credential from serverTrust
                // We pass nil credential — WebKit will use the serverTrust from the
                // original challenge's protectionSpace automatically when disposition is 0.
                block.call((0, std::ptr::null_mut()));
            } else {
                // cancelAuthenticationChallenge = 2, nil credential
                block.call((2, std::ptr::null_mut()));
            }
            _Block_release(ptr as *const std::ffi::c_void);
        }
    }
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
                    queue_bridge_message(msg_str);
                }
            }
        }
    }
);

/// Handle to a WKWebView instance, added as a subview of the parent NSView.
pub struct WebViewHandle {
    webview: Retained<AnyObject>,
    pane_id: u64,
    /// Retained so the weak UIDelegate reference stays valid.
    _ui_delegate: Retained<TideUIDelegate>,
    /// Retained so the weak NavigationDelegate reference stays valid.
    _nav_delegate: Retained<TideNavigationDelegate>,
    /// Retained so the WKScriptMessageHandler stays alive.
    _script_handler: Retained<TideScriptMessageHandler>,
}

impl Drop for WebViewHandle {
    fn drop(&mut self) {
        cleanup_pending_handlers(self.pane_id);
    }
}

struct DestroyWebViewCtx {
    handle: *mut WebViewHandle,
}

unsafe extern "C" fn destroy_webview_on_main_thread(ctx_ptr: *mut std::ffi::c_void) {
    let ctx = Box::from_raw(ctx_ptr as *mut DestroyWebViewCtx);
    let handle = Box::from_raw(ctx.handle);
    handle.remove_from_parent();
    // `handle` drops here on the main thread, releasing MainThreadOnly ivars safely.
}

/// Release any pending completion handler blocks and download delegates for a pane.
/// Called on WebViewHandle drop to prevent leaks when a Browser Pane closes
/// while permission/certificate prompts or downloads are in-flight.
fn cleanup_pending_handlers(pane_id: u64) {
    // WebKit aborts if these completion handlers are released without being
    // called, so Browser Pane teardown must resolve them explicitly first.
    resolve_permission_handler(pane_id, false);
    resolve_cert_handler(pane_id, false);
    // Release active download delegate
    ACTIVE_DOWNLOAD_DELEGATES
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(&pane_id);
}

/// Context passed through `dispatch_sync_f` to create a WKWebView on the main thread.
struct WebViewCreateCtx {
    parent_view: *mut std::ffi::c_void,
    pane_id: PaneId,
    result: Option<WebViewHandle>,
}

/// Trampoline called on the main thread by `dispatch_sync_f`.
unsafe extern "C" fn create_webview_on_main_thread(ctx: *mut std::ffi::c_void) {
    let ctx = &mut *(ctx as *mut WebViewCreateCtx);
    ctx.result = WebViewHandle::new_on_main_thread(ctx.parent_view, ctx.pane_id);
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
    let nsurl: Option<Retained<AnyObject>> = msg_send_id![url_cls, URLWithString: &*ns_url_str];
    let Some(nsurl) = nsurl else { return };

    let req_cls = AnyClass::get("NSURLRequest").expect("NSURLRequest class");
    let request: Retained<AnyObject> = msg_send_id![req_cls, requestWithURL: &*nsurl];

    let _: Option<Retained<AnyObject>> = msg_send_id![webview, loadRequest: &*request];
}

#[derive(Clone, Copy)]
enum WebViewVoidAction {
    GoBack,
    GoForward,
    Reload,
    ClearWebsiteData,
}

#[derive(Clone, Copy)]
enum WebViewBoolQuery {
    CanGoBack,
    CanGoForward,
    IsLoading,
}

#[derive(Clone, Copy)]
enum WebViewF64Query {
    EstimatedProgress,
}

#[derive(Clone, Copy)]
enum WebViewStringQuery {
    CurrentUrl,
    CurrentTitle,
}

struct WebViewVoidActionCtx {
    webview: *const AnyObject,
    action: WebViewVoidAction,
}

struct WebViewBoolQueryCtx {
    webview: *const AnyObject,
    query: WebViewBoolQuery,
    result: bool,
}

struct WebViewF64QueryCtx {
    webview: *const AnyObject,
    query: WebViewF64Query,
    result: f64,
}

struct WebViewStringQueryCtx {
    webview: *const AnyObject,
    query: WebViewStringQuery,
    result: Option<String>,
}

unsafe fn nsobject_utf8_string(obj: &AnyObject) -> Option<String> {
    let utf8: *const std::ffi::c_char = msg_send![obj, UTF8String];
    if utf8.is_null() {
        None
    } else {
        Some(
            std::ffi::CStr::from_ptr(utf8)
                .to_string_lossy()
                .into_owned(),
        )
    }
}

unsafe fn clear_website_data_inner(webview: &AnyObject) {
    let config: Retained<AnyObject> = msg_send_id![webview, configuration];
    let data_store: Retained<AnyObject> = msg_send_id![&config, websiteDataStore];

    let ns_set_cls = AnyClass::get("NSSet").expect("NSSet class");
    let types: [Retained<NSString>; 4] = [
        NSString::from_str("WKWebsiteDataTypeCookies"),
        NSString::from_str("WKWebsiteDataTypeLocalStorage"),
        NSString::from_str("WKWebsiteDataTypeSessionStorage"),
        NSString::from_str("WKWebsiteDataTypeIndexedDBDatabases"),
    ];
    let ns_array_cls = AnyClass::get("NSArray").expect("NSArray class");
    let ptrs: [*const AnyObject; 4] = [
        &*types[0] as *const _ as *const AnyObject,
        &*types[1] as *const _ as *const AnyObject,
        &*types[2] as *const _ as *const AnyObject,
        &*types[3] as *const _ as *const AnyObject,
    ];
    let ns_array: Retained<AnyObject> = msg_send_id![
        ns_array_cls,
        arrayWithObjects: ptrs.as_ptr(),
        count: 4_usize
    ];
    let data_types: Retained<AnyObject> = msg_send_id![ns_set_cls, setWithArray: &*ns_array];

    let ns_date_cls = AnyClass::get("NSDate").expect("NSDate class");
    let distant_past: Retained<AnyObject> = msg_send_id![ns_date_cls, distantPast];

    let completion = block2::StackBlock::new(|| {});
    let completion_ptr = &*completion as *const block2::Block<dyn Fn()>;

    let _: () = msg_send![
        &data_store,
        removeDataOfTypes: &*data_types,
        modifiedSince: &*distant_past,
        completionHandler: completion_ptr
    ];
}

unsafe fn perform_webview_void_action(webview: &AnyObject, action: WebViewVoidAction) {
    match action {
        WebViewVoidAction::GoBack => {
            let _: Option<Retained<AnyObject>> = msg_send_id![webview, goBack];
        }
        WebViewVoidAction::GoForward => {
            let _: Option<Retained<AnyObject>> = msg_send_id![webview, goForward];
        }
        WebViewVoidAction::Reload => {
            let _: Option<Retained<AnyObject>> = msg_send_id![webview, reload];
        }
        WebViewVoidAction::ClearWebsiteData => clear_website_data_inner(webview),
    }
}

unsafe fn perform_webview_bool_query(webview: &AnyObject, query: WebViewBoolQuery) -> bool {
    let val: Bool = match query {
        WebViewBoolQuery::CanGoBack => msg_send![webview, canGoBack],
        WebViewBoolQuery::CanGoForward => msg_send![webview, canGoForward],
        WebViewBoolQuery::IsLoading => msg_send![webview, isLoading],
    };
    val.as_bool()
}

unsafe fn perform_webview_f64_query(webview: &AnyObject, query: WebViewF64Query) -> f64 {
    match query {
        WebViewF64Query::EstimatedProgress => msg_send![webview, estimatedProgress],
    }
}

unsafe fn perform_webview_string_query(
    webview: &AnyObject,
    query: WebViewStringQuery,
) -> Option<String> {
    match query {
        WebViewStringQuery::CurrentUrl => {
            let url: Option<Retained<AnyObject>> = msg_send_id![webview, URL];
            let url = url?;
            let abs: Option<Retained<AnyObject>> = msg_send_id![&url, absoluteString];
            let abs = abs?;
            nsobject_utf8_string(&abs)
        }
        WebViewStringQuery::CurrentTitle => {
            let title: Option<Retained<AnyObject>> = msg_send_id![webview, title];
            let title = title?;
            nsobject_utf8_string(&title)
        }
    }
}

unsafe extern "C" fn perform_webview_void_action_on_main_thread(ctx_ptr: *mut std::ffi::c_void) {
    let ctx = &*(ctx_ptr as *const WebViewVoidActionCtx);
    perform_webview_void_action(&*ctx.webview, ctx.action);
}

unsafe extern "C" fn perform_webview_bool_query_on_main_thread(ctx_ptr: *mut std::ffi::c_void) {
    let ctx = &mut *(ctx_ptr as *mut WebViewBoolQueryCtx);
    ctx.result = perform_webview_bool_query(&*ctx.webview, ctx.query);
}

unsafe extern "C" fn perform_webview_f64_query_on_main_thread(ctx_ptr: *mut std::ffi::c_void) {
    let ctx = &mut *(ctx_ptr as *mut WebViewF64QueryCtx);
    ctx.result = perform_webview_f64_query(&*ctx.webview, ctx.query);
}

unsafe extern "C" fn perform_webview_string_query_on_main_thread(ctx_ptr: *mut std::ffi::c_void) {
    let ctx = &mut *(ctx_ptr as *mut WebViewStringQueryCtx);
    ctx.result = perform_webview_string_query(&*ctx.webview, ctx.query);
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
    /// Retained so the webview stays alive until the async block runs.
    webview: Retained<AnyObject>,
}

/// Trampoline called on the main thread by `dispatch_async_f`.
/// Takes ownership of the heap-allocated context and drops it after use.
unsafe extern "C" fn remove_from_parent_on_main_thread(ctx_ptr: *mut std::ffi::c_void) {
    let ctx = Box::from_raw(ctx_ptr as *mut RemoveFromParentCtx);
    let _: () = msg_send![&*ctx.webview, removeFromSuperview];
    // ctx dropped here — releases the Retained webview reference
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
    let html =
        std::str::from_utf8_unchecked(std::slice::from_raw_parts(ctx.html_ptr, ctx.html_len));
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
    fn perform_void_action(&self, action: WebViewVoidAction) {
        if MainThreadMarker::new().is_some() {
            unsafe { perform_webview_void_action(&self.webview, action) };
            return;
        }

        let mut ctx = WebViewVoidActionCtx {
            webview: &*self.webview as *const AnyObject,
            action,
        };
        unsafe {
            dispatch_sync_f(
                &_dispatch_main_q as *const std::ffi::c_void,
                &mut ctx as *mut WebViewVoidActionCtx as *mut std::ffi::c_void,
                perform_webview_void_action_on_main_thread,
            );
        }
    }

    fn perform_bool_query(&self, query: WebViewBoolQuery) -> bool {
        if MainThreadMarker::new().is_some() {
            return unsafe { perform_webview_bool_query(&self.webview, query) };
        }

        let mut ctx = WebViewBoolQueryCtx {
            webview: &*self.webview as *const AnyObject,
            query,
            result: false,
        };
        unsafe {
            dispatch_sync_f(
                &_dispatch_main_q as *const std::ffi::c_void,
                &mut ctx as *mut WebViewBoolQueryCtx as *mut std::ffi::c_void,
                perform_webview_bool_query_on_main_thread,
            );
        }
        ctx.result
    }

    fn perform_f64_query(&self, query: WebViewF64Query) -> f64 {
        if MainThreadMarker::new().is_some() {
            return unsafe { perform_webview_f64_query(&self.webview, query) };
        }

        let mut ctx = WebViewF64QueryCtx {
            webview: &*self.webview as *const AnyObject,
            query,
            result: 0.0,
        };
        unsafe {
            dispatch_sync_f(
                &_dispatch_main_q as *const std::ffi::c_void,
                &mut ctx as *mut WebViewF64QueryCtx as *mut std::ffi::c_void,
                perform_webview_f64_query_on_main_thread,
            );
        }
        ctx.result
    }

    fn perform_string_query(&self, query: WebViewStringQuery) -> Option<String> {
        if MainThreadMarker::new().is_some() {
            return unsafe { perform_webview_string_query(&self.webview, query) };
        }

        let mut ctx = WebViewStringQueryCtx {
            webview: &*self.webview as *const AnyObject,
            query,
            result: None,
        };
        unsafe {
            dispatch_sync_f(
                &_dispatch_main_q as *const std::ffi::c_void,
                &mut ctx as *mut WebViewStringQueryCtx as *mut std::ffi::c_void,
                perform_webview_string_query_on_main_thread,
            );
        }
        ctx.result
    }

    /// Remove the webview from the view hierarchy and drop the handle on the main thread.
    ///
    /// Browser Pane teardown can run on `app-thread`, but the retained WebKit/AppKit
    /// ivars on `WebViewHandle` are `MainThreadOnly`. This method synchronizes the
    /// removal and the final drop back onto the main thread so those ivars are not
    /// released from the wrong thread.
    pub fn destroy(self) {
        if MainThreadMarker::new().is_some() {
            self.remove_from_parent();
            return;
        }

        let ctx = Box::new(DestroyWebViewCtx {
            handle: Box::into_raw(Box::new(self)),
        });
        unsafe {
            dispatch_sync_f(
                &_dispatch_main_q as *const std::ffi::c_void,
                Box::into_raw(ctx) as *mut std::ffi::c_void,
                destroy_webview_on_main_thread,
            );
        }
    }

    /// Create a new WKWebView and add it as a subview of the given parent NSView.
    ///
    /// WebKit **must** be initialised on the main thread.  This method dispatches
    /// synchronously to the main queue so callers on any thread are safe.
    ///
    /// # Safety
    /// `parent_view` must be a valid pointer to an NSView that outlives this handle.
    pub unsafe fn new(parent_view: *mut std::ffi::c_void, pane_id: PaneId) -> Option<Self> {
        if MainThreadMarker::new().is_some() {
            // Already on the main thread — create directly.
            return Self::new_on_main_thread(parent_view, pane_id);
        }

        let mut ctx = WebViewCreateCtx {
            parent_view,
            pane_id,
            result: None,
        };
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
    unsafe fn new_on_main_thread(
        parent_view: *mut std::ffi::c_void,
        pane_id: PaneId,
    ) -> Option<Self> {
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

        // Set up UI delegate for popup handling, JavaScript dialogs, and permissions
        let mtm = MainThreadMarker::new().expect("must be on main thread for WKWebView");
        let delegate: Retained<TideUIDelegate> = unsafe {
            msg_send_id![mtm.alloc::<TideUIDelegate>(), initWithPaneId: pane_id as usize]
        };
        let _: () = msg_send![&webview, setUIDelegate: &*delegate];

        // Set up navigation delegate for download handling
        let nav_delegate: Retained<TideNavigationDelegate> = unsafe {
            msg_send_id![mtm.alloc::<TideNavigationDelegate>(), initWithPaneId: pane_id as usize]
        };
        let _: () = msg_send![&webview, setNavigationDelegate: &*nav_delegate];

        // Set up WKScriptMessageHandler for window.tide.send() bridge (BR-29)
        let script_handler: Retained<TideScriptMessageHandler> =
            unsafe { msg_send_id![mtm.alloc::<TideScriptMessageHandler>(), init] };
        let user_content: Retained<AnyObject> = msg_send_id![&config, userContentController];
        let handler_name = NSString::from_str("tide");
        let _: () = msg_send![&user_content, addScriptMessageHandler: &*script_handler, name: &*handler_name];

        // BR-26: Enable Web Inspector in debug builds (macOS 13.3+).
        // BR-27: isInspectable is NOT set in release builds.
        #[cfg(debug_assertions)]
        {
            let sel = objc2::sel!(setInspectable:);
            let responds: Bool = msg_send![&webview, respondsToSelector: sel];
            if responds.as_bool() {
                let _: () = msg_send![&webview, setInspectable: Bool::YES];
            }
        }

        // Add as subview
        let _: () = msg_send![parent, addSubview: &*webview];

        Some(Self {
            webview,
            pane_id,
            _ui_delegate: delegate,
            _nav_delegate: nav_delegate,
            _script_handler: script_handler,
        })
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
        let nsurl: Option<Retained<AnyObject>> = msg_send_id![url_cls, URLWithString: &*ns_url_str];
        let Some(nsurl) = nsurl else { return };

        let req_cls = AnyClass::get("NSURLRequest").expect("NSURLRequest class");
        let request: Retained<AnyObject> = msg_send_id![req_cls, requestWithURL: &*nsurl];

        let _: Option<Retained<AnyObject>> = msg_send_id![&self.webview, loadRequest: &*request];
    }

    /// Go back in history.
    pub fn go_back(&self) {
        if self.can_go_back() {
            self.perform_void_action(WebViewVoidAction::GoBack);
        }
    }

    /// Go forward in history.
    pub fn go_forward(&self) {
        if self.can_go_forward() {
            self.perform_void_action(WebViewVoidAction::GoForward);
        }
    }

    /// Reload the current page.
    pub fn reload(&self) {
        self.perform_void_action(WebViewVoidAction::Reload);
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
        self.perform_bool_query(WebViewBoolQuery::CanGoBack)
    }

    /// Returns true if the webview can go forward.
    pub fn can_go_forward(&self) -> bool {
        self.perform_bool_query(WebViewBoolQuery::CanGoForward)
    }

    /// Get the current URL as a string, if any.
    pub fn current_url(&self) -> Option<String> {
        self.perform_string_query(WebViewStringQuery::CurrentUrl)
    }

    /// Get the current page title, if any.
    pub fn current_title(&self) -> Option<String> {
        self.perform_string_query(WebViewStringQuery::CurrentTitle)
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
        self.evaluate_javascript(&js);
    }

    /// Clear find-in-page highlight by deselecting.
    pub fn clear_find(&self) {
        self.evaluate_javascript("window.getSelection().removeAllRanges()");
    }

    /// Returns true if the webview is currently loading.
    pub fn is_loading(&self) -> bool {
        self.perform_bool_query(WebViewBoolQuery::IsLoading)
    }

    /// Returns the estimated loading progress (0.0–1.0).
    /// BR-24: estimatedProgress exposed as domain f64 0.0-1.0.
    pub fn estimated_progress(&self) -> f64 {
        self.perform_f64_query(WebViewF64Query::EstimatedProgress)
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
        // Heap-allocate the context with a retained webview reference so it
        // stays alive until the async block runs on the main thread.
        let ctx = Box::into_raw(Box::new(RemoveFromParentCtx {
            webview: self.webview.clone(),
        }));
        unsafe {
            dispatch_async_f(
                &_dispatch_main_q as *const std::ffi::c_void,
                ctx as *mut std::ffi::c_void,
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

    /// Clear website data (cookies, localStorage, sessionStorage, IndexedDB)
    /// from the WKWebsiteDataStore associated with this webview.
    /// BR-22: Clear action removes cookies, localStorage, sessionStorage, IndexedDB.
    /// BR-23: Cookie clear does not break active navigation state.
    pub fn clear_website_data(&self) {
        self.perform_void_action(WebViewVoidAction::ClearWebsiteData);
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
    use std::sync::{LazyLock, Mutex};

    static TEST_MUTEX: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));
    static PERMISSION_DECISION: AtomicIsize = AtomicIsize::new(-1);
    static CERTIFICATE_DISPOSITION: AtomicIsize = AtomicIsize::new(-1);
    static CERTIFICATE_CREDENTIAL_WAS_NULL: AtomicBool = AtomicBool::new(false);

    fn copied_permission_block_ptr() -> *mut std::ffi::c_void {
        let block = block2::StackBlock::new(|decision: isize| {
            PERMISSION_DECISION.store(decision, Ordering::SeqCst);
        });
        let block_ref: &block2::Block<dyn Fn(isize)> = &*block;
        unsafe { _Block_copy(block_ref as *const _ as *const std::ffi::c_void) }
    }

    fn copied_certificate_block_ptr() -> *mut std::ffi::c_void {
        let block = block2::StackBlock::new(|disposition: isize, credential: *mut AnyObject| {
            CERTIFICATE_DISPOSITION.store(disposition, Ordering::SeqCst);
            CERTIFICATE_CREDENTIAL_WAS_NULL.store(credential.is_null(), Ordering::SeqCst);
        });
        let block_ref: &block2::Block<dyn Fn(isize, *mut AnyObject)> = &*block;
        unsafe { _Block_copy(block_ref as *const _ as *const std::ffi::c_void) }
    }

    #[test]
    fn valid_server_trust_does_not_surface_certificate_prompt() {
        assert!(!should_prompt_for_certificate_error(
            "NSURLAuthenticationMethodServerTrust",
            true,
        ));
    }

    #[test]
    fn invalid_server_trust_surfaces_certificate_prompt() {
        assert!(should_prompt_for_certificate_error(
            "NSURLAuthenticationMethodServerTrust",
            false,
        ));
    }

    #[test]
    fn non_server_trust_challenges_use_default_handling() {
        assert!(!should_prompt_for_certificate_error(
            "NSURLAuthenticationMethodHTTPBasic",
            false,
        ));
    }

    #[test]
    fn cleanup_pending_handlers_denies_permission_request_before_release() {
        let _guard = TEST_MUTEX.lock().unwrap_or_else(|e| e.into_inner());
        let pane_id = 42_001;
        PERMISSION_DECISION.store(-1, Ordering::SeqCst);

        {
            let mut handlers = PENDING_PERMISSION_HANDLERS
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            handlers.insert(pane_id, BlockPtr(copied_permission_block_ptr()));
        }

        cleanup_pending_handlers(pane_id);

        assert_eq!(PERMISSION_DECISION.load(Ordering::SeqCst), 0);
        assert!(!PENDING_PERMISSION_HANDLERS
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .contains_key(&pane_id));
    }

    #[test]
    fn cleanup_pending_handlers_cancels_certificate_request_before_release() {
        let _guard = TEST_MUTEX.lock().unwrap_or_else(|e| e.into_inner());
        let pane_id = 42_002;
        CERTIFICATE_DISPOSITION.store(-1, Ordering::SeqCst);
        CERTIFICATE_CREDENTIAL_WAS_NULL.store(false, Ordering::SeqCst);

        {
            let mut handlers = PENDING_CERT_HANDLERS
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            handlers.insert(pane_id, BlockPtr(copied_certificate_block_ptr()));
        }

        cleanup_pending_handlers(pane_id);

        assert_eq!(CERTIFICATE_DISPOSITION.load(Ordering::SeqCst), 2);
        assert!(CERTIFICATE_CREDENTIAL_WAS_NULL.load(Ordering::SeqCst));
        assert!(!PENDING_CERT_HANDLERS
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .contains_key(&pane_id));
    }
}
