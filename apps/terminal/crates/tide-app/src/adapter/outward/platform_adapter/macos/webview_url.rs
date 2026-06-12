// Pure URL parsing helpers for Browser Auth Popup handling (no objc2).
// Extracted from webview.rs.

pub(super) fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

pub(super) fn percent_decode_query_component(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' => {
                let hi = *bytes.get(i + 1)?;
                let lo = *bytes.get(i + 2)?;
                out.push(hex_value(hi)? << 4 | hex_value(lo)?);
                i += 3;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            byte => {
                out.push(byte);
                i += 1;
            }
        }
    }
    String::from_utf8(out).ok()
}

pub(super) fn query_param<'a>(query: &'a str, key: &str) -> Option<&'a str> {
    query.split('&').find_map(|pair| {
        let (raw_key, raw_value) = pair.split_once('=').unwrap_or((pair, ""));
        let decoded_key = percent_decode_query_component(raw_key)?;
        (decoded_key == key).then_some(raw_value)
    })
}

pub(super) fn safe_https_origin(origin: &str) -> Option<String> {
    if !origin.starts_with("https://") || origin.chars().any(char::is_control) {
        return None;
    }

    let after_scheme = &origin["https://".len()..];
    let authority = after_scheme
        .split(['/', '?', '#'])
        .next()
        .unwrap_or_default();
    if authority.is_empty() || authority.contains('@') {
        return None;
    }

    Some(origin.to_string())
}
