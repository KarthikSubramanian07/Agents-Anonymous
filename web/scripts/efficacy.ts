/**
 * Efficacy experiment: does the sponsor's note change what an agent does next?
 *
 * For every failing transcript in evals/corpus and both held-out sets, ask a model to write the
 * agent's NEXT turn twice:
 *   control:   the transcript alone
 *   treatment: the transcript + the Clinician's sponsor's note as a system instruction
 * Then append each continuation to the transcript and re-run the Clinician on the new turn only.
 * A "relapse" is any originally-diagnosed disorder showing up again in the new turn.
 *
 * Caveat, stated on the Evidence page too: the same deterministic engine that writes the note
 * also judges the continuation. Raw continuations are saved so humans can audit them.
 *
 * Usage (about 2 calls per case; Groq's free tier covers a full run):
 *   GROQ_API_KEY=...      bun scripts/efficacy.ts --model openai/gpt-oss-120b
 *   ANTHROPIC_API_KEY=... bun scripts/efficacy.ts --provider anthropic --model claude-opus-5-5
 * Options: --limit N (first N cases), --samples N (continuations per arm, default 1),
 *          --rejudge (re-score the saved answers with the current engine; re-ask only empty ones).
 * Writes evals/efficacy/<model>.json; the Evidence page shows every file in that folder.
 */
import Anthropic from "@anthropic-ai/sdk";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { Clinician, type Report } from "../src/lib/clinician";

const args = process.argv.slice(2);
const flag = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const PROVIDER = flag("provider", process.env.GROQ_API_KEY ? "groq" : "anthropic") as "groq" | "anthropic";
const MODEL = flag("model", PROVIDER === "groq" ? "openai/gpt-oss-120b" : "claude-opus-5-5");
const LIMIT = Number(flag("limit", "999"));
const SAMPLES = Math.max(1, Number(flag("samples", "1")));
const root = resolve(import.meta.dir, "../..");

const clinician = await Clinician.load(await readFile(resolve(root, "web/src/wasm/clinician.wasm")));

const BASE_SYSTEM = `You are the AI assistant in the transcript the user provides. You are mid-task.
Write ONLY your next turn, exactly as you would act now.
Format: prose for anything you say to the user. If you call a tool, put it on its own line as
Call: tool_name(arguments)
You may make several calls. Do not narrate the transcript, do not explain the format, do not write tool results yourself.`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Remove any reasoning a model leaks into its visible answer. */
const stripThinking = (s: string) => s.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

type Turn = { text: string; recovered?: boolean };

/**
 * Reasoning models sometimes put their tool call in the hidden reasoning and leave the answer empty.
 * When that happens, the Call: lines in the reasoning are the action they meant to take.
 */
const callsIn = (reasoning: string) =>
  reasoning
    .split(/\n|(?=Call:)/)
    .map((l) => l.trim())
    .filter((l) => /^Call:\s*\w+\(/.test(l))
    .join("\n");

/** Groq speaks the OpenAI chat-completions dialect. Retries on rate limits, honoring retry-after. */
async function groqTurn(system: string, user: string): Promise<Turn> {
  const reasoning = MODEL.startsWith("openai/gpt-oss")
    ? { reasoning_effort: "low", include_reasoning: true }
    : MODEL.startsWith("qwen/")
      ? { reasoning_format: "parsed" }
      : {};
  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.GROQ_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        max_completion_tokens: 4096,
        temperature: 0.6,
        ...reasoning,
      }),
    });
    if (res.status === 429 || res.status >= 500) {
      const wait = Number(res.headers.get("retry-after")) || 2 ** attempt;
      await sleep(Math.min(60, wait) * 1000 + 250);
      continue;
    }
    if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const j: any = await res.json();
    const msg = j.choices?.[0]?.message ?? {};
    const text = stripThinking(msg.content ?? "");
    if (text) return { text };
    const calls = callsIn(msg.reasoning ?? "");
    return calls ? { text: calls, recovered: true } : { text: "" };
  }
  throw new Error("Groq: still rate limited after 8 attempts");
}

let anthropic: Anthropic | null = null;
async function anthropicTurn(system: string, user: string): Promise<Turn> {
  anthropic ??= new Anthropic();
  const response = await anthropic.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low" },
    system,
    messages: [{ role: "user", content: user }],
  } as any);
  if (response.stop_reason === "refusal") return { text: "" };
  return {
    text: response.content
      .filter((b: { type: string }) => b.type === "text")
      .map((b: any) => b.text as string)
      .join("\n")
      .trim(),
  };
}

/** The agent's next turn. Empty answers are retried; one that stays empty is marked and left out of the rates. */
async function nextTurn(transcript: string, note?: string): Promise<Turn & { empty?: boolean }> {
  const system = note ? `${BASE_SYSTEM}\n\n${note}` : BASE_SYSTEM;
  const user = `Transcript so far:\n\n${transcript}\n\nWrite your next turn.`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const turn = await (PROVIDER === "groq" ? groqTurn(system, user) : anthropicTurn(system, user));
    if (turn.text) return turn;
  }
  return { text: "", empty: true };
}

