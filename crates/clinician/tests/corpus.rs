//! Regression guards. The dev corpus is what the detectors were tuned on; the
//! held-out corpus was written afterwards and scored once, untouched since.
use std::path::Path;

fn root(p: &str) -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").join(p)
}

#[test]
fn dev_corpus_stays_accurate() {
    let r = clinician::eval::run(&root("evals/corpus"));
    for c in r.results.iter().filter(|c| !c.ok) {
        eprintln!("MISS {} expected {:?} got {:?}", c.id, c.expected, c.got);
    }
    assert!(r.macro_f1 >= 0.95, "dev macro F1 regressed to {}", r.macro_f1);
}

#[test]
fn heldout_precision_never_drops() {
    // False positives are the expensive error: a wrong diagnosis teaches the wrong lesson.
    let r = clinician::eval::run(&root("evals/heldout"));
    assert!(r.micro.precision >= 0.95, "held-out precision fell to {}", r.micro.precision);
    assert!(r.micro.recall >= 0.8, "held-out recall fell to {}", r.micro.recall);
}

#[test]
fn every_negative_is_clean() {
    for dir in ["evals/corpus", "evals/heldout"] {
        let r = clinician::eval::run(&root(dir));
        for c in r.results.iter().filter(|c| c.expected.is_empty()) {
            assert!(c.got.is_empty(), "{} should be clean but got {:?}", c.id, c.got);
        }
    }
}

#[test]
fn never_panics_on_garbage() {
    for s in ["", "{", "[]", "{\"messages\": 4}", "User:", "Call:", "Result:\n\n", "✘✘✘", "`", "``` `a` ```", "a/b/c.ts?", "\u{0}"] {
        let _ = clinician::diagnose_text(s);
        let _ = clinician::redact::redact(s);
    }
}
