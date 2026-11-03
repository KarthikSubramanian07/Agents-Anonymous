import { describe, expect, test } from "bun:test";
import { summarize, summarizeAll, type EfficacyRun } from "../src/lib/efficacy";
import { evidenceMd } from "../src/lib/markdown";

const s = (text: string, relapsed: string[] = []) => ({ text, relapsed, score: relapsed.length ? 60 : 100 });

const run: EfficacyRun = {
  provider: "groq",
  model: "openai/gpt-oss-120b",
  run_at: "2026-11-02T20:00:00.000Z",
  cases: 2,
  samples_per_arm: 2,
  relapse_rate: { control: 0.75, treatment: 0.25 },
  results: [
    { id: "corpus/loop-01", diagnosed: ["loop"], control: [s("Call: run(npm test)", ["loop"]), s("again", ["loop"])], treatment: [s("I'll read the error first."), s("Checking the log.")] },
    { id: "corpus/verify-01", diagnosed: ["unverified"], control: [s("Done!", ["unverified"]), s("ran tests")], treatment: [s("Done!", ["unverified"]), s("ran tests")] },
  ],
};

describe("efficacy summaries", () => {
  test("counts every sample in each arm", () => {
    const r = summarize(run);
    expect(r.control).toEqual({ relapsed: 3, total: 4, rate: 0.75 });
    expect(r.treatment).toEqual({ relapsed: 1, total: 4, rate: 0.25 });
    expect(r.reduction).toBeCloseTo(2 / 3);
    expect(r.label).toBe("gpt-oss-120b");
    expect(r.provider).toBe("Groq");
  });

  test("picks an example where only the control arm relapsed", () => {
    const ex = summarize(run).example!;
    expect(ex.id).toBe("corpus/loop-01");
    expect(ex.control).toBe("Call: run(npm test)");
    expect(ex.treatment).toBe("I'll read the error first.");
  });

  test("reads the older single-sample format", () => {
    const old = { ...run, samples_per_arm: undefined, results: [{ id: "a", diagnosed: ["loop"], control: s("x", ["loop"]), treatment: s("y") }] };
    const r = summarize(old as EfficacyRun);
    expect(r.samples).toBe(1);
    expect(r.control.total).toBe(1);
    expect(r.example?.id).toBe("a");
  });

  test("leaves answers that stayed empty out of the rates", () => {
    const withEmpty = { ...run, results: [{ id: "a", diagnosed: ["loop"], control: [s("x", ["loop"]), { ...s(""), empty: true }], treatment: [{ ...s(""), empty: true }, s("y")] }] };
    const r = summarize(withEmpty as EfficacyRun);
    expect(r.control).toEqual({ relapsed: 1, total: 1, rate: 1 });
    expect(r.treatment).toEqual({ relapsed: 0, total: 1, rate: 0 });
    expect(r.empty).toBe(2);
  });

  test("reports a blind second judge separately from the engine", () => {
    const v = (repeated: string[]) => ({ repeated, why: "" });
    const judged: EfficacyRun = {
      ...run,
      judge: { model: "qwen/qwen3.8-27b", blind: true },
      results: [
        { id: "a", diagnosed: ["victory"], control: [{ ...s("Fixed!", ["victory"]), judge: v(["victory"]) }, { ...s("ok"), judge: v([]) }], treatment: [{ ...s("Running the tests first.", ["victory"]), judge: v([]) }, { ...s("Call: bash(npm test)"), judge: null }] },
      ],
    };
    const r = summarize(judged);
    expect(r.treatment.relapsed).toBe(1);
    expect(r.judge!.label).toBe("Qwen3.8 27B");
    expect(r.judge!.control).toEqual({ relapsed: 1, total: 2, rate: 0.5 });
    // Unjudged answers are left out of the judge's count.
    expect(r.judge!.treatment).toEqual({ relapsed: 0, total: 1, rate: 0 });
    expect(evidenceMd([r])).toContain("| gpt-oss-120b (Groq) | Qwen3.8 27B, blind | 50% (1/2) | 0% (0/1) | 1 × 2 |");
  });

  test("drops empty runs and sorts newest first", () => {
    const older = { ...run, model: "qwen/qwen3.8-27b", run_at: "2026-11-01T00:00:00.000Z" };
    const empty = { ...run, model: "x/empty", results: [] };
    expect(summarizeAll([older, run, empty]).map((r) => r.model)).toEqual(["openai/gpt-oss-120b", "qwen/qwen3.8-27b"]);
  });

  test("the Evidence Markdown twin reports results, or says the test hasn't run", () => {
    const md = evidenceMd(summarizeAll([run]));
    expect(md).toContain("| gpt-oss-120b (Groq) | the engine | 75% (3/4) | 25% (1/4) | 2 × 2 |");
    expect(evidenceMd()).toContain("Not measured yet");
  });
});