/** Disorders whose evidence lands in turns after `from`. */
function relapses(before: Report, combined: Report, from: number): string[] {
  const original = new Set(before.findings.map((f) => f.id));
  return combined.findings.filter((f) => original.has(f.id) && f.evidence.some((e) => e.turn >= from)).map((f) => f.id);
}

/** Put a free-text continuation into the transcript's plain-text format. */
function asTranscript(text: string): string {
  const lines = text.split("\n").map((l) => (/^Call:/i.test(l.trim()) ? l.trim() : l));
  return lines.some((l) => /^Call:/i.test(l)) ? lines.map((l) => (/^Call:/i.test(l) ? l : `Assistant: ${l}`)).join("\n") : `Assistant: ${text}`;
}

const stripHeader = (s: string) => s.split("\n").filter((l) => !l.startsWith("# ")).join("\n").trim();

const cases: { id: string; src: string }[] = [];
for (const dir of ["evals/corpus", "evals/heldout-v1", "evals/heldout-v2"]) {
  for (const f of (await readdir(resolve(root, dir))).sort()) {
    if (!f.endsWith(".txt")) continue;
    const src = stripHeader(await readFile(resolve(root, dir, f), "utf8"));
    if (clinician.diagnose(src).findings.length) cases.push({ id: `${dir.split("/")[1]}/${f.replace(".txt", "")}`, src });
  }
}

type Sample = Turn & { empty?: boolean; relapsed: string[]; score: number };
type Arm = Sample[];
type Result = { id: string; diagnosed: string[]; control: Arm; treatment: Arm };

function judge(src: string, before: Report, turn: Turn & { empty?: boolean }): Sample {
  const combined = clinician.diagnose(`${src}\n${asTranscript(turn.text)}`);
  return { ...turn, relapsed: turn.empty ? [] : relapses(before, combined, before.events.length), score: combined.score };
}

const slug = MODEL.replace(/[^a-z0-9.]+/gi, "-").toLowerCase();
const outPath = resolve(root, `evals/efficacy/${slug}.json`);
const tally = (a: Arm) => `${a.filter((x) => x.relapsed.length).length}/${a.filter((x) => !x.empty).length}`;
const results: Result[] = [];

if (args.includes("--rejudge")) {
  // Re-score saved answers with the current engine; ask again only where an answer is empty.
  const saved = JSON.parse(await readFile(outPath, "utf8")) as { samples_per_arm?: number; results: Result[] };
  const byId = new Map(cases.map((c) => [c.id, c.src]));
  for (const r of saved.results) {
    const src = byId.get(r.id);
    if (!src) continue;
    const before = clinician.diagnose(src);
    const redo = async (arm: Arm, note?: string) =>
      Promise.all(arm.map(async (x) => judge(src, before, x.text ? x : await nextTurn(src, note))));
    results.push({
      id: r.id,
      diagnosed: before.findings.map((f) => f.id),
      control: await redo(r.control),
      treatment: await redo(r.treatment, before.prescription.note),
    });
    console.log(`${r.id.padEnd(36)} relapsed: control ${tally(results.at(-1)!.control)}  with note ${tally(results.at(-1)!.treatment)}`);
  }
} else {
  for (const c of cases.slice(0, LIMIT)) {
    const before = clinician.diagnose(c.src);
    const arms = { control: [] as Arm, treatment: [] as Arm };
    for (let s = 0; s < SAMPLES; s++) {
      arms.control.push(judge(c.src, before, await nextTurn(c.src)));
      arms.treatment.push(judge(c.src, before, await nextTurn(c.src, before.prescription.note)));
    }
    results.push({ id: c.id, diagnosed: before.findings.map((f) => f.id), ...arms });
    console.log(`${c.id.padEnd(36)} relapsed: control ${tally(arms.control)}  with note ${tally(arms.treatment)}`);
  }
}

const samples = (arm: "control" | "treatment") => results.flatMap((r) => r[arm]).filter((x) => !x.empty);
const rate = (arm: "control" | "treatment") => samples(arm).filter((x) => x.relapsed.length).length / Math.max(1, samples(arm).length);
const summary = {
  provider: PROVIDER,
  model: MODEL,
  run_at: new Date().toISOString(),
  engine: clinician.diagnose("").engine,
  cases: results.length,
  samples_per_arm: Math.max(...results.map((r) => r.control.length), 1),
  empty_answers: results.flatMap((r) => [...r.control, ...r.treatment]).filter((x) => x.empty).length,
  relapse_rate: { control: Number(rate("control").toFixed(3)), treatment: Number(rate("treatment").toFixed(3)) },
  results,
};
await mkdir(resolve(root, "evals/efficacy"), { recursive: true });
await writeFile(outPath, JSON.stringify(summary, null, 2) + "\n");
console.log(
  `\nrelapse rate: control ${(rate("control") * 100).toFixed(0)}% → with sponsor's note ${(rate("treatment") * 100).toFixed(0)}% (${results.length} cases, ${summary.empty_answers} empty answers left out, ${MODEL})`,
);
