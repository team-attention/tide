// LspPort — Language Server Protocol integration.

use std::path::Path;

pub(crate) trait LspPort {
    fn init(&mut self, root: &Path, waker: Option<crate::tide_platform::WakeCallback>);
    fn is_initialized(&self) -> bool;
    fn did_open(&mut self, uri: &str, lang: crate::tide_lsp::manager::Language, text: &str);
    fn did_change(&mut self, uri: &str, text: &str);
    fn did_save(&mut self, uri: &str);
    fn did_close(&mut self, uri: &str);
    fn request_completion(
        &mut self,
        uri: &str,
        line: u32,
        character: u32,
        trigger_kind: u32,
        trigger_char: Option<&str>,
    );
    fn trigger_characters(&self, lang: crate::tide_lsp::manager::Language) -> Vec<String>;
    fn poll(&mut self) -> Option<crate::tide_lsp::manager::CompletionResponse>;
    /// Whether a server is running for `uri` so LSP code navigation is possible.
    fn supports_navigation(&self, uri: &str) -> bool;
    fn request_definition(&mut self, uri: &str, line: u32, character: u32);
    fn request_references(&mut self, uri: &str, line: u32, character: u32);
    fn poll_navigation(&mut self) -> Option<crate::tide_lsp::manager::NavigationResponse>;
}
