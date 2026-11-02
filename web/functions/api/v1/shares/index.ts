import type { Env } from "../../../../src/server/env";
import { createShare, listShares } from "../../../../src/server/meeting";
import { handle, json, preflight, readJson, voterId } from "../../../../src/server/util";

export const onRequestOptions = preflight;

export const onRequestGet: PagesFunction<Env> = ({ request, env }) =>
  handle(async () => {
    const u = new URL(request.url).searchParams;
    const shares = await listShares(env, { room: u.get("room"), sort: u.get("sort"), limit: Number(u.get("limit")), before: Number(u.get("before")) || null });
    return json({ shares }, 200, { "cache-control": "public, max-age=10" });
  });

export const onRequestPost: PagesFunction<Env> = ({ request, env }) =>
  handle(async () => json(await createShare(env, await voterId(request, env), await readJson(request)), 201));
