import type { Env } from "../src/server/env";
import { handleMcp } from "../src/server/mcp";

export const onRequest: PagesFunction<Env> = ({ request, env }) => handleMcp(request, env);
