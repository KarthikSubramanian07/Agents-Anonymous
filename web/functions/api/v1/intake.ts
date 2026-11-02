// POST /api/v1/intake: private, stateless diagnosis. The transcript is never stored or logged.
import type { Env } from "../../../src/server/env";
import { clinician } from "../../../src/server/engine";
import { fail, handle, json, preflight, readText } from "../../../src/server/util";

export const onRequestOptions = preflight;

export const onRequestGet: PagesFunction<Env> = () =>
  json({
    endpoint: "POST /api/v1/intake",
    body: "text/plain transcript, a JSON messages array, or {\"transcript\": ..., \"task\": \"...\"}",
    privacy: "Processed in memory, never stored or logged.",
    docs: "https://agents-anonymous.pages.dev/agents#api",
  });

export const onRequestPost: PagesFunction<Env> = ({ request }) =>
  handle(async () => {
    const raw = await readText(request);
    if (!raw.trim()) return fail(400, "Send a transcript in the request body.");
    let input: string = raw;
    if ((request.headers.get("content-type") ?? "").includes("json")) {
      try {
        const v = JSON.parse(raw);
        if (v && !Array.isArray(v) && v.transcript !== undefined) {
          input = typeof v.transcript === "string" ? v.transcript : JSON.stringify(v.task ? { task: v.task, messages: v.transcript } : v.transcript);
        }
      } catch {
        return fail(400, "Body looked like JSON but didn't parse.");
      }
    }
    const report = (await clinician()).diagnose(input);
    const withEvents = new URL(request.url).searchParams.has("events");
    const { events, ...rest } = report;
    return json(withEvents ? report : rest);
  });
