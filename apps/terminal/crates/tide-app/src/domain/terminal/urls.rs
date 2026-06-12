// URL detection in terminal output: the match regex and trailing-punctuation
// trimming. Extracted from the terminal facade so URL handling lives on its own.

use std::sync::OnceLock;

static URL_RE: OnceLock<regex::Regex> = OnceLock::new();

pub(crate) fn terminal_url_regex() -> &'static regex::Regex {
    URL_RE.get_or_init(|| regex::Regex::new(r#"https?://[^\s<>"{}|\\^`\[\]]+"#).unwrap())
}

/// Trim unbalanced trailing parentheses and punctuation from a URL match.
/// Preserves balanced parens (e.g. Wikipedia URLs like `https://en.wikipedia.org/wiki/Foo_(bar)`).
pub(crate) fn trim_url_trailing(url: &str) -> &str {
    let mut end = url.len();
    loop {
        if end == 0 {
            break;
        }
        let last = url.as_bytes()[end - 1];
        // Strip trailing punctuation that's unlikely part of a URL
        if matches!(last, b'.' | b',' | b';') {
            end -= 1;
            continue;
        }
        // Strip unbalanced closing paren
        if last == b')' {
            let s = &url[..end];
            let opens = s.bytes().filter(|&b| b == b'(').count();
            let closes = s.bytes().filter(|&b| b == b')').count();
            if closes > opens {
                end -= 1;
                continue;
            }
        }
        break;
    }
    &url[..end]
}
