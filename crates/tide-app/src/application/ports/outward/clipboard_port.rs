// ClipboardPort — abstracts system clipboard for testability.

pub(crate) trait ClipboardPort {
    fn get_text(&self) -> Result<String, String>;
    fn set_text(&self, text: &str) -> Result<(), String>;
}
