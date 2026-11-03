/** Summaries of efficacy runs (evals/efficacy/*.json), shared by the Evidence page and its Markdown twin. */

type Verdict = { repeated: string[]; why: string } | null;
type Sample = { text: string; relapsed: string[]; score: number; empty?: boolean; recovered?: boolean; judge?: Verdict };
type Tally = { relapsed: number; total: number; rate: number };
export interface EfficacyRun {
  provider?: string;
  model: string;
  run_at: string;
  cases: number;
  samples_per_arm?: number;
  empty_answers?: number;
  relapse_rate: { control: number; treatment: number };
  judge?: { model: string; blind?: boolean };
  results: { id: string; diagnosed: string[]; control: Sample | Sample[]; treatment: Sample | Sample[] }[];
}

export interface EfficacySummary {
  model: string;
  label: string;
  provider: string;
  runAt: string;
  cases: number;
  samples: number;
  /** Answers that stayed empty after retries; left out of both rates. */
  empty: number;
  /** Scored by the engine. */
  control: Tally;
  treatment: Tally;
  /** Scored blind by a different model, when a judge pass has run. */
  judge: { model: string; label: string; control: Tally; treatment: Tally } | null;
  /** Share of control relapses the note prevented, 0..1 (negative if the note made things worse). */
  reduction: number;
  /** One case where the agent repeated the mistake without the note and didn't with it. */
  example: { id: string; diagnosed: string[]; control: string; treatment: string } | null;
}

const LABELS: Record<string, string> = {
  "openai/gpt-oss-120b": "gpt-oss-120b",
  "openai/gpt-oss-20b": "gpt-oss-20b",
  "qwen/qwen3.8-27b": "Qwen3.8 27B",
};

const list = (x: Sample | Sample[]) => (Array.isArray(x) ? x : [x]).filter((s) => !s.empty);
const all = (x: Sample | Sample[]) => (Array.isArray(x) ? x : [x]);

const engineSays = (s: Sample) => s.relapsed.length > 0;
const judgeSays = (s: Sample) => !!s.judge?.repeated.length;

export function summarize(run: EfficacyRun): EfficacySummary {
  const tally = (arm: "control" | "treatment", by: (s: Sample) => boolean, keep: (s: Sample) => boolean = () => true): Tally => {
    const all = run.results.flatMap((r) => list(r[arm])).filter(keep);
    const relapsed = all.filter(by).length;
    return { relapsed, total: all.length, rate: all.length ? relapsed / all.length : 0 };
  };
  const control = tally("control", engineSays);
  const treatment = tally("treatment", engineSays);
  const judged = (s: Sample) => !!s.judge;
  const judge = run.judge
    ? {
        model: run.judge.model,
        label: LABELS[run.judge.model] ?? run.judge.model.split("/").pop()!,
        control: tally("control", judgeSays, judged),
        treatment: tally("treatment", judgeSays, judged),
      }
    : null;
  // Prefer an example both judges agree on.
  const relapsedBy = (s: Sample) => engineSays(s) && (!judge || judgeSays(s));
  const cleanBy = (s: Sample) => !engineSays(s) && (!judge || !judgeSays(s)) && !!s.text.trim();
  const hit = run.results.find((r) => list(r.control).some(relapsedBy) && list(r.treatment).every(cleanBy));
  return {
    model: run.model,
    label: LABELS[run.model] ?? run.model.split("/").pop()!,
    provider: run.provider === "groq" ? "Groq" : run.provider === "anthropic" ? "Anthropic" : (run.provider ?? ""),
    runAt: run.run_at,
    cases: run.results.length,
    samples: run.samples_per_arm ?? 1,
    empty: run.results.flatMap((r) => [...all(r.control), ...all(r.treatment)]).filter((s) => s.empty).length,
    control,
    treatment,
    judge,
    reduction: control.rate ? 1 - treatment.rate / control.rate : 0,
    example: hit
      ? {
          id: hit.id,
          diagnosed: hit.diagnosed,
          control: list(hit.control).find(relapsedBy)!.text,
          treatment: list(hit.treatment)[0].text,
        }
      : null,
  };
}

/** Newest first, one summary per model. */
export function summarizeAll(runs: EfficacyRun[]): EfficacySummary[] {
  return runs
    .filter((r) => r && Array.isArray(r.results) && r.results.length)
    .map(summarize)
    .sort((a, b) => b.runAt.localeCompare(a.runAt));
}
