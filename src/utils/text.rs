//! Turning a command's or a file's bytes into text the model can read.
use crate::config::settings::MAX_OUTPUT;

/// Decode bytes as UTF-8, falling back to Windows-1252 when they are not valid UTF-8.
///
/// The byte order mark is kept in the string so a caller that cares can strip it explicitly,
/// instead of the decoder doing it for UTF-8 only and leaving it as mojibake for the fallback.
/// The fallback is the WHATWG Windows-1252 table, the one `TextDecoder` used in 4.x.
pub fn decode(payload: &[u8]) -> String {
    match std::str::from_utf8(payload) {
        Ok(text) => text.to_string(),
        Err(_) => encoding_rs::WINDOWS_1252
            .decode_without_bom_handling(payload)
            .0
            .into_owned(),
    }
}

/// The text, cut to the output ceiling in characters, and whether it was cut.
pub fn truncate(text: String) -> (String, bool) {
    match text.char_indices().nth(MAX_OUTPUT) {
        Some((cut, _)) => (format!("{}\n... (truncated)", &text[..cut]), true),
        None => (text, false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_utf8_and_keeps_the_bom() {
        assert_eq!(decode("héllo".as_bytes()), "héllo");
        assert_eq!(decode(b"\xEF\xBB\xBFx"), "\u{FEFF}x");
    }

    #[test]
    fn falls_back_to_windows_1252() {
        assert_eq!(decode(b"caf\xE9 \x80"), "café €");
    }

    #[test]
    fn truncates_past_the_ceiling_only() {
        let exact = "a".repeat(MAX_OUTPUT);
        assert_eq!(truncate(exact.clone()), (exact, false));

        let (cut, truncated) = truncate("é".repeat(MAX_OUTPUT + 5));
        assert!(truncated);
        assert!(cut.ends_with("\n... (truncated)"));
        assert_eq!(cut.chars().count(), MAX_OUTPUT + "\n... (truncated)".len());
    }
}
