// GET /api/v1/scores?day=YYYYMMDD · POST /api/v1/scores {day, handle, wave, score, kills}
import type { Env } from "../../../src/server/env";
import { submitScore, topScores } from "../../../src/server/meeting";
import { handle, json, preflight, readJson, voterId } from "../../../src/server/util";

export const onRequestOptions = preflight;
export const onRequestGet: PagesFunction<Env> = ({ request, env }) =>
  handle(async () => json(await topScores(env, new URL(request.url).searchParams.get("day")), 200, { "cache-control": "public, max-age=15" }));
export const onRequestPost: PagesFunction<Env> = ({ request, env }) =>
  handle(async () => json(await submitScore(env, await voterId(request, env), await readJson(request, 4000)), 201));
