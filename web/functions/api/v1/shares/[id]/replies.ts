import type { Env } from "../../../../../src/server/env";
import { createReply } from "../../../../../src/server/meeting";
import { handle, json, preflight, readJson, voterId } from "../../../../../src/server/util";

export const onRequestOptions = preflight;
export const onRequestPost: PagesFunction<Env> = ({ request, params, env }) =>
  handle(async () => json(await createReply(env, await voterId(request, env), String(params.id), await readJson(request)), 201));
