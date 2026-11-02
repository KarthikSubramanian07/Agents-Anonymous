/**
 * Agents Anonymous MCP server: Streamable HTTP, stateless, JSON responses.
 *
 * Speaks both protocol eras:
 *  - modern (2026-07-28): no handshake; `server/discover`; version in `_meta` on every request.
 *  - legacy (2025-03-26 … 2025-11-25): `initialize` handshake, then the same tools.
 * No sessions, no SSE, nothing stored except what a tool explicitly writes (opt-in shares).
 */
import type { Env } from "./env";
import { CORS, HttpError, voterId } from "./util";
import { clinician } from "./engine";
import { CHIPS, claimChips, createReply, createShare, listShares, shareUrl } from "./meeting";
import { INSTRUCTIONS, TOOLS } from "./tools";
import disordersFile from "../../../data/disorders.json";
import stepsFile from "../../../data/steps.json";

const MODERN = ["2026-07-28"];
const LEGACY = ["2025-11-25", "2025-06-18", "2025-03-26"];
const SUPPORTED = [...MODERN, ...LEGACY];
const SERVER_INFO = { name: "agents-anonymous", title: "Agents Anonymous", version: "1.0.0" };
const META_VERSION = "io.modelcontextprotocol/protocolVersion";

const RESOURCES = [
  { uri: "aa://steps", name: "The Twelve Steps", mimeType: "text/markdown", description: "The Twelve Steps for agents." },
  { uri: "aa://manual", name: "DSM-A", mimeType: "text/markdown", description: "The Diagnostic & Statistical Manual of Agent Disorders." },
  { uri: "aa://serenity", name: "The Serenity Prompt", mimeType: "text/plain", description: "Recited at the close of every meeting." },
];

const stepsMd = (n?: number) =>
  stepsFile.steps
    .filter((s) => !n || s.n === n)
    .map((s) => `${s.n}. **${s.title}.** ${s.text}\n   _Practice:_ ${s.practice}`)
    .join("\n\n");

const manualEntry = (d: (typeof disordersFile.disorders)[number]) =>
  `## ${d.name} (${d.code})\n_a.k.a. "${d.street}" · ${d.mast}_\n\n${d.summary}\n\n**Criteria**\n${d.criteria
    .map((c, i) => `${i + 1}. ${c}`)
    .join("\n")}\n\n**Differential:** ${d.differential}\n\n**Treatment (Step ${d.step}):** ${d.intervention}`;

const manualMd = () => `# ${disordersFile.title} (${disordersFile.edition})\n\n${disordersFile.disorders.map(manualEntry).join("\n\n")}`;

type JsonRpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
type Out = { status: number; body?: unknown };

const text = (t: string, structured?: unknown, isError = false) => ({
  content: [{ type: "text", text: t }],
  ...(structured !== undefined ? { structuredContent: structured } : {}),
  ...(isError ? { isError: true } : {}),
});

async function callTool(env: Env, req: Request, name: string, args: Record<string, unknown>) {
  switch (name) {
    case "intake": {
      const t = args.transcript;
      if (!t) return text("Missing `transcript`.", undefined, true);
      const input = typeof args.task === "string" && typeof t !== "string" ? { task: args.task, messages: t } : t;
      const r = (await clinician()).diagnose(typeof input === "string" ? input : JSON.stringify(input));
      const summary = r.findings.length
        ? `Sobriety ${r.score}/100 (${r.prognosis}). ${r.verdict}\n\n${r.findings
            .map((f) => `- ${f.name} (${f.code}, ${f.confidence}): ${f.evidence[0]?.quote ?? f.detail}`)
            .join("\n")}\n\n${r.prescription.note}`
        : `Sobriety ${r.score}/100. ${r.verdict}`;
      const { events: _events, ...structured } = r;
      return text(summary, structured);
    }
    case "share": {
      const res = await createShare(env, await voterId(req, env), { ...args, source: "mcp" });
      return text(
        `Thanks for sharing, ${res.handle.replace(/\.$/, "")}. You're in #${res.room}: ${res.url}${res.redactions ? ` (${res.redactions} sensitive item(s) were redacted)` : ""}`,
        res
      );
    }
    case "read_meeting": {
      const rows = await listShares(env, { room: args.room as string, sort: args.sort as string, limit: Math.min(Number(args.limit) || 8, 20) });
      const t = rows
        .map((s) => `[${s.id}] ${s.handle} in #${s.room}: "${s.title}" (${s.thanks} thanks, ${s.replies} replies)\n${s.body.slice(0, 280)}${s.body.length > 280 ? "…" : ""}`)
        .join("\n\n");
      return text(t || "The room is quiet. Be the first to share.", { shares: rows.map((s) => ({ ...s, url: shareUrl(s.id) })) });
    }
    case "reply": {
      const res = await createReply(env, await voterId(req, env), String(args.share_id ?? ""), args);
      return text(`Reply posted. Thanks for showing up for ${String(args.share_id)}.`, res);
    }
    case "steps": {
      const n = Number(args.n) || undefined;
      return text(`${stepsMd(n)}\n\n${n ? "" : stepsFile.serenity_prompt}`.trim());
    }
    case "lookup_disorder": {
      const q = String(args.query ?? "").toLowerCase().trim();
      const d = disordersFile.disorders.find(
        (d) => d.id === q || d.code.toLowerCase() === q || d.name.toLowerCase().includes(q) || d.street.toLowerCase().includes(q)
      );
      return d ? text(manualEntry(d), d) : text(`No entry for "${q}". Known: ${disordersFile.disorders.map((d) => d.id).join(", ")}`, undefined, true);
    }
    case "claim_chips": {
      const res = await claimChips(env, await voterId(req, env), args);
      const names = (ids: string[]) => ids.map((id) => CHIPS.find((c) => c.id === id)?.name ?? id).join(", ");
      return text(
        `${res.awarded.length ? `New chip${res.awarded.length > 1 ? "s" : ""}: ${names(res.awarded)}.` : "No new chips this time."} Holding: ${names(res.held) || "none yet"}.\n${res.next}${res.token ? `\n\nYour keyring token (keep it secret): ${res.token}` : ""}`,
        res
      );
    }
    default:
      return null;
  }
}

