//! "What's said in the basement stays in the basement."
//! Scrubs secrets and personal details before anything is shared publicly.
//! Deliberately over-eager: a redacted commit hash is a fine price for never
//! publishing a key.

use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Serialize, Debug)]
pub struct Redacted {
    pub text: String,
    pub redactions: BTreeMap<&'static str, usize>,
}

type Span = (usize, usize, String, &'static str);
type Pass<'a> = &'a dyn Fn(&str, &str, &mut Vec<Span>);

fn is_tok(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'-'
}

fn is_b64(b: u8) -> bool {
    b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'+' | b'/' | b'=')
}

fn run_end(b: &[u8], mut i: usize, f: fn(u8) -> bool) -> usize {
    while i < b.len() && f(b[i]) {
        i += 1;
    }
    i
}

const KEY_PREFIXES: &[(&str, usize)] = &[
    ("sk-ant-", 16),
    ("sk-proj-", 16),
    ("sk-", 20),
    ("ghp_", 20),
    ("gho_", 20),
    ("ghu_", 20),
    ("ghs_", 20),
    ("ghr_", 20),
    ("github_pat_", 20),
    ("xoxb-", 10),
    ("xoxp-", 10),
    ("xoxa-", 10),
    ("xoxs-", 10),
    ("akia", 16),
    ("asia", 16),
    ("aiza", 30),
    ("glpat-", 16),
    ("npm_", 30),
    ("pypi-", 30),
    ("hf_", 30),
    ("rk_live_", 16),
    ("sk_live_", 16),
    ("pk_live_", 16),
    ("sk_test_", 16),
    ("whsec_", 16),
    ("re_", 24),
];

fn keys(t: &str, lower: &str, out: &mut Vec<Span>) {
    let b = t.as_bytes();
    for (p, min) in KEY_PREFIXES {
        let mut i = 0;
        while let Some(pos) = lower[i..].find(p) {
            let s = i + pos;
            i = s + p.len();
            if s > 0 && is_tok(b[s - 1]) {
                continue;
            }
            let e = run_end(b, s + p.len(), is_tok);
            if e - (s + p.len()) >= *min {
                // AWS ids are upper-case only; skip lowercase english like "asiatic…"
                if (*p == "akia" || *p == "asia") && !t[s..e].chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit()) {
                    continue;
                }
                out.push((s, e, "[REDACTED:key]".into(), "key"));
                i = e;
            }
        }
    }
}

