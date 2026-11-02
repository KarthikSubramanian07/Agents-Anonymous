import { describe, expect, test } from "bun:test";
import { Game, CHAIRS } from "../src/game/defend";
import { TOWERS, ENEMIES, type TowerKind } from "../src/game/defs";

/** A bot that places the counter for whatever it has seen, upgrading when rich. */
function bot(g: Game, smart: boolean) {
  const want: TowerKind[] = smart
    ? (["tests", "own", "pivot", "ask", "read", "scope", "spine"] as TowerKind[]).filter((k) =>
        [...g.seen].some((e) => ENEMIES[e].counters.includes(k))
      )
    : ["tests"];
  const have = new Set([...g.towers.values()].map((t) => t.kind));
  for (const k of want.length ? want : ["tests" as TowerKind]) {
    if ((!have.has(k) || g.tokens > 260) && g.tokens >= TOWERS[k].cost) {
      const free = CHAIRS.find((c) => !g.towers.has(c.i));
      if (free) g.place(free.i, k);
    }
  }
  if (g.tokens > 200) for (const t of g.towers.values()) if (t.level < 3) g.upgrade(t.chair);
}

function run(seed: number, smart: boolean, maxSeconds = 1500) {
  const g = new Game(seed, {});
  g.start();
  for (let s = 0; s < maxSeconds * 10 && g.state !== "over"; s++) {
    g.tick(0.1);
    if (s % 5 === 0) bot(g, smart);
    for (const e of g.enemies) if (!Number.isFinite(e.x) || !Number.isFinite(e.hp)) throw new Error("NaN enemy");
  }
  return g;
}

describe("Defend the Circle simulation", () => {
  test("runs deterministically from a seed", () => {
    const a = run(42, true, 200);
    const b = run(42, true, 200);
    expect(a.wave).toBe(b.wave);
    expect(a.score).toBe(b.score);
  });
  test("every disorder shows up by wave 8", () => {
    const g = run(7, true, 900);
    expect(g.wave).toBeGreaterThanOrEqual(8);
    expect(g.seen.size).toBe(Object.keys(ENEMIES).length);
  });
  test("knowing the counters beats spamming one tool", () => {
    const seeds = [1, 2, 3, 4, 5];
    const smart = seeds.map((s) => run(s, true).wave);
    const dumb = seeds.map((s) => run(s, false).wave);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    console.log(`smart waves ${smart.join(",")} (avg ${avg(smart)}) · tests-only ${dumb.join(",")} (avg ${avg(dumb)})`);
    expect(avg(smart)).toBeGreaterThan(avg(dumb) + 2);
    expect(Math.min(...smart)).toBeGreaterThanOrEqual(8); // a good player sees the whole manual
    expect(Math.max(...smart)).toBeLessThan(60); // but the night does end
  });
});
