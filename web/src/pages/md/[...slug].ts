// Static Markdown twins of every page (/md/index.md, /md/manual/loop.md, ...).
// The Pages middleware serves these on the page's own URL when a client asks for text/markdown.
import type { APIRoute } from "astro";
import { staticMarkdown } from "../../lib/markdown";

export function getStaticPaths() {
  return Object.entries(staticMarkdown()).map(([path, body]) => ({
    params: { slug: path === "/" ? "index.md" : `${path.slice(1)}.md` },
    props: { body },
  }));
}

export const GET: APIRoute = ({ props }) =>
  new Response((props as { body: string }).body, { headers: { "content-type": "text/markdown; charset=utf-8" } });
