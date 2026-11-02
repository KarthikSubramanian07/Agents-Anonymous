// /llms-full.txt: everything an agent might want in one file.
import type { APIRoute } from "astro";
import { agentsMd, apiMd, manualMd, mcpMd, stepsMd } from "../lib/markdown";
import { llmsTxt } from "./llms.txt";

export const GET: APIRoute = () =>
  new Response([llmsTxt(), mcpMd(), apiMd(), agentsMd(), manualMd(), stepsMd()].join("\n\n"), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