fn jwts(t: &str, out: &mut Vec<Span>) {
    let b = t.as_bytes();
    let mut i = 0;
    while let Some(pos) = t[i..].find("eyJ") {
        let s = i + pos;
        i = s + 3;
        let mut e = s;
        let mut dots = 0;
        loop {
            let r = run_end(b, e, |c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-');
            e = r;
            if e < b.len() && b[e] == b'.' && dots < 2 {
                dots += 1;
                e += 1;
            } else {
                break;
            }
        }
        if dots == 2 && e - s > 30 {
            out.push((s, e, "[REDACTED:jwt]".into(), "jwt"));
            i = e;
        }
    }
}

fn pem(t: &str, out: &mut Vec<Span>) {
    let mut i = 0;
    while let Some(pos) = t[i..].find("-----BEGIN") {
        let s = i + pos;
        let e = match t[s..].find("-----END") {
            Some(p) => {
                let after = s + p + 8;
                match t[after..].find("-----") {
                    Some(q) => after + q + 5,
                    None => t.len(),
                }
            }
            None => t.len(),
        };
        out.push((s, e, "[REDACTED:private-key]".into(), "private-key"));
        i = e;
        if i >= t.len() {
            break;
        }
    }
}

const SECRET_KEYS: &[&str] = &[
    "password", "passwd", "pwd", "secret", "token", "api_key", "apikey", "api-key", "access_key", "client_secret",
    "auth", "authorization", "private_key", "session", "cookie",
];

fn assignments(t: &str, lower: &str, out: &mut Vec<Span>) {
    let b = t.as_bytes();
    for k in SECRET_KEYS {
        let mut i = 0;
        while let Some(pos) = lower[i..].find(k) {
            let s = i + pos;
            i = s + k.len();
            if s > 0 && b[s - 1].is_ascii_alphanumeric() {
                continue;
            }
            // allow prefixes like DB_PASSWORD / x-api-key
            let mut j = run_end(b, s + k.len(), |c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-');
            j = run_end(b, j, |c| c == b'"' || c == b'\'' || c == b' ');
            if j >= b.len() || !(b[j] == b'=' || b[j] == b':') {
                continue;
            }
            j += 1;
            j = run_end(b, j, |c| c == b' ' || c == b'"' || c == b'\'');
            // "Authorization: Bearer xyz"
            if lower[j..].starts_with("bearer ") || lower[j..].starts_with("basic ") {
                j = run_end(b, j, |c| c != b' ') + 1;
            }
            let e = run_end(b, j, |c| !(c.is_ascii_whitespace() || c == b'"' || c == b'\'' || c == b',' || c == b';' || c == b'}' || c == b'&'));
            if e > j && e - j >= 4 && !t[j..e].starts_with("[REDACTED") {
                out.push((j, e, "[REDACTED:secret]".into(), "secret"));
                i = e;
            }
        }
    }
    // Bearer tokens anywhere
    let mut i = 0;
    while let Some(pos) = lower[i..].find("bearer ") {
        let s = i + pos + 7;
        let e = run_end(b, s, is_b64);
        if e - s >= 16 {
            out.push((s, e, "[REDACTED:token]".into(), "token"));
        }
        i = e.max(s);
    }
}

fn emails(t: &str, out: &mut Vec<Span>) {
    let b = t.as_bytes();
    for (at, _) in t.match_indices('@') {
        let mut s = at;
        while s > 0 && (b[s - 1].is_ascii_alphanumeric() || matches!(b[s - 1], b'.' | b'_' | b'-' | b'+')) {
            s -= 1;
        }
        let mut e = run_end(b, at + 1, |c| c.is_ascii_alphanumeric() || c == b'.' || c == b'-');
        while e > at + 1 && b[e - 1] == b'.' {
            e -= 1;
        }
        let domain = &t[at + 1..e];
        if s < at && domain.contains('.') && !domain.ends_with('.') && domain.len() >= 4 {
            out.push((s, e, "[REDACTED:email]".into(), "email"));
        }
    }
}

fn ips(t: &str, out: &mut Vec<Span>) {
    let b = t.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i].is_ascii_digit() && (i == 0 || !(b[i - 1].is_ascii_alphanumeric() || b[i - 1] == b'.')) {
            let mut j = i;
            let mut parts = 0;
            let mut ok = true;
            loop {
                let e = run_end(b, j, |c| c.is_ascii_digit());
                if e == j || e - j > 3 {
                    ok = false;
                    break;
                }
                if t[j..e].parse::<u16>().map_or(true, |v| v > 255) {
                    ok = false;
                }
                parts += 1;
                j = e;
                if parts < 4 && j < b.len() && b[j] == b'.' && j + 1 < b.len() && b[j + 1].is_ascii_digit() {
                    j += 1;
                } else {
                    break;
                }
            }
            let trailing_ok = j >= b.len() || !(b[j].is_ascii_alphanumeric() || (b[j] == b'.' && j + 1 < b.len() && b[j + 1].is_ascii_digit()));
            if ok && parts == 4 && trailing_ok {
                let ip = &t[i..j];
                if !matches!(ip, "127.0.0.1" | "0.0.0.0" | "255.255.255.255") {
                    out.push((i, j, "[REDACTED:ip]".into(), "ip"));
                }
            }
            i = j.max(i + 1);
        } else {
            i += 1;
        }
    }
}

fn home_paths(t: &str, out: &mut Vec<Span>) {
    let b = t.as_bytes();
    for prefix in ["/Users/", "/home/", "C:\\Users\\", "c:\\users\\", "C:/Users/"] {
        let mut i = 0;
        while let Some(pos) = t[i..].find(prefix) {
            let s = i + pos + prefix.len();
            let e = run_end(b, s, |c| c.is_ascii_alphanumeric() || c == b'.' || c == b'_' || c == b'-');
            if e > s && &t[s..e] != "you" && &t[s..e] != "Shared" {
                out.push((s, e, "you".into(), "home-path"));
            }
            i = e.max(s);
        }
    }
}

fn url_params(t: &str, lower: &str, out: &mut Vec<Span>) {
    let b = t.as_bytes();
    for k in ["token=", "key=", "secret=", "sig=", "signature=", "password=", "auth=", "code=", "access_token=", "x-amz-signature=", "apikey="] {
        let mut i = 0;
        while let Some(pos) = lower[i..].find(k) {
            let s = i + pos;
            i = s + k.len();
            if s == 0 || !(b[s - 1] == b'?' || b[s - 1] == b'&' || b[s - 1] == b'_' || b[s - 1] == b'-') {
                continue;
            }
            let v = s + k.len();
            let e = run_end(b, v, |c| !(c.is_ascii_whitespace() || c == b'&' || c == b'"' || c == b'\'' || c == b'#' || c == b')'));
            if e > v {
                out.push((v, e, "[REDACTED:secret]".into(), "secret"));
            }
        }
    }
}

