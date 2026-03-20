// LSP adapter implementations.

use std::path::Path;

use crate::application::ports::outward::lsp_port::LspPort;

// ── Real implementation (production) ──

pub(crate) struct RealLsp {
    manager: Option<crate::tide_lsp::LspManager>,
}

impl RealLsp {
    pub fn new() -> Self {
        Self { manager: None }
    }
}

impl LspPort for RealLsp {
    fn init(&mut self, root: &Path, waker: Option<crate::tide_platform::WakeCallback>) {
        self.manager = Some(crate::tide_lsp::LspManager::new(root.to_path_buf(), waker));
    }

    fn is_initialized(&self) -> bool {
        self.manager.is_some()
    }

    fn did_open(&mut self, uri: &str, lang: crate::tide_lsp::manager::Language, text: &str) {
        if let Some(ref mut lsp) = self.manager {
            lsp.did_open(uri, lang, text);
        }
    }

    fn did_change(&mut self, uri: &str, text: &str) {
        if let Some(ref mut lsp) = self.manager {
            lsp.did_change(uri, text);
        }
    }

    fn did_save(&mut self, uri: &str) {
        if let Some(ref mut lsp) = self.manager {
            lsp.did_save(uri);
        }
    }

    fn did_close(&mut self, uri: &str) {
        if let Some(ref mut lsp) = self.manager {
            lsp.did_close(uri);
        }
    }

    fn request_completion(&mut self, uri: &str, line: u32, character: u32, trigger_kind: u32, trigger_char: Option<&str>) {
        if let Some(ref mut lsp) = self.manager {
            lsp.request_completion(uri, line, character, trigger_kind, trigger_char);
        }
    }

    fn trigger_characters(&self, lang: crate::tide_lsp::manager::Language) -> Vec<String> {
        self.manager.as_ref()
            .map(|lsp| lsp.trigger_characters(lang).to_vec())
            .unwrap_or_default()
    }

    fn poll(&mut self) -> Option<crate::tide_lsp::manager::CompletionResponse> {
        self.manager.as_mut()?.poll()
    }
}

// ── Noop implementation (tests) ──

pub(crate) struct NoopLsp;

impl LspPort for NoopLsp {
    fn init(&mut self, _root: &Path, _waker: Option<crate::tide_platform::WakeCallback>) {}
    fn is_initialized(&self) -> bool { false }
    fn did_open(&mut self, _uri: &str, _lang: crate::tide_lsp::manager::Language, _text: &str) {}
    fn did_change(&mut self, _uri: &str, _text: &str) {}
    fn did_save(&mut self, _uri: &str) {}
    fn did_close(&mut self, _uri: &str) {}
    fn request_completion(&mut self, _uri: &str, _line: u32, _character: u32, _trigger_kind: u32, _trigger_char: Option<&str>) {}
    fn trigger_characters(&self, _lang: crate::tide_lsp::manager::Language) -> Vec<String> { Vec::new() }
    fn poll(&mut self) -> Option<crate::tide_lsp::manager::CompletionResponse> { None }
}
