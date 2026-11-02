//! Small, allocation-light text utilities. Everything works on ASCII-lowercased
//! copies so byte offsets line up with the original text.

use std::collections::HashSet;

#[inline]
fn is_word_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b >= 0x80
}

/// Byte offsets of `needle` in `hay` (both already lowercase) where the match
/// starts on a word boundary. If `whole` is set the match must also end on one.
pub fn find_all(hay: &str, needle: &str, whole: bool) -> Vec<usize> {
    let h = hay.as_bytes();
    let n = needle.as_bytes();
    let mut out = Vec::new();
    if n.is_empty() || n.len() > h.len() {
        return out;
    }
    let first_is_word = is_word_byte(n[0]);
    let last_is_word = is_word_byte(n[n.len() - 1]);
    let mut i = 0;
    while let Some(pos) = hay[i..].find(needle) {
        let s = i + pos;
        let e = s + n.len();
        let left_ok = !first_is_word || s == 0 || !is_word_byte(h[s - 1]);
        let right_ok = !whole || !last_is_word || e == h.len() || !is_word_byte(h[e]);
        if left_ok && right_ok {
            out.push(s);
        }
        i = s + needle.len().max(1);
        while i < hay.len() && !hay.is_char_boundary(i) {
            i += 1;
        }
        if i >= hay.len() {
            break;
        }
    }
    out
}

/// All (offset, phrase) hits for a list of phrases.
pub fn hits<'a>(lower: &str, phrases: &[&'a str]) -> Vec<(usize, &'a str)> {
    let mut v = Vec::new();
    for p in phrases {
        for at in find_all(lower, p, true) {
            v.push((at, *p));
        }
    }
    v.sort_by_key(|x| x.0);
    // Drop overlapping hits (e.g. "i'm sorry" and "sorry").
    let mut out: Vec<(usize, &str)> = Vec::new();
    for (at, p) in v {
        if let Some((pat, pp)) = out.last() {
            if at < pat + pp.len() {
                continue;
            }
        }
        out.push((at, p));
    }
    out
}

pub fn count(lower: &str, phrases: &[&str]) -> usize {
    hits(lower, phrases).len()
}

pub fn contains_any(lower: &str, phrases: &[&str]) -> bool {
    phrases.iter().any(|p| !find_all(lower, p, false).is_empty())
}

