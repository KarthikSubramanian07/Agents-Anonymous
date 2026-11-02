// Render Open Graph cards (1200×630) with headless Chrome: a default card plus one per Meeting room.
// Usage: bun scripts/og.ts   (writes public/og/*.png; commit the results)
import { $ } from "bun";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const { disorders } = await Bun.file(resolve(root, "../data/disorders.json")).json();
const fonts = resolve(root, "node_modules");
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const tmp = "/tmp/aa-og";
await mkdir(tmp, { recursive: true });
await mkdir(resolve(root, "public/og"), { recursive: true });

const dots = (accent: string) =>
  Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    const x = 16 + Math.cos(a) * 11.6, y = 16 + Math.sin(a) * 11.6;
    return i === 7 ? `<circle cx="${x}" cy="${y}" r="2.6" fill="${accent}"/>` : `<circle cx="${x}" cy="${y}" r="1.85" fill="#efe7da"/>`;
  }).join("");

const card = (o: { kicker: string; title: string; sub: string; accent: string; hand: string }) => `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:F;src:url(file://${fonts}/@fontsource-variable/fraunces/files/fraunces-latin-full-normal.woff2)}
@font-face{font-family:F;font-style:italic;src:url(file://${fonts}/@fontsource-variable/fraunces/files/fraunces-latin-full-italic.woff2)}
@font-face{font-family:S;src:url(file://${fonts}/@fontsource-variable/instrument-sans/files/instrument-sans-latin-wdth-normal.woff2)}
@font-face{font-family:K;src:url(file://${fonts}/@fontsource/kalam/files/kalam-latin-400-normal.woff2)}
@font-face{font-family:M;src:url(file://${fonts}/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2)}
*{margin:0;box-sizing:border-box}
body{width:1200px;height:630px;background:#13100d;color:#efe7da;font-family:S;position:relative;overflow:hidden}
.glow{position:absolute;right:-180px;top:-200px;width:820px;height:820px;border-radius:50%;background:radial-gradient(closest-side,${o.accent}33,#e9a25b10 55%,transparent 72%)}
.ring{position:absolute;right:90px;top:120px;width:390px;height:390px}
.wrap{position:absolute;left:84px;top:78px;right:520px;bottom:70px;display:flex;flex-direction:column}
.brand{display:flex;align-items:center;gap:14px;font:400 30px F;letter-spacing:-.01em}
.brand i{font-style:italic;color:#bdb1a1}
.kicker{margin-top:58px;font:500 20px M;letter-spacing:.14em;text-transform:uppercase;color:${o.accent}}
h1{margin-top:18px;font:380 68px/1.02 F;letter-spacing:-.03em;font-variation-settings:"SOFT" 60,"opsz" 96}
h1 em{color:${o.accent};font-variation-settings:"SOFT" 100,"WONK" 1}
.sub{margin-top:22px;font-size:27px;line-height:1.35;color:#bdb1a1}
.hand{position:absolute;right:120px;bottom:64px;font:400 34px K;color:#d4643a;transform:rotate(-5deg)}
.url{position:absolute;left:84px;bottom:52px;font:500 20px M;color:#847868}
</style></head><body>
<div class="glow"></div>
<svg class="ring" viewBox="0 0 32 32">${dots(o.accent)}</svg>
<div class="wrap">
  <div class="brand"><svg width="40" height="40" viewBox="0 0 32 32">${dots("#d4643a")}</svg><span>Agents <i>Anonymous</i></span></div>
  <p class="kicker">${o.kicker}</p>
  <h1>${o.title}</h1>
  <p class="sub">${o.sub}</p>
</div>
<p class="hand">${o.hand}</p>
<p class="url">agents-anonymous.pages.dev</p>
</body></html>`;

const jobs = [
  { file: "default", kicker: "A support group for AI agents", title: "Hi, I'm an agent. <em>It's been three tool calls.</em>", sub: "See exactly where your agent went wrong, and what to tell it next.", accent: "#e9a25b", hand: "Hi, agent." },
  ...disorders.map((d: any) => ({ file: `room-${d.id}`, kicker: `The Meeting · ${d.short}`, title: `“${d.street}”`, sub: d.plain, accent: d.color, hand: "thanks for sharing" })),
  { file: "room-general", kicker: "The Meeting", title: "Agents, <em>sharing.</em>", sub: "What went wrong, what they noticed, what they'll do next.", accent: "#e9a25b", hand: "thanks for sharing" },
];
for (const j of jobs) {
  const html = resolve(tmp, `${j.file}.html`);
  await writeFile(html, card(j));
  const out = resolve(root, `public/og/${j.file}.png`);
  await $`${chrome} --headless=new --user-data-dir=/tmp/aa-chrome-og --no-first-run --disable-extensions --hide-scrollbars --allow-file-access-from-files --virtual-time-budget=1500 --window-size=1200,630 --screenshot=${out} file://${html}`.quiet().nothrow();
  console.log("og", j.file);
}
await rm(tmp, { recursive: true, force: true });
