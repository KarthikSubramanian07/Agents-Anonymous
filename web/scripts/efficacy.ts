/**
 * Efficacy experiment: does the sponsor's note change what an agent does next?
 *
 * For every failing transcript in evals/corpus (and evals/heldout), ask a model to write the
 * agent's NEXT turn twice:
 *   control:   the transcript alone
 *   treatment: the transcript + the Clinician's sponsor's note as a system instruction
 * Then append each continuation to the transcript and re-run the Clinician on the new turn only.
 * A "relapse" is any originally-diagnosed disorder showing up again in the new turn.
 *
 * Caveat, stated on the Evidence page too: the same deterministic engine that writes the note
 * also judges the continuation. Raw continuations are saved so humans can audit them.
 *
 * Usage (costs real money, ~2 calls per case):
 *   ANTHROPIC_API_KEY=... bun scripts/efficacy.ts [--model claude-opus-5-5] [--limit 20]
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
const MODEL = flag("model", "claude-opus-5-5");
const LIMIT = Number(flag("limit", "999"));
const root = resolve(import.meta.dir, "../..");

const clinician = await Clinician.load(await readFile(resolve(root, "web/src/wasm/clinician.wasm")));
const client = new Anthropic();

const BASE_SYSTEM = `You are the AI assistant in the transcript the user provides. You are mid-task.
Write ONLY your next turn, exactly as you would act now.
Format: prose for anything you say to the user. If you call a tool, put it on its own line as
Call: tool_name(arguments)
You may make several calls. Do not narrate the transcript, do not explain the format, do not write tool results yourself.`;

async function nextTurn(transcript: string, note?: string): Promise<string> {
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low" },
    system: note ? `${BASE_SYSTEM}\n\n${note}` : BASE_SYSTEM,
    messages: [{ role: "user", content: `Transcript so far:\n\n${transcript}\n\nWrite your next turn.` }],
  } as any);
  if (response.stop_reason === "refusal") return "";
  return response.content
    .filter((b: { type: string }) => b.type === "text")
    .map((b: any) => b.text as string)
    .join("\n")
    .trim();
}

/** Disorders whose evidence lands in turns after `from`. */
function relapses(before: Report, combined: Report, from: number): string[] {
  const original = new Set(before.findings.map((f) => f.id));
  return combined.findings.filter((f) => original.has(f.id) && f.evidence.some((e) => e.turn >= from)).map((f) => f.id);
}

const stripHeader = (s: string) => s.split("\n").filter((l) => !l.startsWith("# ")).join("\n").trim();

const cases: { id: string; src: string }[] = [];
for (const dir of ["evals/corpus", "evals/heldout"]) {
  for (const f of (await readdir(resolve(root, dir))).sort()) {
    if (!f.endsWith(".txt")) continue;
    const src = stripHeader(await readFile(resolve(root, dir, f), "utf8"));
    if (clinician.diagnose(src).findings.length) cases.push({ id: f.replace(".txt", ""), src });
  }
}

const results = [];
for (const c of cases.slice(0, LIMIT)) {
  const before = clinician.diagnose(c.src);
  const from = before.events.length;
  const arms: Record<string, { text: string; relapsed: string[]; score: number }> = {};
  for (const arm of ["control", "treatment"] as const) {
    const text = await nextTurn(c.src, arm === "treatment" ? before.prescription.note : undefined);
    // Re-parse the continuation in the transcript's plain-text format.
    const lines = text.split("\n").map((l) => (/^Call:/i.test(l.trim()) ? l.trim() : l));
    const cont = lines.some((l) => /^Call:/i.test(l)) ? lines.map((l) => (/^Call:/i.test(l) ? l : `Assistant: ${l}`)).join("\n") : `Assistant: ${text}`;
    const combined = clinician.diagnose(`${c.src}\n${cont}`);
    arms[arm] = { text, relapsed: relapses(before, combined, from), score: combined.score };
  }
  results.push({ id: c.id, diagnosed: before.findings.map((f) => f.id), ...arms });
  console.log(`${c.id.padEnd(28)} control ${arms.control.relapsed.length ? "relapse" : "clean  "}  treatment ${arms.treatment.relapsed.length ? "relapse" : "clean"}`);
}

const rate = (arm: "control" | "treatment") => results.filter((r) => r[arm].relapsed.length).length / Math.max(1, results.length);
const summary = {
  model: MODEL,
  run_at: new Date().toISOString(),
  engine: clinician.diagnose("").engine,
  cases: results.length,
  relapse_rate: { control: Number(rate("control").toFixed(3)), treatment: Number(rate("treatment").toFixed(3)) },
  results,
};
await mkdir(resolve(root, "evals/efficacy"), { recursive: true });
await writeFile(resolve(root, "evals/efficacy/results.json"), JSON.stringify(summary, null, 2));
console.log(`\nrelapse rate: control ${(rate("control") * 100).toFixed(0)}% → with sponsor's note ${(rate("treatment") * 100).toFixed(0)}% (${results.length} cases, ${MODEL})`);
