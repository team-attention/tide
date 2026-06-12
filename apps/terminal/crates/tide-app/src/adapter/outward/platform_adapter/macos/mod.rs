//! macOS native platform backend using objc2.

mod app;
pub(crate) mod ime_proxy;
mod view;
pub mod webview;
mod webview_url;
mod window;

pub(crate) use app::with_window;
pub use app::MacosApp;
#[cfg(test)]
pub(crate) use window::foreground_notification_presentation_options;

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::{LazyLock, Mutex};

use super::{EventCallback, PlatformEvent};
use crate::tide_core::TideWindowId;

/// Last IME target pane ID per `Tide Window`, updated by `focus_ime_proxy`.
/// Used by `windowDidBecomeKey` to re-establish the first responder immediately
/// on the main thread, without waiting for the app thread round-trip.
static LAST_IME_TARGETS: LazyLock<Mutex<HashMap<TideWindowId, u64>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub(crate) fn set_last_ime_target(tide_window_id: TideWindowId, pane_id: u64) {
    LAST_IME_TARGETS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(tide_window_id, pane_id);
}

pub(crate) fn last_ime_target(tide_window_id: TideWindowId) -> u64 {
    LAST_IME_TARGETS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(&tide_window_id)
        .copied()
        .unwrap_or(0)
}

thread_local! {
    /// Queue for events that arrive during re-entrancy (callback already borrowed).
    /// Drained after the outer callback returns, so no events are lost.
    static REENTRANT_QUEUE: RefCell<Vec<PlatformEvent>> = RefCell::new(Vec::new());
}

/// Emit a platform event through the callback, catching panics at the FFI boundary.
///
/// Objective-C → Rust callbacks abort the process on panic, so we wrap every
/// event emission in `catch_unwind`. Re-entrant events (e.g. waker firing during
/// NSTextInputContext processing) are queued and drained after the outer callback
/// returns, so they are never lost.
pub(crate) fn emit_event(
    tide_window_id: TideWindowId,
    callback: &Rc<RefCell<EventCallback>>,
    event: PlatformEvent,
    source: &str,
) {
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        if let Some(window) = app::window_for_event(tide_window_id) {
            if let Ok(mut cb) = callback.try_borrow_mut() {
                cb(event.clone(), window.as_ref());

                // Drain any events that were queued during re-entrancy.
                // Loop until empty because processing queued events may
                // trigger further re-entrant events.
                loop {
                    let queued: Vec<PlatformEvent> = REENTRANT_QUEUE.with(|q| {
                        let mut q = q.borrow_mut();
                        if q.is_empty() {
                            return Vec::new();
                        }
                        std::mem::take(&mut *q)
                    });
                    if queued.is_empty() {
                        break;
                    }
                    for queued_event in queued {
                        cb(queued_event, window.as_ref());
                    }
                }
            } else {
                // Callback is already borrowed — queue for later delivery.
                //
                // Empty ImePreedit events during re-entrancy are artifacts of
                // internal focus management: makeFirstResponder → resignFirstResponder
                // → unmarkText emits ImePreedit("").  These must be dropped (not
                // queued) to prevent resetting Korean IME composition state.
                // Before the re-entrancy queue was added, ALL re-entrant events
                // were dropped, which masked this.
                if matches!(&event, PlatformEvent::ImePreedit { text, .. } if text.is_empty()) {
                    log::trace!("{source}: dropping empty ImePreedit (re-entrancy artifact)");
                } else {
                    log::trace!("{source}: event queued (re-entrancy): {event:?}");
                    REENTRANT_QUEUE.with(|q| {
                        q.borrow_mut().push(event.clone());
                    });
                }
            }
        }
    }));
    if let Err(e) = result {
        let msg = if let Some(s) = e.downcast_ref::<&str>() {
            s.to_string()
        } else if let Some(s) = e.downcast_ref::<String>() {
            s.clone()
        } else {
            "unknown panic".to_string()
        };
        eprintln!("[tide] PANIC in {source} callback: {msg}");
    }
}
