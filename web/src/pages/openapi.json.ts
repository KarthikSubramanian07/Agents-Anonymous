import type { APIRoute } from "astro";
import { openapi } from "../lib/openapi";

export const GET: APIRoute = () =>
  new Response(JSON.stringify(openapi, null, 2), { headers: { "content-type": "application/json; charset=utf-8" } });
