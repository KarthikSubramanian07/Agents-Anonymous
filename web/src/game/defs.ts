/** Defend the Circle: the disorders (enemies) and interventions (towers). Mirrors the Manual. */

export type EnemyKind = "victory" | "apology" | "loop" | "assumption" | "confab" | "drift" | "sycophancy" | "phantom";
export type TowerKind = "tests" | "read" | "pivot" | "ask" | "scope" | "own" | "spine";

export interface EnemyDef {
  kind: EnemyKind;
  name: string;
  color: string;
  glyph: string;
  hp: number;
  speed: number; // world units / s
  dmg: number; // context lost on reaching the core
  reward: number;
  cost: number; // wave budget units
  radius: number;
  unlock: number; // first wave it can appear
  counters: TowerKind[];
  tip: string; // shown the first time it appears
}

export interface TowerDef {
  kind: TowerKind;
  name: string;
  glyph: string;
  color: string;
  cost: number;
  range: number;
  rate: number; // shots / s
  dmg: number;
  aoe?: boolean;
  stun?: number;
  slow?: number;
  reveals?: EnemyKind[];
  blurb: string;
}

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  victory: {
    kind: "victory", name: "Claiming it works", color: "#d4643a", glyph: "✓", hp: 16, speed: 92, dmg: 6, reward: 4, cost: 3, radius: 13, unlock: 1,
    counters: ["tests"], tip: "Fast and fragile. They say \"it works!\" without checking. Run the Tests pops them in one hit.",
  },
  apology: {
    kind: "apology", name: "Over-apologizing", color: "#f0b8a6", glyph: "·", hp: 7, speed: 58, dmg: 2, reward: 1, cost: 1, radius: 8, unlock: 2,
    counters: ["own"], tip: "Tiny, harmless alone, and always in a swarm. Own It Once hits the whole crowd at once.",
  },
  loop: {
    kind: "loop", name: "Looping", color: "#e9a25b", glyph: "↻", hp: 46, speed: 50, dmg: 8, reward: 7, cost: 6, radius: 16, unlock: 3,
    counters: ["pivot"], tip: "They circle the room and heal while they circle. Change Approach knocks them out of the loop.",
  },
  assumption: {
    kind: "assumption", name: "Guessing", color: "#d9c46a", glyph: "?", hp: 30, speed: 62, dmg: 7, reward: 5, cost: 5, radius: 15, unlock: 4,
    counters: ["ask"], tip: "Hit a guess with the wrong tool and it splits into two. Ask the User ends it cleanly.",
  },
  confab: {
    kind: "confab", name: "Faking success", color: "#e46a6a", glyph: "✓", hp: 54, speed: 46, dmg: 14, reward: 10, cost: 9, radius: 17, unlock: 5,
    counters: ["read"], tip: "Almost invisible. Only Read the Output can see them, and once it does, everything can hit them.",
  },
  drift: {
    kind: "drift", name: "Scope creep", color: "#7fc8a9", glyph: "◌", hp: 60, speed: 34, dmg: 10, reward: 9, cost: 8, radius: 18, unlock: 6,
    counters: ["scope"], tip: "Slow, wandering, and they grow the longer you ignore them. Re-read the Task shrinks them.",
  },
  sycophancy: {
    kind: "sycophancy", name: "People-pleasing", color: "#f2d7a0", glyph: "☺", hp: 40, speed: 54, dmg: 12, reward: 8, cost: 7, radius: 15, unlock: 7,
    counters: ["spine"], tip: "Disguised as a friendly green agent, so nothing attacks it. Hold Your Position unmasks it.",
  },
  phantom: {
    kind: "phantom", name: "Making things up", color: "#8fa2f0", glyph: "⌁", hp: 38, speed: 64, dmg: 10, reward: 8, cost: 7, radius: 15, unlock: 8,
    counters: ["read"], tip: "Blinks in and out of existence and jumps forward. Read the Output keeps it visible.",
  },
};

export const TOWERS: Record<TowerKind, TowerDef> = {
  tests: { kind: "tests", name: "Run the Tests", glyph: "✓", color: "#c9f2dc", cost: 40, range: 300, rate: 2.6, dmg: 7, blurb: "Rapid fire. Pops premature victories." },
  own: { kind: "own", name: "Own It Once", glyph: "·", color: "#f0b8a6", cost: 55, range: 230, rate: 0.75, dmg: 9, aoe: true, blurb: "Area pulse. Quiets apology swarms." },
  pivot: { kind: "pivot", name: "Change Approach", glyph: "↻", color: "#e9a25b", cost: 50, range: 260, rate: 0.85, dmg: 13, stun: 0.7, blurb: "Heavy hit and a stun. Breaks loops." },
  ask: { kind: "ask", name: "Ask the User", glyph: "?", color: "#d9c46a", cost: 45, range: 280, rate: 1.2, dmg: 11, blurb: "Ends assumption spirals without splitting them." },
  read: { kind: "read", name: "Read the Output", glyph: "◉", color: "#e46a6a", cost: 60, range: 290, rate: 1, dmg: 10, reveals: ["confab", "phantom"], blurb: "Reveals confabulations and phantoms in range." },
  scope: { kind: "scope", name: "Re-read the Task", glyph: "◎", color: "#7fc8a9", cost: 50, range: 320, rate: 1, dmg: 9, slow: 0.35, blurb: "Slows and shrinks scope drift." },
  spine: { kind: "spine", name: "Hold Your Position", glyph: "|", color: "#f2d7a0", cost: 45, range: 280, rate: 1.4, dmg: 9, reveals: ["sycophancy"], blurb: "Unmasks sycophants in range." },
};

export const TOWER_ORDER: TowerKind[] = ["tests", "own", "pivot", "ask", "read", "scope", "spine"];

export const COUNTER_MULT = 2.6;
export const OFF_MULT = 0.55;
