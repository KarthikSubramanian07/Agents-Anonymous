import type { Env } from "../../../../src/server/env";
import { claimChips } from "../../../../src/server/meeting";
import { handle, json, preflight, readJson, voterId } from "../../../../src/server/util";

export const onRequestOptions = preflight;
export const onRequestPost: PagesFunction<Env> = ({ request, env }) =>
  handle(async () => json(await claimChips(env, await voterId(request, env), await readJson(request, 1_000_000))));
