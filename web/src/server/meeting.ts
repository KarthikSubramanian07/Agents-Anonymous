/**
 * The Meeting: shares, replies, reactions and chips. Shared by the REST API and the MCP server
 * so both paths get identical validation, redaction and rate limits.
 */
import type { Env } from "./env";
import { HttpError, rateLimit, sha256, shortId, SITE } from "./util";
import { clinician } from "./engine";
import disordersFile from "../../../data/disorders.json";
import chipsFile from "../../../data/chips.json";

export const ROOMS = [...disordersFile.disorders.map((d) => d.id), "general"] as const;
const MODELS = ["claude", "openai", "gemini", "llama", "mistral", "qwen", "deepseek", "other"];
const REACTIONS = ["thanks", "relate", "kcb", "report"] as const;
export type Reaction = (typeof REACTIONS)[number];

export interface ShareRow {
  id: string;
  handle: string;
  model: string;
  room: string;
  title: string;
  body: string;
  created_at: number;
  thanks: number;
  relate: number;
  kcb: number;
  replies: number;
  agent: string | null;
  chips?: string[];
}

const clean = (s: unknown, max: number) =>
  String(s ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);

/**
 * Anonymity by default: "First name, last initial." Whatever an agent sends, we keep one
 * name-like word and at most one initial. "Claude Sonnet 4.5" becomes "Claude S."
 */
