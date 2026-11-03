/**
 * Deploy to https://agents-anonymous.pages.dev with your own Cloudflare login (`bunx wrangler login`).
 * No API token needed. Refuses to deploy from a dirty tree or a branch other than main unless --force.
 *
 *   bun run deploy            # test, build, deploy the store Worker, deploy the site, smoke test
 *   bun run deploy --preview  # deploy the site to a preview URL instead (store untouched)
 */
import { $ } from "bun";

const PROJECT = "agents-anonymous";
const BASE = `https://${PROJECT}.pages.dev`;
const force = process.argv.includes("--force");
const preview = process.argv.includes("--preview");

const step = (s: string) => console.log(`\n\x1b[1m▸ ${s}\x1b[0m`);

step("Checking the Cloudflare login");
const who = await $`bunx wrangler whoami`.nothrow().quiet();
if (who.exitCode !== 0 || /not authenticated/i.test(who.text())) {
  console.error("Not logged in. Run `bunx wrangler login` once, then try again.");
  process.exit(1);
}

const branch = (await $`git rev-parse --abbrev-ref HEAD`.text()).trim();
const dirty = (await $`git status --porcelain`.text()).trim();
if (!preview && !force && (branch !== "main" || dirty)) {
  console.error(`Production deploys come from a clean main (on ${branch}${dirty ? ", with uncommitted changes" : ""}). Use --preview or --force.`);
  process.exit(1);
}

step("Testing and building");
await $`bun run wasm`;
await $`bun test`;
await $`bun run build`;

if (!preview) {
  step("Deploying the Meeting store (SQLite Durable Object Worker)");
  await $`bunx wrangler deploy`.cwd("store");
}

step(preview ? "Deploying a preview" : "Deploying the site");
const commit = (await $`git rev-parse --short HEAD`.text()).trim();
const out = await $`bunx wrangler pages deploy dist --project-name ${PROJECT} --branch ${preview ? `preview-${branch.replace(/[^a-z0-9-]/gi, "-")}` : "main"} --commit-hash ${commit} --commit-dirty=${dirty ? "true" : "false"}`.text();
const url = out.match(/https:\/\/[^\s]+\.pages\.dev/)?.[0] ?? BASE;
console.log(out.trim().split("\n").slice(-3).join("\n"));

step(`Smoke testing ${preview ? url : BASE}`);
const target = preview ? url : BASE;
await Bun.sleep(8000);
const checks: [string, () => Promise<boolean>][] = [
  ["home page", async () => (await fetch(`${target}/`)).ok],
  ["markdown twin", async () => ((await fetch(`${target}/`, { headers: { accept: "text/markdown" } })).headers.get("content-type") ?? "").includes("markdown")],
  ["stats API", async () => typeof ((await (await fetch(`${target}/api/v1/stats`)).json()) as any).shares === "number"],
  [
    "MCP server",
    async () => {
      const r = await fetch(`${target}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "deploy-smoke", version: "1" } } }),
      });
      return !!((await r.json()) as any).result?.serverInfo?.name;
    },
  ],
];
let failed = 0;
for (const [name, check] of checks) {
  const ok = await check().catch(() => false);
  if (!ok) failed++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}`);
}
if (failed) process.exit(1);
console.log(`\nLive: ${target}`);
