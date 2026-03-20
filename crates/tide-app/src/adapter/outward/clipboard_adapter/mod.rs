// Clipboard adapter implementations.

use crate::application::ports::outward::clipboard_port::ClipboardPort;

/// Real clipboard using arboard.
pub(crate) struct SystemClipboard;

impl ClipboardPort for SystemClipboard {
    fn get_text(&self) -> Result<String, String> {
        let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
        cb.get_text().map_err(|e| e.to_string())
    }

    fn set_text(&self, text: &str) -> Result<(), String> {
        let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
        cb.set_text(text.to_string()).map_err(|e| e.to_string())
    }
}

/// Noop clipboard for tests.
pub(crate) struct NoopClipboard;

impl ClipboardPort for NoopClipboard {
    fn get_text(&self) -> Result<String, String> {
        Err("no clipboard in test".to_string())
    }

    fn set_text(&self, _text: &str) -> Result<(), String> {
        Ok(())
    }
}
