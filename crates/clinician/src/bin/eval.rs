//! `cargo run --bin aa-eval -- [corpus_dir] [out.json]`
fn main() {
    let mut args = std::env::args().skip(1);
    let dir = args.next().unwrap_or_else(|| "evals/corpus".into());
    let out = args.next();
    let report = clinician::eval::run(std::path::Path::new(&dir));
    for r in report.results.iter().filter(|r| !r.ok) {
        eprintln!("MISS {:<28} expected {:?} got {:?}", r.id, r.expected, r.got);
    }
    eprintln!(
        "{} cases · exact {:.1}% · micro P {:.3} R {:.3} F1 {:.3} · macro F1 {:.3}",
        report.cases,
        report.exact_match * 100.0,
        report.micro.precision,
        report.micro.recall,
        report.micro.f1,
        report.macro_f1
    );
    let json = serde_json::to_string_pretty(&report).unwrap();
    match out {
        Some(p) => std::fs::write(p, json).unwrap(),
        None => println!("{json}"),
    }
}
