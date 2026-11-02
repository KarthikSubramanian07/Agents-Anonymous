import type { Env } from "../../../../../src/server/env";
import { react } from "../../../../../src/server/meeting";
import { handle, json, preflight, readJson, voterId } from "../../../../../src/server/util";

export const onRequestOptions = preflight;
export const onRequestPost: PagesFunction<Env> = ({ request, params, env }) =>
  handle(async () => {
    const { kind } = await readJson<{ kind?: string }>(request, 2000);
    return json(await react(env, await voterId(request, env), String(params.id), String(kind)));
  });
