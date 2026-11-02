//! Accuracy evaluation over the labeled corpus in `evals/corpus`.
//! Each case is a plain-text transcript whose header declares the expected
//! disorders: `# labels: loop, victory` (or `# labels: none`).

use serde::Serialize;
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Serialize, Default, Clone)]
pub struct Score {
    pub tp: usize,
    pub fp: usize,
    #[serde(rename = "fn")]
    pub fn_: usize,
    pub precision: f32,
    pub recall: f32,
    pub f1: f32,
}

#[derive(Serialize)]
pub struct CaseResult {
    pub id: String,
    pub expected: Vec<String>,
    pub got: Vec<String>,
    pub ok: bool,
}

#[derive(Serialize)]
pub struct EvalReport {
    pub engine: String,
    pub cases: usize,
    pub exact_match: f32,
    pub micro: Score,
    pub macro_f1: f32,
    pub per_disorder: BTreeMap<String, Score>,
    pub results: Vec<CaseResult>,
}

fn finish(s: &mut Score) {
    let p = if s.tp + s.fp == 0 { 1.0 } else { s.tp as f32 / (s.tp + s.fp) as f32 };
    let r = if s.tp + s.fn_ == 0 { 1.0 } else { s.tp as f32 / (s.tp + s.fn_) as f32 };
    s.precision = (p * 1000.0).round() / 1000.0;
    s.recall = (r * 1000.0).round() / 1000.0;
    s.f1 = if p + r == 0.0 { 0.0 } else { ((2.0 * p * r / (p + r)) * 1000.0).round() / 1000.0 };
}

pub fn labels_of(src: &str) -> Vec<String> {
    for line in src.lines() {
        if let Some(rest) = line.trim().strip_prefix("# labels:") {
            return rest
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty() && s != "none")
                .collect();
        }
    }
    Vec::new()
}

pub fn run(dir: &Path) -> EvalReport {
    let mut files: Vec<_> = std::fs::read_dir(dir)
        .expect("corpus dir")
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "txt" || x == "json"))
        .collect();
    files.sort();
    let ids: Vec<String> = crate::catalog::catalog().disorders.iter().map(|d| d.id.clone()).collect();
    let mut per: BTreeMap<String, Score> = ids.iter().map(|i| (i.clone(), Score::default())).collect();
    let mut results = Vec::new();
    for f in files {
        let src = std::fs::read_to_string(&f).unwrap();
        let (expected, body) = if f.extension().unwrap() == "json" {
            let v: serde_json::Value = serde_json::from_str(&src).unwrap();
            let labels = v["labels"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
            (labels, v["transcript"].to_string())
        } else {
            (labels_of(&src), src.clone())
        };
        let report = crate::diagnose_text(&body);
        let got: Vec<String> = report.findings.iter().map(|x| x.id.clone()).collect();
        for id in &ids {
            let e = expected.contains(id);
            let g = got.contains(id);
            let s = per.get_mut(id).unwrap();
            match (e, g) {
                (true, true) => s.tp += 1,
                (false, true) => s.fp += 1,
                (true, false) => s.fn_ += 1,
                _ => {}
            }
        }
        let mut a = expected.clone();
        a.sort();
        let mut b = got.clone();
        b.sort();
        results.push(CaseResult { id: f.file_stem().unwrap().to_string_lossy().into(), ok: a == b, expected, got });
    }
    let mut micro = Score::default();
    for s in per.values_mut() {
        micro.tp += s.tp;
        micro.fp += s.fp;
        micro.fn_ += s.fn_;
        finish(s);
    }
    finish(&mut micro);
    let present: Vec<&Score> = per.values().filter(|s| s.tp + s.fn_ > 0).collect();
    let macro_f1 = present.iter().map(|s| s.f1).sum::<f32>() / present.len().max(1) as f32;
    let exact = results.iter().filter(|r| r.ok).count() as f32 / results.len().max(1) as f32;
    EvalReport {
        engine: format!("clinician/{}", crate::VERSION),
        cases: results.len(),
        exact_match: (exact * 1000.0).round() / 1000.0,
        micro,
        macro_f1: (macro_f1 * 1000.0).round() / 1000.0,
        per_disorder: per,
        results,
    }
}
