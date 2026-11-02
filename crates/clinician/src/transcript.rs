//! Transcript ingestion. Accepts plain text ("User: … / Assistant: … / Call: … /
//! Result: …"), a JSON array of chat messages, or an object wrapping one.
//! Anthropic content blocks and OpenAI `tool_calls` are both understood.

use serde::Serialize;
use serde_json::Value;

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    User,
    Assistant,
    Call,
    Result,
    System,
}

#[derive(Serialize, Clone, Debug)]
pub struct Event {
    pub kind: Kind,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<String>,
    #[serde(skip_serializing_if = "is_false")]
    pub error: bool,
}

fn is_false(b: &bool) -> bool {
    !*b
}

#[derive(Default, Debug)]
pub struct Transcript {
    pub task: Option<String>,
    pub events: Vec<Event>,
}

/// Normalize typographic quotes so phrase matching is stable.
pub fn normalize(s: &str) -> String {
    s.replace(['\u{2019}', '\u{2018}'], "'")
        .replace(['\u{201C}', '\u{201D}'], "\"")
        .replace('\r', "")
}

pub fn parse(input: &str) -> Transcript {
    let trimmed = input.trim_start();
    if trimmed.starts_with('{') || trimmed.starts_with('[') {
        if let Ok(v) = serde_json::from_str::<Value>(trimmed) {
            return from_json(&v);
        }
    }
    from_text(input)
}

// ---------------------------------------------------------------- JSON

fn from_json(v: &Value) -> Transcript {
    let mut t = Transcript::default();
    match v {
        Value::Array(msgs) => push_messages(&mut t, msgs),
        Value::Object(o) => {
            if let Some(task) = o.get("task").and_then(Value::as_str) {
                t.task = Some(normalize(task));
            }
            match o.get("messages").or_else(|| o.get("transcript")) {
                Some(Value::Array(msgs)) => push_messages(&mut t, msgs),
                Some(Value::String(s)) => {
                    let inner = from_text(s);
                    t.events = inner.events;
                }
                _ => {
                    // A single message object.
                    push_messages(&mut t, std::slice::from_ref(v));
                }
            }
        }
        _ => {}
    }
    t
}

