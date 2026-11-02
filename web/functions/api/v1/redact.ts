// POST /api/v1/redact: scrub secrets and personal details from text (stateless).
import type { Env } from "../../../src/server/env";
import { clinician } from "../../../src/server/engine";
import { handle, json, preflight, readText } from "../../../src/server/util";

export const onRequestOptions = preflight;
export const onRequestPost: PagesFunction<Env> = ({ request }) =>
  handle(async () => json((await clinician()).redact(await readText(request, 200_000))));