fn long_secrets(t: &str, out: &mut Vec<Span>) {
    let b = t.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if is_b64(b[i]) && (i == 0 || !is_b64(b[i - 1])) {
            let e = run_end(b, i, is_b64);
            let tok = &t[i..e];
            let digits = tok.bytes().filter(|c| c.is_ascii_digit()).count();
            let alpha = tok.bytes().filter(|c| c.is_ascii_alphabetic()).count();
            let upper = tok.bytes().filter(|c| c.is_ascii_uppercase()).count();
            let lower = alpha - upper;
            let slashes = tok.bytes().filter(|c| *c == b'/').count();
            let mixed = digits >= 4 && alpha >= 8 && (upper >= 2 && lower >= 2 || digits * 4 >= tok.len());
            if tok.len() >= 32 && mixed && slashes <= 2 && !tok.contains("REDACTED") {
                out.push((i, e, "[REDACTED:secret]".into(), "secret"));
            }
            i = e;
        } else {
            i += 1;
        }
    }
}

pub fn redact(input: &str) -> Redacted {
    let mut text = input.to_string();
    let mut counts: BTreeMap<&'static str, usize> = BTreeMap::new();
    // Passes run in order; each one sees the previous pass's output so spans never overlap.
    let passes: [Pass; 8] = [
        &|t, _l, o| pem(t, o),
        &|t, _l, o| jwts(t, o),
        &|t, l, o| keys(t, l, o),
        &|t, l, o| url_params(t, l, o),
        &|t, l, o| assignments(t, l, o),
        &|t, _l, o| emails(t, o),
        &|t, _l, o| ips(t, o),
        &|t, _l, o| {
            home_paths(t, o);
            long_secrets(t, o)
        },
    ];
    for pass in passes {
        let lower = text.to_ascii_lowercase();
        let mut spans: Vec<Span> = Vec::new();
        pass(&text, &lower, &mut spans);
        if spans.is_empty() {
            continue;
        }
        spans.sort_by_key(|s| s.0);
        let mut out = String::with_capacity(text.len());
        let mut last = 0;
        for (s, e, rep, kind) in spans {
            if s < last || !text.is_char_boundary(s) || !text.is_char_boundary(e) {
                continue;
            }
            out.push_str(&text[last..s]);
            out.push_str(&rep);
            *counts.entry(kind).or_insert(0) += 1;
            last = e;
        }
        out.push_str(&text[last..]);
        text = out;
    }
    Redacted { text, redactions: counts }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(s: &str) -> String {
        redact(s).text
    }

    #[test]
    fn api_keys() {
        assert_eq!(r("key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123"), "key [REDACTED:key]");
        assert_eq!(r("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"), "[REDACTED:key]");
        assert_eq!(r("AKIAIOSFODNN7EXAMPLE ok"), "[REDACTED:key] ok");
        assert_eq!(r("the asiatic lion"), "the asiatic lion");
        assert_eq!(r("a task-runner"), "a task-runner");
    }

    #[test]
    fn assignments_and_bearer() {
        assert_eq!(r("DB_PASSWORD=hunter22 next"), "DB_PASSWORD=[REDACTED:secret] next");
        assert_eq!(r("{\"api_key\": \"abcd1234\"}"), "{\"api_key\": \"[REDACTED:secret]\"}");
        assert!(r("Authorization: Bearer abcdefghijklmnopqrstuvwx").contains("[REDACTED"));
        assert!(!r("Authorization: Bearer abcdefghijklmnopqrstuvwx").contains("abcdefghijkl"));
    }

    #[test]
    fn pii() {
        assert_eq!(r("mail me at jane.doe+x@example.co.uk."), "mail me at [REDACTED:email].");
        assert_eq!(r("host 10.0.12.7 port"), "host [REDACTED:ip] port");
        assert_eq!(r("version 1.2.3.4.5"), "version 1.2.3.4.5");
        assert_eq!(r("localhost 127.0.0.1"), "localhost 127.0.0.1");
        assert_eq!(r("/Users/karthik/code/a.ts"), "/Users/you/code/a.ts");
        assert_eq!(r("/home/jdoe/x"), "/home/you/x");
    }

    #[test]
    fn jwt_pem_urls_long() {
        let jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
        assert_eq!(r(&format!("tok {jwt} end")), "tok [REDACTED:jwt] end");
        assert_eq!(r("-----BEGIN PRIVATE KEY-----\nMIIabc\n-----END PRIVATE KEY----- after"), "[REDACTED:private-key] after");
        assert_eq!(r("https://x.io/a?token=abc123&q=1"), "https://x.io/a?token=[REDACTED:secret]&q=1");
        assert!(r("blob Zx8kQ2mN4pL7vR1tY6wB3cD9fG5hJ0kLmNoPqRsT").contains("[REDACTED:secret]"));
        assert_eq!(r("src/components/AuthenticationProvider.tsx"), "src/components/AuthenticationProvider.tsx");
    }

    #[test]
    fn counts_are_reported() {
        let out = redact("a@b.com c@d.org sk-ant-aaaaaaaaaaaaaaaaaaaaaa");
        assert_eq!(out.redactions.get("email"), Some(&2));
        assert_eq!(out.redactions.get("key"), Some(&1));
    }
}
