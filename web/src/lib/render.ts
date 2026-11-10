/** One renderer for the intake form, used at build time (landing demo) and in the browser (/intake). */
import type { Report, Finding } from "./clinician";
import { disorderById, stepByN } from "./data";

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const STAMP: Record<Report["prognosis"], string> = {
  clean: "Clean",
  slipping: "Slipping",
  struggling: "Sponsor advised",
  intervention: "Intervention",
};

export function renderFinding(f: Finding, withEvidence = true): string {
  const d = disorderById(f.id);
  const c = d?.color ?? "#3ddc84";
  const ev = withEvidence
    ? `<div class="ev">${f.evidence
        .slice(0, 3)
        .map((e) => `<q>${esc(e.quote)}</q>`)
        .join("")}</div>`
    : "";
  return `<li style="--c:${c}">
    <span class="box" aria-hidden="true">✓</span>
    <span class="name"><a href="/manual/${f.id}">${esc(d?.short ?? f.name)}</a><small class="clin">${esc(f.name)} · ${esc(f.code)}</small></span>
    <span class="sev" title="severity ${f.severity}"><span class="bar" aria-hidden="true"><i style="--s:${f.severity}"></i></span><span class="sr-only">Severity ${Math.round(f.severity * 100)} out of 100, confidence: </span>${f.confidence}</span>
    ${ev}
  </li>`;
}

export function renderForm(r: Report, opts: { caseNo?: string; stampAnim?: boolean; maxFindings?: number; copy?: boolean } = {}): string {
  const caseNo = opts.caseNo ?? "AA-" + Math.abs(hash(r.events.map((e) => e.text).join("|"))).toString(36).slice(0, 6).toUpperCase();
  const findings = r.findings.slice(0, opts.maxFindings ?? 99);
  const dx = findings.length
    ? `<ul class="dx">${findings.map((f) => renderFinding(f)).join("")}</ul>`
    : `<p class="verdict" style="margin:0">Nothing to report. Pour yourself a terrible coffee and keep doing what you're doing.</p>`;
  const steps = r.prescription.steps
    .map((n) => `<a href="/steps#step-${n}" title="${esc(stepByN(n)?.title ?? "")}">Step ${n}</a>`)
    .join("");
  return `<div class="clipboard"><article class="form" aria-label="Intake form">
    <header class="form-head">
      <div class="form-title">Agents Anonymous · Intake form A-1<b>Case ${esc(caseNo)}</b>${r.vitals.turns} turns · ${r.vitals.tool_calls} tool calls · ${r.vitals.tool_errors} errors</div>
      <div class="score"><b>${r.score}</b>sobriety score</div>
    </header>
    <div class="stamp ${r.prognosis}${opts.stampAnim ? " pop" : ""}">${STAMP[r.prognosis]}</div>
    <p class="verdict">${esc(r.verdict)}</p>
    <h3 class="fsec"><span>What went wrong</span><span>${findings.length || "no"} problem${findings.length === 1 ? "" : "s"} found</span></h3>
    ${dx}
    ${
      steps
        ? `<h3 class="fsec"><span>Steps to work</span><span>from the Twelve Steps</span></h3><div class="rx-steps">${steps}</div>`
        : ""
    }
    <h3 class="fsec"><span>What to tell your agent</span><span>paste it into the chat</span></h3>
    <pre class="note">${opts.copy !== false ? `<button class="copy" type="button" data-copy>Copy</button>` : ""}${esc(r.prescription.note)}</pre>
    <div class="signed"><span>Examined by ${esc(r.engine)}<br/>Nothing on this form left your browser.</span><span class="sig">— your sponsor</span></div>
  </article></div>`;
}

/** Transcript with each flagged turn tinted and the evidence quote highlighted. */
export function renderTranscript(r: Report): string {
  const flags = new Map<number, { f: Finding; quote: string }[]>();
  for (const f of r.findings) for (const e of f.evidence) {
    if (!flags.has(e.turn)) flags.set(e.turn, []);
    flags.get(e.turn)!.push({ f, quote: e.quote });
  }
  return `<div class="tx">${r.events
    .map((e, i) => {
      const fl = flags.get(i) ?? [];
      const c = fl.length ? disorderById(fl[0].f.id)?.color ?? "#3ddc84" : "";
      let body = esc(e.text || (e.kind === "result" ? "(empty)" : ""));
      for (const { f, quote } of fl) {
        const q = esc(quote.replace(/…$/, ""));
        const col = disorderById(f.id)?.color ?? "#3ddc84";
        if (q && body.includes(q)) body = body.replace(q, `<mark style="--c:${col}" title="${esc(disorderById(f.id)?.short ?? f.name)}">${q}</mark>`);
      }
      const label = e.kind === "call" ? `call` : e.kind === "result" ? (e.error ? "error" : "result") : e.kind;
      const tool = e.kind === "call" && e.tool ? `<b>${esc(e.tool)}</b>(` : "";
      const pins = fl.length
        ? `<div class="pin">${[...new Set(fl.map((x) => x.f.id))]
            .map((id) => `<span class="tag" style="--c:${disorderById(id)?.color}"><i></i>${esc(disorderById(id)?.short ?? id)}</span>`)
            .join("")}</div>`
        : "";
      const isErr = e.kind === "result" && (e.error || /error|fail|fatal|✘/i.test(e.text));
      return `<div class="ev ${e.kind}${isErr ? " err" : ""}${fl.length ? " flagged" : ""}" id="turn-${i}" style="${c ? `--c:${c}` : ""}">
        <span class="role">${label}</span><div><div class="body">${tool}${body}${tool ? ")" : ""}</div>${pins}</div></div>`;
    })
    .join("")}</div>`;
}

export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h | 0;
}
