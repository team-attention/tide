// Clipboard adapter implementations.

use crate::application::ports::outward::clipboard_port::ClipboardPort;

#[cfg(target_os = "macos")]
use std::process::{Command, Output};

/// Real system clipboard.
pub(crate) struct SystemClipboard;

impl ClipboardPort for SystemClipboard {
    fn get_text(&self) -> Result<String, String> {
        system_get_text()
    }

    fn set_text(&self, text: &str) -> Result<(), String> {
        system_set_text(text)
    }
}

#[cfg(not(target_os = "macos"))]
fn system_get_text() -> Result<String, String> {
    let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    cb.get_text().map_err(|e| e.to_string())
}

#[cfg(not(target_os = "macos"))]
fn system_set_text(text: &str) -> Result<(), String> {
    let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    cb.set_text(text.to_string()).map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
fn system_get_text() -> Result<String, String> {
    // Keep pasteboard reads out-of-process so malformed pasteboard providers
    // fail as ClipboardPort errors instead of crashing Tide inside AppKit.
    let output = Command::new("/usr/bin/pbpaste")
        .args(["-Prefer", "txt"])
        .env("LANG", "en_US.UTF-8")
        .output()
        .map_err(|e| format!("pbpaste failed: {e}"))?;

    decode_pbpaste_output(output)
}

#[cfg(target_os = "macos")]
fn decode_pbpaste_output(output: Output) -> Result<String, String> {
    if !output.status.success() {
        return Err(process_error("pbpaste", &output));
    }

    String::from_utf8(output.stdout).map_err(|_| "pbpaste returned non-UTF-8 text".to_string())
}

#[cfg(target_os = "macos")]
fn system_set_text(text: &str) -> Result<(), String> {
    let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    cb.set_text(text.to_string()).map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
fn process_error(command: &str, output: &Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stderr = stderr.trim();
    if stderr.is_empty() {
        format!("{command} exited with {}", output.status)
    } else {
        format!("{command} exited with {}: {stderr}", output.status)
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

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use std::os::unix::process::ExitStatusExt;

    fn output(exit_code: i32, stdout: &[u8], stderr: &[u8]) -> Output {
        Output {
            status: std::process::ExitStatus::from_raw(exit_code << 8),
            stdout: stdout.to_vec(),
            stderr: stderr.to_vec(),
        }
    }

    #[test]
    fn pbpaste_output_decodes_utf8_text() {
        let text = decode_pbpaste_output(output(0, b"hello", b"")).unwrap();

        assert_eq!(text, "hello");
    }

    #[test]
    fn pbpaste_output_reports_nonzero_status_as_error() {
        let err = decode_pbpaste_output(output(1, b"", b"pasteboard failed"))
            .expect_err("nonzero pbpaste status should fail");

        assert!(err.contains("pbpaste exited"));
        assert!(err.contains("pasteboard failed"));
    }

    #[test]
    fn pbpaste_output_rejects_non_utf8_text() {
        let err = decode_pbpaste_output(output(0, &[0xff], b""))
            .expect_err("non-UTF-8 pbpaste output should fail");

        assert_eq!(err, "pbpaste returned non-UTF-8 text");
    }
}
