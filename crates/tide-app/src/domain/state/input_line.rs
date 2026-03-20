// InputLine — shared text-editing state for popup inputs

pub(crate) struct InputLine {
    pub text: String,
    pub cursor: usize,
}

impl InputLine {
    pub fn new() -> Self {
        Self { text: String::new(), cursor: 0 }
    }

    pub fn with_text(text: String) -> Self {
        let cursor = text.len();
        Self { text, cursor }
    }

    pub fn insert_char(&mut self, ch: char) {
        self.text.insert(self.cursor, ch);
        self.cursor += ch.len_utf8();
    }

    pub fn backspace(&mut self) {
        if self.cursor > 0 {
            let prev = self.text[..self.cursor]
                .char_indices()
                .next_back()
                .map(|(i, _)| i)
                .unwrap_or(0);
            self.text.drain(prev..self.cursor);
            self.cursor = prev;
        }
    }

    pub fn delete_char(&mut self) {
        if self.cursor < self.text.len() {
            let next = self.text[self.cursor..]
                .char_indices()
                .nth(1)
                .map(|(i, _)| self.cursor + i)
                .unwrap_or(self.text.len());
            self.text.drain(self.cursor..next);
        }
    }

    pub fn move_cursor_left(&mut self) {
        if self.cursor > 0 {
            self.cursor = self.text[..self.cursor]
                .char_indices()
                .next_back()
                .map(|(i, _)| i)
                .unwrap_or(0);
        }
    }

    pub fn move_cursor_right(&mut self) {
        if self.cursor < self.text.len() {
            self.cursor = self.text[self.cursor..]
                .char_indices()
                .nth(1)
                .map(|(i, _)| self.cursor + i)
                .unwrap_or(self.text.len());
        }
    }

    pub fn is_empty(&self) -> bool {
        self.text.is_empty()
    }
}

/// Simple shell escaping: wrap in single quotes if the string contains any shell metacharacters.
pub(crate) fn shell_escape(s: &str) -> String {
    // Reject strings with control characters that could inject commands
    if s.bytes().any(|b| b < 0x20 && b != b'\t') {
        return "''".to_string();
    }
    if s.contains(' ') || s.contains('\'') || s.contains('"') || s.contains('\\')
        || s.contains('$') || s.contains('`') || s.contains('!') || s.contains('(')
        || s.contains(')') || s.contains('&') || s.contains(';') || s.contains('|')
        || s.contains('*') || s.contains('?') || s.contains('[') || s.contains(']')
        || s.contains('{') || s.contains('}') || s.contains('#') || s.contains('~')
        || s.contains('\t')
    {
        format!("'{}'", s.replace('\'', "'\\''"))
    } else {
        s.to_string()
    }
}

/// Expand `~` prefix to the user's home directory.
pub(crate) fn expand_tilde(path: &str) -> String {
    if path == "~" || path.starts_with("~/") {
        if let Some(home) = dirs::home_dir() {
            return format!("{}{}", home.display(), &path[1..]);
        }
    }
    path.to_string()
}

/// Abbreviate a path for compact display (replace home dir with ~).
pub(crate) fn abbreviate_path(path: &std::path::Path) -> String {
    if let Some(home) = dirs::home_dir() {
        if let Ok(suffix) = path.strip_prefix(&home) {
            return format!("~/{}", suffix.display());
        }
    }
    path.to_string_lossy().to_string()
}