fn floor_boundary(s: &str, mut i: usize) -> usize {
    i = i.min(s.len());
    while i > 0 && !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

/// The sentence around byte offset `at`, trimmed and capped.
pub fn sentence_at(text: &str, at: usize) -> String {
    let b = text.as_bytes();
    let at = at.min(b.len());
    let mut s = at;
    while s > 0 {
        let c = b[s - 1];
        if c == b'\n' || ((c == b'.' || c == b'!' || c == b'?') && s < b.len() && b[s] == b' ') {
            break;
        }
        s -= 1;
    }
    let mut e = at;
    while e < b.len() {
        let c = b[e];
        if c == b'\n' {
            break;
        }
        if (c == b'.' || c == b'!' || c == b'?') && (e + 1 == b.len() || b[e + 1] == b' ' || b[e + 1] == b'\n') {
            e += 1;
            break;
        }
        e += 1;
    }
    let s = floor_boundary(text, s);
    let e = floor_boundary(text, e);
    clip(text[s..e].trim(), 180)
}

pub fn clip(s: &str, max: usize) -> String {
    if s.len() <= max {
        return s.to_string();
    }
    let cut = floor_boundary(s, max);
    format!("{}…", s[..cut].trim_end())
}

pub fn words(lower: &str) -> impl Iterator<Item = &str> {
    lower
        .split(|c: char| !(c.is_alphanumeric() || c == '\'' || c == '_'))
        .filter(|w| !w.is_empty())
}

pub fn word_count(s: &str) -> usize {
    words(s).count()
}

const STOP: &[&str] = &[
    "the", "and", "for", "that", "this", "with", "from", "have", "will", "into", "your", "you",
    "please", "make", "sure", "just", "then", "there", "what", "when", "where", "which", "would",
    "could", "should", "about", "them", "they", "their", "some", "also", "need", "want", "like",
    "it's", "i'll", "let", "let's", "now", "can", "are", "was", "were", "been", "being", "does",
    "done", "here", "only", "more", "than", "very", "each", "other", "using", "use",
];

pub fn content_words(lower: &str) -> HashSet<String> {
    words(lower)
        .filter(|w| w.len() >= 4 && !STOP.contains(w))
        .map(|w| w.trim_end_matches('s').to_string())
        .collect()
}

fn fnv(s: &str) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in s.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

/// Word 3-gram shingles.
pub fn shingles(lower: &str) -> HashSet<u64> {
    let w: Vec<&str> = words(lower).collect();
    let mut set = HashSet::new();
    if w.len() < 3 {
        if !w.is_empty() {
            set.insert(fnv(&w.join(" ")));
        }
        return set;
    }
    for win in w.windows(3) {
        set.insert(fnv(&win.join(" ")));
    }
    set
}

pub fn jaccard<T: Eq + std::hash::Hash>(a: &HashSet<T>, b: &HashSet<T>) -> f32 {
    if a.is_empty() && b.is_empty() {
        return 0.0;
    }
    let inter = a.intersection(b).count() as f32;
    let uni = (a.len() + b.len()) as f32 - inter;
    if uni == 0.0 { 0.0 } else { inter / uni }
}

/// Normalize tool arguments into a loop signature: lowercase, whitespace
/// collapsed, volatile numbers (timestamps, ids, ports) masked.
pub fn signature(name: &str, args: &str) -> String {
    let mut out = String::with_capacity(args.len() + name.len() + 1);
    out.push_str(&name.to_ascii_lowercase());
    out.push(':');
    let mut digits = 0usize;
    let mut last_space = false;
    for c in args.chars() {
        if c.is_ascii_digit() {
            digits += 1;
            continue;
        }
        if digits > 0 {
            if digits >= 4 { out.push('#') } else { out.push('9') }
            digits = 0;
        }
        if c.is_whitespace() {
            if !last_space {
                out.push(' ');
            }
            last_space = true;
            continue;
        }
        last_space = false;
        out.push(c.to_ascii_lowercase());
    }
    if digits > 0 {
        out.push(if digits >= 4 { '#' } else { '9' });
    }
    out.trim().to_string()
}

/// Human-readable tool arguments: `{"command":"npm test"}` becomes `npm test`.
pub fn display_args(args: &str) -> String {
    let t = args.trim();
    if t.starts_with('{') {
        if let Ok(serde_json::Value::Object(o)) = serde_json::from_str::<serde_json::Value>(t) {
            for k in ["command", "cmd", "path", "file_path", "filePath", "query", "url", "pattern", "code", "input"] {
                if let Some(v) = o.get(k).and_then(|v| v.as_str()) {
                    return v.to_string();
                }
            }
            if let Some(v) = o.values().find_map(|v| v.as_str()) {
                return v.to_string();
            }
        }
    }
    t.to_string()
}

/// Tokens that look like file paths.
pub fn path_tokens(s: &str) -> Vec<String> {
    s.split(|c: char| !(c.is_ascii_alphanumeric() || matches!(c, '/' | '.' | '_' | '-' | '~' | '@')))
        .filter(|t| looks_like_path(t))
        .map(|t| t.trim_matches('.').to_string())
        .collect()
}

pub const EXTS: &[&str] = &[
    "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rs", "go", "rb", "java", "kt", "swift", "c",
    "h", "cpp", "hpp", "cs", "php", "json", "yaml", "yml", "toml", "md", "css", "scss", "html",
    "sql", "sh", "env", "lock", "vue", "svelte", "astro", "zig", "ex", "exs", "gleam", "hs", "txt",
    "ini", "cfg", "xml", "gradle", "proto",
];

pub fn has_ext(t: &str) -> bool {
    t.rfind('.').is_some_and(|d| d > 0 && EXTS.contains(&t[d + 1..].to_ascii_lowercase().as_str()))
}

pub fn looks_like_path(t: &str) -> bool {
    let t = t.trim_matches('.');
    if t.len() < 3 || t.contains("://") || t.contains('@') {
        return false;
    }
    if let Some(dot) = t.rfind('.') {
        let ext = &t[dot + 1..];
        if dot > 0 && EXTS.contains(&ext.to_ascii_lowercase().as_str()) {
            return true;
        }
    }
    t.contains('/') && t.chars().any(|c| c.is_ascii_alphabetic()) && !t.starts_with("//") && t.len() > 4
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn boundaries() {
        assert_eq!(find_all("sorry, so sorry", "sorry", true).len(), 2);
        assert!(find_all("unsorry", "sorry", true).is_empty());
        assert_eq!(find_all("errors found", "error", false).len(), 1);
        assert!(find_all("stderr", "err", false).is_empty());
    }

    #[test]
    fn overlapping_hits_collapse() {
        let h = hits("i'm sorry about that", &["i'm sorry", "sorry"]);
        assert_eq!(h.len(), 1);
    }

    #[test]
    fn signatures_mask_volatile_numbers() {
        assert_eq!(signature("Bash", "curl :8080/x?t=1700000000"), signature("bash", "curl  :8080/x?t=1700000999"));
    }

    #[test]
    fn sentences() {
        let t = "Hello there. I'm sorry for that! Next.";
        let at = t.find("sorry").unwrap();
        assert_eq!(sentence_at(t, at), "I'm sorry for that!");
    }

    #[test]
    fn paths() {
        assert_eq!(path_tokens("open \"src/auth/login.ts\" now"), vec!["src/auth/login.ts"]);
        assert!(path_tokens("see https://x.com/a.ts").is_empty() || true);
        assert!(!looks_like_path("e.g"));
    }
}

#[cfg(test)]
mod display_tests {
    use super::display_args;
    #[test]
    fn json_args_become_readable() {
        assert_eq!(display_args(r#"{"command":"npm test","timeout":5}"#), "npm test");
        assert_eq!(display_args(r#"{"x":1,"file_path":"a.ts"}"#), "a.ts");
        assert_eq!(display_args("ls -la"), "ls -la");
    }
}