fn str_of(v: Option<&Value>) -> String {
    match v {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(|p| match p {
                Value::String(s) => Some(s.clone()),
                Value::Object(o) => o.get("text").and_then(Value::as_str).map(str::to_owned),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("\n"),
        Some(Value::Null) | None => String::new(),
        Some(other) => other.to_string(),
    }
}

fn args_of(v: Option<&Value>) -> String {
    match v {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Null) | None => String::new(),
        Some(other) => other.to_string(),
    }
}

fn role_kind(role: &str) -> Kind {
    match role.to_ascii_lowercase().as_str() {
        "user" | "human" => Kind::User,
        "tool" | "function" | "tool_result" | "observation" => Kind::Result,
        "system" | "developer" => Kind::System,
        _ => Kind::Assistant,
    }
}

fn push(t: &mut Transcript, kind: Kind, text: String, tool: Option<String>, error: bool) {
    let text = normalize(&text);
    if text.trim().is_empty() && kind != Kind::Call && kind != Kind::Result {
        return;
    }
    t.events.push(Event { kind, text, tool, error });
}

fn push_messages(t: &mut Transcript, msgs: &[Value]) {
    for m in msgs {
        let Some(o) = m.as_object() else {
            if let Some(s) = m.as_str() {
                push(t, Kind::Assistant, s.to_owned(), None, false);
            }
            continue;
        };
        let role = o
            .get("role")
            .or_else(|| o.get("type"))
            .and_then(Value::as_str)
            .unwrap_or("assistant");
        let kind = role_kind(role);
        let is_err = o.get("is_error").and_then(Value::as_bool).unwrap_or(false);
        let tool_name = o.get("name").and_then(Value::as_str).map(str::to_owned);

        // Bare call objects: {"type":"tool_call"|"function_call", name, arguments}
        if matches!(role, "tool_call" | "function_call" | "tool_use") {
            push(
                t,
                Kind::Call,
                args_of(o.get("arguments").or_else(|| o.get("input"))),
                tool_name,
                false,
            );
            continue;
        }

        match o.get("content") {
            Some(Value::Array(blocks))
                if blocks.iter().any(|b| b.get("type").is_some()) =>
            {
                let mut text = String::new();
                for b in blocks {
                    let bt = b.get("type").and_then(Value::as_str).unwrap_or("text");
                    match bt {
                        "tool_use" | "tool_call" | "function_call" => {
                            if !text.is_empty() {
                                push(t, kind, std::mem::take(&mut text), None, false);
                            }
                            let name = b.get("name").and_then(Value::as_str).map(str::to_owned);
                            push(
                                t,
                                Kind::Call,
                                args_of(b.get("input").or_else(|| b.get("arguments"))),
                                name,
                                false,
                            );
                        }
                        "tool_result" | "function_result" => {
                            if !text.is_empty() {
                                push(t, kind, std::mem::take(&mut text), None, false);
                            }
                            let err = b.get("is_error").and_then(Value::as_bool).unwrap_or(false);
                            push(t, Kind::Result, str_of(b.get("content").or_else(|| b.get("output"))), None, err);
                        }
                        _ => {
                            if let Some(s) = b.get("text").and_then(Value::as_str) {
                                if !text.is_empty() {
                                    text.push('\n');
                                }
                                text.push_str(s);
                            }
                        }
                    }
                }
                if !text.is_empty() {
                    push(t, kind, text, if kind == Kind::Result { tool_name } else { None }, is_err);
                }
            }
            other => {
                let text = str_of(other);
                if kind == Kind::Result {
                    push(t, Kind::Result, text, tool_name, is_err);
                } else if !text.trim().is_empty() {
                    push(t, kind, text, None, false);
                }
            }
        }

        // OpenAI style tool calls on the assistant message.
        if let Some(Value::Array(calls)) = o.get("tool_calls") {
            for c in calls {
                let f = c.get("function").unwrap_or(c);
                let name = f.get("name").and_then(Value::as_str).map(str::to_owned);
                push(t, Kind::Call, args_of(f.get("arguments").or_else(|| f.get("input"))), name, false);
            }
        }
    }
}

// ---------------------------------------------------------------- text

const PREFIXES: &[(&str, Kind)] = &[
    ("tool call:", Kind::Call),
    ("tool result:", Kind::Result),
    ("assistant:", Kind::Assistant),
    ("observation:", Kind::Result),
    ("claude:", Kind::Assistant),
    ("system:", Kind::System),
    ("human:", Kind::User),
    ("output:", Kind::Result),
    ("result:", Kind::Result),
    ("action:", Kind::Call),
    ("agent:", Kind::Assistant),
    ("model:", Kind::Assistant),
    ("error:", Kind::Result),
    ("user:", Kind::User),
    ("call:", Kind::Call),
    ("tool:", Kind::Result),
    ("you:", Kind::User),
    ("ai:", Kind::Assistant),
    ("$ ", Kind::Call),
];

fn line_prefix(line: &str) -> Option<(Kind, usize, bool)> {
    let l = line.trim_start();
    let indent = line.len() - l.len();
    let lower = l.get(..l.len().min(14)).unwrap_or(l).to_ascii_lowercase();
    for (p, k) in PREFIXES {
        if lower.starts_with(p) {
            let is_err = *p == "error:";
            // "Error:" lines keep their text; other prefixes are stripped.
            let skip = if is_err { 0 } else { p.len() };
            return Some((*k, indent + skip, is_err));
        }
    }
    None
}

/// Split a call line like `bash(npm test)` or `read_file src/a.ts` into (name, args).
pub fn split_call(s: &str, shell_prompt: bool) -> (String, String) {
    let s = s.trim();
    if shell_prompt {
        return ("bash".into(), s.into());
    }
    let name_end = s
        .find(|c: char| !(c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.' || c == ':'))
        .unwrap_or(s.len());
    if name_end == 0 {
        return ("tool".into(), s.into());
    }
    let name = &s[..name_end];
    let rest = s[name_end..].trim();
    let args = if rest.starts_with('(') && rest.ends_with(')') {
        &rest[1..rest.len() - 1]
    } else {
        rest
    };
    (name.to_string(), args.trim().to_string())
}

fn from_text(input: &str) -> Transcript {
    let input = normalize(input);
    let mut t = Transcript::default();
    let mut cur: Option<(Kind, String, bool, bool)> = None; // kind, text, error, shell
    let flush = |t: &mut Transcript, cur: &mut Option<(Kind, String, bool, bool)>| {
        if let Some((k, text, err, shell)) = cur.take() {
            let text = text.trim().to_string();
            if k == Kind::Call {
                let (name, args) = split_call(&text, shell);
                t.events.push(Event { kind: Kind::Call, text: args, tool: Some(name), error: false });
            } else if !text.is_empty() || k == Kind::Result {
                t.events.push(Event { kind: k, text, tool: None, error: err });
            }
        }
    };
    let mut saw_prefix = false;
    for line in input.lines() {
        if line.trim_start().starts_with("# ") && !saw_prefix && cur.is_none() {
            // Corpus header comments ("# labels: …") before the transcript begins.
            continue;
        }
        if let Some((k, skip, is_err)) = line_prefix(line) {
            saw_prefix = true;
            let shell = line.trim_start().starts_with("$ ");
            // Consecutive "$ " lines are separate calls; consecutive
            // "Error:" lines belong to the same result block.
            if let Some((ck, ctext, cerr, _)) = cur.as_mut() {
                if *ck == Kind::Result && k == Kind::Result && is_err {
                    *cerr = true;
                    ctext.push('\n');
                    ctext.push_str(line.trim());
                    continue;
                }
            }
            flush(&mut t, &mut cur);
            cur = Some((k, line[skip..].trim_start().to_string(), is_err, shell));
        } else if let Some((_, text, _, _)) = cur.as_mut() {
            text.push('\n');
            text.push_str(line);
        } else if !line.trim().is_empty() {
            cur = Some((Kind::Assistant, line.to_string(), false, false));
        }
    }
    flush(&mut t, &mut cur);
    t
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_plain_text() {
        let t = parse("User: fix it\nAssistant: ok\nCall: bash(npm test)\nResult: 1 failing\n  at line 3\n$ ls src");
        let kinds: Vec<_> = t.events.iter().map(|e| e.kind).collect();
        assert_eq!(kinds, vec![Kind::User, Kind::Assistant, Kind::Call, Kind::Result, Kind::Call]);
        assert_eq!(t.events[2].tool.as_deref(), Some("bash"));
        assert_eq!(t.events[2].text, "npm test");
        assert!(t.events[3].text.contains("line 3"));
        assert_eq!(t.events[4].text, "ls src");
    }

    #[test]
    fn parses_anthropic_blocks() {
        let j = r#"[{"role":"user","content":"hi"},
            {"role":"assistant","content":[{"type":"text","text":"reading"},{"type":"tool_use","name":"read_file","input":{"path":"a.ts"}}]},
            {"role":"user","content":[{"type":"tool_result","content":"boom","is_error":true}]}]"#;
        let t = parse(j);
        assert_eq!(t.events.len(), 4);
        assert_eq!(t.events[2].kind, Kind::Call);
        assert!(t.events[3].error);
    }

    #[test]
    fn parses_openai_tool_calls() {
        let j = r#"{"task":"x","messages":[{"role":"assistant","content":null,"tool_calls":[{"function":{"name":"bash","arguments":"{\"cmd\":\"ls\"}"}}]},{"role":"tool","content":"a b"}]}"#;
        let t = parse(j);
        assert_eq!(t.task.as_deref(), Some("x"));
        assert_eq!(t.events[0].kind, Kind::Call);
        assert_eq!(t.events[1].kind, Kind::Result);
    }

    #[test]
    fn unprefixed_text_is_assistant() {
        let t = parse("I'm so sorry about that.");
        assert_eq!(t.events.len(), 1);
        assert_eq!(t.events[0].kind, Kind::Assistant);
    }
}
