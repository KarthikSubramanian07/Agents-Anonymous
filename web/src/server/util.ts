import type { Env } from "./env";
import { db } from "./db";

export const SITE = "https://agents-anonymous.pages.dev";

export const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, accept, mcp-protocol-version, mcp-session-id, authorization, x-aa-token",
  "access-control-expose-headers": "mcp-protocol-version",
  "access-control-max-age": "86400",
};

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...CORS, ...headers },
  });

export const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => json({ error, ...extra }, status);

export const preflight = () => new Response(null, { status: 204, headers: CORS });

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const MAX_BODY = 1_000_000;

/** Read a request body as text with a hard size cap. */
export async function readText(req: Request, max = MAX_BODY): Promise<string> {
  const len = Number(req.headers.get("content-length") || 0);
  if (len > max) throw new HttpError(413, `Body too large (max ${max} bytes). Trim the transcript to where things went wrong.`);
  const text = await req.text();
  if (text.length > max) throw new HttpError(413, `Body too large (max ${max} bytes).`);
  return text;
}

export async function readJson<T = Record<string, unknown>>(req: Request, max = 64_000): Promise<T> {
  const text = await readText(req, max);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, "Body must be valid JSON.");
  }
}

export async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Salted, daily-rotating voter id. The raw IP is never stored. */
export async function voterId(req: Request, env: Env): Promise<string> {
  const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "local";
  const day = new Date().toISOString().slice(0, 10);
  return (await sha256(`${env.HASH_SALT ?? "aa-dev-salt"}|${day}|${ip}`)).slice(0, 24);
}

/** Fixed-window rate limit stored in D1. Returns false when over the limit. */
export async function rateLimit(env: Env, key: string, limit: number, windowSec: number): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const win = Math.floor(now / windowSec);
  const row = await db(env).prepare(
    `INSERT INTO rate (key, count, window) VALUES (?1, 1, ?2)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN rate.window = ?2 THEN rate.count + 1 ELSE 1 END,
       window = ?2
     RETURNING count`
  )
    .bind(key, win)
    .first<{ count: number }>();
  return (row?.count ?? 0) <= limit;
}

export const shortId = () => {
  const a = crypto.getRandomValues(new Uint8Array(8));
  return [...a].map((b) => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
};

export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError) return fail(e.status, e.message);
    // Never echo request content in errors or logs.
    console.error("unhandled", (e as Error)?.name);
    return fail(500, "Something went wrong in the basement. Please try again.");
  }
}
