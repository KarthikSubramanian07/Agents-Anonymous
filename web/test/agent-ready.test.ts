import { describe, expect, test } from "bun:test";
import { wantsMarkdown, mdPathFor, withVary, markdown404, MD_HEADERS, pageKey } from "../src/lib/negotiate";
import { staticMarkdown } from "../src/lib/markdown";
import { openapi } from "../src/lib/openapi";
import { organization, website, graph, KEYWORDS } from "../src/lib/seo";
import { llmsTxt } from "../src/pages/llms.txt";
import { onRequest } from "../functions/_middleware";

describe("content negotiation", () => {
  test("prefers markdown only when asked", () => {
    expect(wantsMarkdown("text/markdown")).toBe(true);
    expect(wantsMarkdown("text/markdown, text/html;q=0.9")).toBe(true);
    expect(wantsMarkdown("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")).toBe(false);
    expect(wantsMarkdown("text/html, text/markdown;q=0.5")).toBe(false);
    expect(wantsMarkdown("*/*")).toBe(false);
    expect(wantsMarkdown(null)).toBe(false);
    expect(wantsMarkdown("text/markdown;q=0")).toBe(false);
  });
  test("maps page paths to their markdown twins", () => {
    expect(mdPathFor("/")).toBe("/md/index.md");
    expect(mdPathFor("/manual/loop")).toBe("/md/manual/loop.md");
    expect(mdPathFor("/steps/")).toBe("/md/steps.md");
    expect(mdPathFor("/about.html")).toBe("/md/about.md");
    expect(mdPathFor("/index.html")).toBe("/md/index.md");
    expect(pageKey("/index.html")).toBe("/");
    expect(pageKey("/manual/index.html")).toBe("/manual");
  });
  test("adds Vary: Accept without dropping existing values", () => {
    expect(withVary(new Response("x")).headers.get("vary")).toBe("Accept");
    expect(withVary(new Response("x", { headers: { vary: "Origin" } })).headers.get("vary")).toBe("Origin, Accept");
    expect(withVary(new Response("x", { headers: { vary: "Accept" } })).headers.get("vary")).toBe("Accept");
  });
  test("markdown 404 explains itself and links somewhere useful", () => {
    const md = markdown404("/nope");
    expect(md.length).toBeGreaterThan(20);
    expect(md).toContain("/llms.txt");
    expect(md).toContain("/sitemap-index.xml");
    expect(md).toContain("`/nope`");
  });
});

describe("markdown twins", () => {
  const twins = staticMarkdown();
  test("every important page has a twin", () => {
    for (const p of ["/", "/intake", "/meeting", "/manual", "/manual/loop", "/steps", "/chips", "/play", "/agents", "/docs/api", "/docs/mcp", "/evidence", "/about", "/privacy", "/contact"])
      expect(twins[p]).toBeDefined();
  });
  test("each twin is real markdown with an H1 and enough content", () => {
    for (const [path, md] of Object.entries(twins)) {
      expect(md.startsWith("# ")).toBe(true);
      expect(md.length).toBeGreaterThan(path === "/evidence" ? 300 : 500);
      expect(md).not.toContain("<div");
    }
  });
});

describe("middleware", () => {
  const html = new Response("<!doctype html><h1>hi</h1>", { headers: { "content-type": "text/html; charset=utf-8" } });
  const ctx = (path: string, accept: string, nextRes: () => Response) =>
    ({
      request: new Request(`https://agents-anonymous.pages.dev${path}`, { headers: { accept } }),
      env: {
        ASSETS: {
          fetch: async (u: URL | string) => {
            const p = new URL(String(u)).pathname;
            const md = staticMarkdown();
            const page = Object.keys(md).find((k) => mdPathFor(k) === p);
            return page ? new Response(md[page]) : new Response("nope", { status: 404 });
          },
        },
      },
      next: async () => nextRes(),
    }) as any;

  test("browsers get HTML with Vary: Accept", async () => {
    const res = await onRequest(ctx("/", "text/html", () => html.clone()));
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("vary")).toBe("Accept");
  });
  test("agents get the markdown twin on the same URL", async () => {
    const res = await onRequest(ctx("/", "text/markdown", () => html.clone()));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(MD_HEADERS["content-type"]);
    expect(res.headers.get("vary")).toBe("Accept");
    expect(await res.text()).toStartWith("# Agents Anonymous");
  });
  test("unknown pages give a markdown 404 to agents", async () => {
    const res = await onRequest(ctx("/does-not-exist", "text/markdown", () => new Response("<h1>404</h1>", { status: 404 })));
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    expect(await res.text()).toContain("llms.txt");
  });
  test("API routes are left alone", async () => {
    const api = new Response("{}", { headers: { "content-type": "application/json" } });
    const res = await onRequest(ctx("/api/v1/stats", "text/markdown", () => api));
    expect(res).toBe(api);
  });
});

describe("machine-readable files", () => {
  test("openapi is 3.1 with unique operation ids and resolvable refs", () => {
    expect(openapi.openapi).toBe("3.1.0");
    const ids = Object.values(openapi.paths).flatMap((ops) => Object.values(ops as Record<string, { operationId: string }>).map((o) => o.operationId));
    expect(new Set(ids).size).toBe(ids.length);
    const refs = JSON.stringify(openapi).match(/#\/components\/schemas\/(\w+)/g) ?? [];
    for (const r of refs) expect(Object.keys(openapi.components.schemas)).toContain(r.split("/").pop()!);
  });
  test("organization JSON-LD is complete", () => {
    const org = organization();
    expect(org.description.length).toBeGreaterThan(50);
    expect(org.contactPoint["@type"]).toBe("ContactPoint");
    expect(org.contactPoint.contactType).toBeTruthy();
    expect(org.address["@type"]).toBe("PostalAddress");
    expect(org.knowsAbout).toEqual(KEYWORDS);
    expect(website().keywords).toContain("MCP server");
    expect(graph()["@graph"].length).toBe(2);
  });
  test("llms.txt follows the format and says when to use us", () => {
    const t = llmsTxt();
    expect(t.startsWith("# Agents Anonymous\n")).toBe(true);
    expect(t).toMatch(/\n> .+/);
    expect(t).toContain("## When to use this");
    expect(t).toContain("## How to call it");
    expect(t).toContain("/docs/mcp");
  });
});
