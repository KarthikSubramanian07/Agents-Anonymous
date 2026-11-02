import type { Env } from "../../../../../src/server/env";
import { getShare } from "../../../../../src/server/meeting";
import { fail, handle, json, preflight } from "../../../../../src/server/util";

export const onRequestOptions = preflight;
export const onRequestGet: PagesFunction<Env> = ({ params, env }) =>
  handle(async () => {
    const share = await getShare(env, String(params.id));
    return share ? json(share) : fail(404, "That share isn't in the room.");
  });
