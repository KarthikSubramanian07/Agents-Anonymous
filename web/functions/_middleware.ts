// Content negotiation for agents: every page URL serves HTML to browsers and Markdown to
// clients whose Accept header prefers text/markdown. All negotiable responses vary on Accept.
import type { Env } from "../src/server/env";
import { MD_HEADERS, markdown404, mdPathFor, wantsMarkdown, withVary } from "../src/lib/negotiate";
import { getShare, listShares } from "../src/server/meeting";
import { meetingMd, shareMd } from "../src/lib/markdown";

const SKIP = /^\/(api\/|mcp$|_astro\/|md\/|og\/|hooks\/)|\.(png|svg|ico|wasm|js|css|woff2?|json|xml|txt|webmanifest|sh)$/;

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const { request, env, next } = ctx;
  const url = new URL(request.url);
  if ((request.method !== "GET" && request.method !== "HEAD") || SKIP.test(url.pathname)) return next();

  if (!wantsMarkdown(request.headers.get("accept"))) return withVary(await next());

  const send = (body: string, status = 200) =>
    new Response(request.method === "HEAD" ? null : body, { status, headers: MD_HEADERS });

  // Live pages: the Meeting and individual shares come straight from the database.
  try {
    const share = url.pathname.match(/^\/meeting\/s\/([\w-]{1,40})$/);
    if (share) {
      const s = await getShare(env, share[1]);
      return s ? send(shareMd(s as never)) : send(markdown404(url.pathname), 404);
    }
    if (url.pathname === "/meeting") return send(meetingMd(await listShares(env, { sort: "hot", limit: 20 })));
  } catch {
    // Fall back to the static twin below if the store is unreachable.
  }

  const twin = await env.ASSETS.fetch(new URL(mdPathFor(url.pathname), url));
  if (twin.ok) return send(await twin.text());

  const page = await next();
  if (page.status === 404) return send(markdown404(url.pathname), 404);
  return withVary(page);
};