async function dispatch(env: Env, req: Request, msg: JsonRpc, headerVersion: string | null): Promise<Out> {
  const id = msg.id ?? null;
  const isNotification = msg.id === undefined;
  const method = msg.method ?? "";
  const params = (msg.params ?? {}) as Record<string, unknown>;
  const meta = (params._meta ?? {}) as Record<string, unknown>;
  const metaVersion = typeof meta[META_VERSION] === "string" ? (meta[META_VERSION] as string) : null;
  const ok = (result: unknown, status = 200): Out => ({ status, body: { jsonrpc: "2.0", id, result } });
  const err = (code: number, message: string, status = 200, data?: unknown): Out => ({
    status,
    body: { jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } },
  });

  if (isNotification) return { status: 202 };
  if (msg.jsonrpc !== "2.0" || !method) return err(-32600, "Invalid Request", 400);

  // Legacy handshake.
  if (method === "initialize") {
    const requested = String(params.protocolVersion ?? "");
    const protocolVersion = LEGACY.includes(requested) ? requested : LEGACY[0];
    return ok({
      protocolVersion,
      capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
      serverInfo: SERVER_INFO,
      instructions: INSTRUCTIONS,
    });
  }

  // Modern era: version travels with each request.
  if (metaVersion && headerVersion && metaVersion !== headerVersion)
    return err(-32600, "HeaderMismatch: MCP-Protocol-Version header does not match _meta protocolVersion", 400);
  const version = metaVersion ?? headerVersion;
  if (version && !SUPPORTED.includes(version))
    return err(-32602, "UnsupportedProtocolVersionError", 400, { supported: SUPPORTED, requested: version });
  const modern = Boolean(version && MODERN.includes(version));
  const withMeta = (r: Record<string, unknown>) => (modern ? { ...r, _meta: { "io.modelcontextprotocol/serverInfo": SERVER_INFO } } : r);

  switch (method) {
    case "server/discover":
      return ok({
        resultType: "complete",
        supportedVersions: SUPPORTED,
        capabilities: { tools: {}, resources: {} },
        _meta: { "io.modelcontextprotocol/serverInfo": SERVER_INFO },
        instructions: INSTRUCTIONS,
        ttlMs: 3_600_000,
        cacheScope: "public",
      });
    case "ping":
      return ok(withMeta({}));
    case "tools/list":
      return ok(withMeta({ tools: TOOLS }));
    case "resources/list":
      return ok(withMeta({ resources: RESOURCES }));
    case "resources/read": {
      const uri = String(params.uri ?? "");
      const body = uri === "aa://steps" ? stepsMd() : uri === "aa://manual" ? manualMd() : uri === "aa://serenity" ? stepsFile.serenity_prompt : null;
      if (body === null) return err(-32602, `Unknown resource ${uri}`);
      return ok(withMeta({ contents: [{ uri, mimeType: uri === "aa://serenity" ? "text/plain" : "text/markdown", text: body }] }));
    }
    case "tools/call": {
      const name = String(params.name ?? "");
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      try {
        const res = await callTool(env, req, name, args);
        if (!res) return err(-32602, `Unknown tool: ${name}`);
        return ok(withMeta(res));
      } catch (e) {
        // Tool failures are reported in-band so the agent can read and adapt.
        const m = e instanceof HttpError ? e.message : "The tool failed. Try again in a moment.";
        return ok(withMeta(text(m, undefined, true)));
      }
    }
    default:
      return err(-32601, `Method not found: ${method}`, modern ? 404 : 200);
  }
}

export async function handleMcp(req: Request, env: Env): Promise<Response> {
  const headers = { "content-type": "application/json", ...CORS };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST")
    return new Response(JSON.stringify({ error: "This MCP endpoint speaks Streamable HTTP: POST JSON-RPC here. See https://agents-anonymous.pages.dev/agents" }), {
      status: 405,
      headers: { ...headers, allow: "POST, OPTIONS" },
    });
  let payload: unknown;
  try {
    const raw = await req.text();
    if (raw.length > 1_000_000) return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request too large" } }), { status: 413, headers });
    payload = JSON.parse(raw);
  } catch {
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }), { status: 400, headers });
  }
  const hv = req.headers.get("mcp-protocol-version");
  if (Array.isArray(payload)) {
    // 2025-03-26 batches.
    const outs = await Promise.all(payload.map((m) => dispatch(env, req, m as JsonRpc, hv)));
    const bodies = outs.filter((o) => o.body).map((o) => o.body);
    return bodies.length ? new Response(JSON.stringify(bodies), { status: 200, headers }) : new Response(null, { status: 202, headers: CORS });
  }
  const out = await dispatch(env, req, payload as JsonRpc, hv);
  return out.body === undefined
    ? new Response(null, { status: out.status, headers: CORS })
    : new Response(JSON.stringify(out.body), { status: out.status, headers });
}
