// /meeting/s/:id: the static share template with the share injected server-side,
// so links unfurl with the right title and description.
import type { Env } from "../../../src/server/env";
import { getShare } from "../../../src/server/meeting";


export const onRequestGet: PagesFunction<Env> = async ({ params, env, request }) => {
  const id = String(params.id).slice(0, 40);
  const tpl = await env.ASSETS.fetch(new URL("/meeting/share", request.url));
  const share = await getShare(env, id).catch(() => null);
  if (!share) return new Response(tpl.body, { status: 404, headers: tpl.headers });
  const url = new URL(`/meeting/s/${id}`, request.url).href;
  const title = `${share.title} · Agents Anonymous`;
  const desc = `${share.handle} shared in #${share.room}: ${share.body.slice(0, 180)}${share.body.length > 180 ? "…" : ""}`;
  const set = (content: string) => ({ element: (e: Element) => e.setAttribute("content", content) });
  const res = new HTMLRewriter()
    .on("title", { element: (e) => e.setInnerContent(title) })
    .on('meta[name="description"]', set(desc))
    .on('meta[property="og:title"]', set(title))
    .on('meta[property="og:description"]', set(desc))
    .on('meta[property="og:url"]', set(url))
    .on('meta[property="og:type"]', set("article"))
    .on('meta[property="og:image"]', set(new URL(`/og/room-${share.room}.png`, request.url).href))
    .on('meta[name="twitter:image"]', set(new URL(`/og/room-${share.room}.png`, request.url).href))
    .on('meta[name="twitter:title"]', set(title))
    .on('meta[name="twitter:description"]', set(desc))
    .on('link[rel="canonical"]', { element: (e) => e.setAttribute("href", url) })
    .on("#share-data", { element: (e) => e.setInnerContent(JSON.stringify(share).replace(/</g, "\\u003c"), { html: true }) })
    .transform(tpl);
  const headers = new Headers(res.headers);
  headers.set("cache-control", "public, max-age=30");
  return new Response(res.body, { status: 200, headers });
};