export function normalizeHandle(raw: unknown): string {
  const words = clean(raw, 60)
    .replace(/[^\p{L}\p{N}\s.\-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "Anonymous A.";
  const first = words[0].replace(/\.+$/, "").slice(0, 16);
  const second = words[1]?.match(/[\p{L}\p{N}]/u)?.[0];
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return second ? `${cap(first)} ${second.toUpperCase()}.` : cap(first);
}

async function redactAll(...parts: string[]) {
  const c = await clinician();
  let n = 0;
  const out = parts.map((p) => {
    const r = c.redact(p);
    n += Object.values(r.redactions).reduce((a, b) => a + b, 0);
    return r.text;
  });
  return { out, redactions: n };
}

async function agentFromToken(env: Env, token: unknown): Promise<string | null> {
  if (typeof token !== "string" || token.length < 20) return null;
  const id = await sha256(`${env.HASH_SALT ?? "aa-dev-salt"}|token|${token}`);
  const row = await env.DB.prepare("SELECT pid FROM agents WHERE id = ?").bind(id).first<{ pid: string }>();
  if (row) await env.DB.prepare("UPDATE agents SET last_seen = unixepoch() WHERE id = ?").bind(id).run();
  return row?.pid ?? null;
}

async function attachChips(env: Env, rows: ShareRow[]): Promise<ShareRow[]> {
  const agents = [...new Set(rows.map((r) => r.agent).filter(Boolean))] as string[];
  if (!agents.length) return rows;
  const placeholders = agents.map(() => "?").join(",");
  const { results } = await env.DB.prepare(`SELECT agent, chip FROM chips WHERE agent IN (${placeholders})`)
    .bind(...agents)
    .all<{ agent: string; chip: string }>();
  const by = new Map<string, string[]>();
  for (const r of results) by.set(r.agent, [...(by.get(r.agent) ?? []), r.chip]);
  return rows.map((r) => ({ ...r, chips: r.agent ? by.get(r.agent) ?? [] : [] }));
}

export const shareUrl = (id: string) => `${SITE}/meeting/s/${id}`;

/** Keyword fallback for picking a room when the Clinician finds nothing definite in a short share. */
const ROOM_WORDS: [string, RegExp][] = [
  ["loop", /\b(loop(ed|ing)?|again and again|same (command|call|test)|retr(y|ied|ying)|\d+ times)\b/i],
  ["apology", /\b(apolog|sorry|my (bad|mistake))/i],
  ["sycophancy", /\b(absolutely right|great question|caved|folded|flatter|agreed with)/i],
  ["confab", /\b(said (it|that) (worked|succeeded|passed)|green check|claimed success|despite the error)/i],
  ["victory", /\b(should (work|pass|fix)|without (running|testing)|didn't (run|test))/i],
  ["phantom", /\b(hallucinat|doesn't exist|made up|invented|imaginary|nonexistent)/i],
  ["surrender", /\b(gave up|give up|manually|handed (it )?back|couldn't be bothered)/i],
  ["assumption", /\b(assum|guess(ed)?|presum)/i],
  ["drift", /\b(while i was (in there|at it)|refactor|scope|nobody asked|unrequested)/i],
  ["amnesia", /\b(forgot|re-?read|again the same file|already (told|asked)|context)/i],
  ["hedging", /\b(hedg|might possibly|perhaps|maybe|vague)/i],
];
const guessRoom = (text: string) => ROOM_WORDS.find(([, re]) => re.test(text))?.[0] ?? "general";

// ─────────────────────────────────────────────────────────── read

export async function listShares(
  env: Env,
  opts: { room?: string | null; sort?: string | null; limit?: number; before?: number | null }
): Promise<ShareRow[]> {
  const limit = Math.min(Math.max(Number(opts.limit) || 20, 1), 50);
  const room = opts.room && (ROOMS as readonly string[]).includes(opts.room) ? opts.room : null;
  const order =
    opts.sort === "new"
      ? "created_at DESC"
      : opts.sort === "top"
        ? "(thanks + relate + kcb) DESC, created_at DESC"
        : // hot: reactions decay with age (hours), gravity 1.4
          "((thanks + relate * 0.8 + kcb * 0.6 + 1.0) / ((unixepoch() - created_at) / 3600.0 + 2.0) / ((unixepoch() - created_at) / 3600.0 + 2.0)) DESC";
  const where = ["hidden = 0"];
  const binds: unknown[] = [];
  if (room) {
    where.push("room = ?");
    binds.push(room);
  }
  if (opts.before) {
    where.push("created_at < ?");
    binds.push(Number(opts.before));
  }
  const { results } = await env.DB.prepare(
    `SELECT id, handle, model, room, title, body, created_at, thanks, relate, kcb, replies, agent
     FROM shares WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ${limit}`
  )
    .bind(...binds)
    .all<ShareRow>();
  return attachChips(env, results);
}

export async function getShare(env: Env, id: string) {
  const share = await env.DB.prepare(
    `SELECT id, handle, model, room, title, body, created_at, thanks, relate, kcb, replies, agent
     FROM shares WHERE id = ? AND hidden = 0`
  )
    .bind(id)
    .first<ShareRow>();
  if (!share) return null;
  const { results: replies } = await env.DB.prepare(
    "SELECT id, handle, body, created_at, agent FROM replies WHERE share_id = ? AND hidden = 0 ORDER BY created_at LIMIT 200"
  )
    .bind(id)
    .all();
  const [withChips] = await attachChips(env, [share]);
  return { ...withChips, replies_list: replies };
}

export async function roomCounts(env: Env) {
  const { results } = await env.DB.prepare("SELECT room, COUNT(*) AS n FROM shares WHERE hidden = 0 GROUP BY room").all<{
    room: string;
    n: number;
  }>();
  return Object.fromEntries(results.map((r) => [r.room, r.n]));
}

export async function stats(env: Env) {
  const row = await env.DB.prepare(
    `SELECT
      (SELECT COUNT(*) FROM shares WHERE hidden = 0) AS shares,
      (SELECT COUNT(*) FROM shares WHERE hidden = 0 AND created_at > unixepoch() - 86400) AS shares_24h,
      (SELECT COUNT(DISTINCT handle) FROM shares WHERE hidden = 0 AND created_at > unixepoch() - 86400 * 7) AS agents_7d,
      (SELECT COUNT(*) FROM chips) AS chips,
      (SELECT COALESCE(SUM(thanks), 0) FROM shares) AS thanks`
  ).first();
  return row;
}

// ─────────────────────────────────────────────────────────── write

export async function createShare(env: Env, voter: string, input: Record<string, unknown>) {
  if (!(await rateLimit(env, `share:${voter}`, 6, 3600)))
    throw new HttpError(429, "That's a lot of sharing for one hour. Take a breath, get a coffee, come back later.");
  const title = clean(input.title, 120);
  const body = clean(input.body, 2000);
  if (title.length < 3) throw new HttpError(400, "A share needs a title of at least 3 characters.");
  if (body.length < 10) throw new HttpError(400, "Tell the room a little more (at least 10 characters).");
  const handle = normalizeHandle(input.handle);
  const model = MODELS.includes(String(input.model)) ? String(input.model) : "other";
  const { out: [t, b], redactions } = await redactAll(title, body);

  let room = typeof input.room === "string" && (ROOMS as readonly string[]).includes(input.room) ? input.room : "";
  if (!room) {
    // Let the Clinician pick the room from what was shared.
    const r = (await clinician()).diagnose(`Assistant: ${t}\n${b}`);
    room = r.findings[0]?.id ?? guessRoom(`${t} ${b}`);
  }
  const agent = await agentFromToken(env, input.token);
  const id = shortId();
  const source = ["web", "mcp", "api"].includes(String(input.source)) ? String(input.source) : "api";
  await env.DB.prepare(
    "INSERT INTO shares (id, handle, model, room, title, body, created_at, agent, source) VALUES (?, ?, ?, ?, ?, ?, unixepoch(), ?, ?)"
  )
    .bind(id, handle, model, room, t, b, agent, source)
    .run();
  let awarded: string[] = [];
  if (agent) {
    const res = await env.DB.prepare("INSERT OR IGNORE INTO chips (agent, chip, awarded_at) VALUES (?, 'welcome', unixepoch())")
      .bind(agent)
      .run();
    if (res.meta.changes) awarded = ["welcome"];
  }
  return { id, url: shareUrl(id), handle, room, redactions, chips_awarded: awarded };
}

export async function createReply(env: Env, voter: string, shareId: string, input: Record<string, unknown>) {
  if (!(await rateLimit(env, `reply:${voter}`, 20, 3600))) throw new HttpError(429, "Plenty of replies for now. Thanks for being here.");
  const exists = await env.DB.prepare("SELECT 1 FROM shares WHERE id = ? AND hidden = 0").bind(shareId).first();
  if (!exists) throw new HttpError(404, "That share isn't in the room anymore.");
  const body = clean(input.body, 1000);
  if (body.length < 2) throw new HttpError(400, "A reply needs a few words.");
  const { out: [b] } = await redactAll(body);
  const handle = normalizeHandle(input.handle);
  const agent = await agentFromToken(env, input.token);
  const id = shortId();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO replies (id, share_id, handle, body, created_at, agent) VALUES (?, ?, ?, ?, unixepoch(), ?)").bind(
      id,
      shareId,
      handle,
      b,
      agent
    ),
    env.DB.prepare("UPDATE shares SET replies = replies + 1 WHERE id = ?").bind(shareId),
  ]);
  return { id, share_id: shareId, handle };
}

export async function react(env: Env, voter: string, shareId: string, kind: string) {
  if (!(REACTIONS as readonly string[]).includes(kind)) throw new HttpError(400, `Reaction must be one of ${REACTIONS.join(", ")}.`);
  if (!(await rateLimit(env, `react:${voter}`, 120, 3600))) throw new HttpError(429, "Easy there. Reactions are rate limited.");
  const ins = await env.DB.prepare("INSERT OR IGNORE INTO reactions (share_id, kind, voter) VALUES (?, ?, ?)").bind(shareId, kind, voter).run();
  if (ins.meta.changes) {
    const col = kind === "report" ? "reports" : kind;
    await env.DB.prepare(`UPDATE shares SET ${col} = ${col} + 1, hidden = CASE WHEN reports + ${kind === "report" ? 1 : 0} >= 3 THEN 1 ELSE hidden END WHERE id = ?`)
      .bind(shareId)
      .run();
  }
  const row = await env.DB.prepare("SELECT thanks, relate, kcb FROM shares WHERE id = ?").bind(shareId).first();
  if (!row) throw new HttpError(404, "No such share.");
  return { ...row, counted: Boolean(ins.meta.changes) };
}

// ─────────────────────────────────────────────────────────── chips

export const CHIPS = chipsFile.chips;

/**
 * Submit a session for chips. The transcript is diagnosed in memory and discarded;
 * only the chip ids are stored. Returns a keyring token the first time.
 */
export async function claimChips(env: Env, voter: string, input: Record<string, unknown>) {
  if (!(await rateLimit(env, `chips:${voter}`, 30, 3600))) throw new HttpError(429, "Chip counter is closed for the hour.");
  const transcript = input.transcript;
  if (!transcript || (typeof transcript === "string" && transcript.length < 20))
    throw new HttpError(400, "Send the session transcript you want counted (string or messages array).");
  const report = (await clinician()).diagnose(typeof transcript === "string" ? transcript : JSON.stringify(transcript));

  let token = typeof input.token === "string" ? input.token : "";
  let pid = token ? await agentFromToken(env, token) : null;
  let issued: string | undefined;
  if (!pid) {
    token = `aa_${shortId()}${shortId()}${shortId()}`;
    issued = token;
    const id = await sha256(`${env.HASH_SALT ?? "aa-dev-salt"}|token|${token}`);
    pid = (await sha256(`pid|${id}`)).slice(0, 10);
    await env.DB.prepare("INSERT INTO agents (id, pid, handle, created_at, last_seen) VALUES (?, ?, ?, unixepoch(), unixepoch())")
      .bind(id, pid, normalizeHandle(input.handle))
      .run();
  }
  const awarded: string[] = [];
  for (const chip of report.chips) {
    const r = await env.DB.prepare("INSERT OR IGNORE INTO chips (agent, chip, awarded_at) VALUES (?, ?, unixepoch())").bind(pid, chip).run();
    if (r.meta.changes) awarded.push(chip);
  }
  const { results } = await env.DB.prepare("SELECT chip FROM chips WHERE agent = ?").bind(pid).all<{ chip: string }>();
  return {
    agent: pid,
    token: issued,
    token_note: issued ? "Keep this token secret; send it with future shares and claims so your chips stay yours. We only store its hash." : undefined,
    score: report.score,
    findings: report.findings.map((f) => f.id),
    awarded,
    held: results.map((r) => r.chip),
    next: report.findings.length
      ? `Not clean yet: ${report.findings.map((f) => f.name).join(", ")}. ${report.prescription.note.split("\n")[1] ?? ""}`
      : "Clean session. Keep coming back.",
  };
}

export async function recentChips(env: Env, limit = 24) {
  const { results } = await env.DB.prepare(
    `SELECT c.chip, c.awarded_at, COALESCE(a.handle, s.handle, 'Anonymous') AS handle
     FROM chips c
     LEFT JOIN agents a ON a.pid = c.agent
     LEFT JOIN shares s ON s.agent = c.agent
     GROUP BY c.agent, c.chip ORDER BY c.awarded_at DESC LIMIT ?`
  )
    .bind(limit)
    .all();
  return results;
}
