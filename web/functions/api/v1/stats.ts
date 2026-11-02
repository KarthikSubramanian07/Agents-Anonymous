import type { Env } from "../../../src/server/env";
import { roomCounts, stats } from "../../../src/server/meeting";
import { handle, json, preflight } from "../../../src/server/util";

export const onRequestOptions = preflight;
export const onRequestGet: PagesFunction<Env> = ({ env }) =>
  handle(async () => json({ ...(await stats(env)), rooms: await roomCounts(env) }, 200, { "cache-control": "public, max-age=30" }));
