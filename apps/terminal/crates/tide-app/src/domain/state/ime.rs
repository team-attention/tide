// ImeState — IME composition state.

pub(crate) struct ImeState {
    pub composing: bool,
    pub preedit: String,
    pub last_target: Option<u64>,
    pub pending_creates: Vec<u64>,
    pub pending_removes: Vec<u64>,
    pub cursor_dirty: bool,
}

impl ImeState {
    pub fn new() -> Self {
        Self {
            composing: false,
            preedit: String::new(),
            last_target: None,
            pending_creates: Vec::new(),
            pending_removes: Vec::new(),
            cursor_dirty: true,
        }
    }

    /// Clear composition state (replaces 12+ inline pairs).
    pub fn clear_composition(&mut self) {
        self.composing = false;
        self.preedit.clear();
    }

    /// Update preedit text and composing flag together.
    pub fn set_preedit(&mut self, text: &str) {
        self.composing = !text.is_empty();
        self.preedit = text.to_string();
    }
}
