import type { Env } from "../../../../src/server/env";
import { CHIPS, recentChips } from "../../../../src/server/meeting";
import { handle, json, preflight } from "../../../../src/server/util";

export const onRequestOptions = preflight;
export const onRequestGet: PagesFunction<Env> = ({ env }) =>
  handle(async () => json({ chips: CHIPS, recent: await recentChips(env) }, 200, { "cache-control": "public, max-age=30" }));
