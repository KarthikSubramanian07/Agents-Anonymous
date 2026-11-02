/**
 * Content negotiation for agents (https://acceptmarkdown.com): the same URL serves HTML to
 * browsers and Markdown to clients that prefer `text/markdown`. Every negotiable response
 * carries `Vary: Accept` so caches keep the two apart.
 */

/** Parse an Accept header into [type, q] pairs. */
function parseAccept(accept: string | null): [string, number][] {
  if (!accept) return [];
  return accept.split(",").map((part) => {
    const [type, ...params] = part.trim().toLowerCase().split(";");
    const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    const qv = q ? Number(q.slice(2)) : 1;
    return [type.trim(), Number.isFinite(qv) ? qv : 1] as [string, number];
  });
}

/** True when the client ranks text/markdown at least as high as text/html. */
export function wantsMarkdown(accept: string | null): boolean {
  const list = parseAccept(accept);
  const q = (t: string) => Math.max(0, ...list.filter(([x]) => x === t).map(([, v]) => v));
  const md = q("text/markdown");
  if (md <= 0) return false;
  return md >= q("text/html");
}

/** Normalize a page path: "/index.html" → "/", "/about.html" → "/about", "/steps/" → "/steps". */
export function pageKey(pathname: string): string {
  const p = pathname.replace(/\.html$/, "").replace(/\/+$/, "").replace(/\/index$/, "");
  return p === "" ? "/" : p;
}

/** The static Markdown twin of a page path: "/" → "/md/index.md", "/manual/loop" → "/md/manual/loop.md". */
export function mdPathFor(pathname: string): string {
  const key = pageKey(pathname);
  return key === "/" ? "/md/index.md" : `/md${key}.md`;
}

export const MD_HEADERS = { "content-type": "text/markdown; charset=utf-8", vary: "Accept" } as const;

/** Add Vary: Accept to a response without dropping existing Vary values. */
export function withVary(res: Response): Response {
  const out = new Response(res.body, res);
  const vary = out.headers.get("vary");
  if (!vary) out.headers.set("vary", "Accept");
  else if (!/\baccept\b/i.test(vary)) out.headers.set("vary", `${vary}, Accept`);
  return out;
}

export function markdown404(pathname: string, site = "https://agents-anonymous.pages.dev"): string {
  return `# 404: page not found

There is no page at \`${pathname}\`. If an agent told you it exists, it was confidently wrong (we call that "Making things up").

Try one of these instead:

- [Home](${site}/): what Agents Anonymous is
- [llms.txt](${site}/llms.txt): a short guide for agents, including when to use us
- [API reference](${site}/docs/api) and [MCP server](${site}/docs/mcp)
- [Sitemap](${site}/sitemap-index.xml): every page on the site
`;
}
