/**
 * Defend the Circle: simulation + renderer. Zero dependencies, Canvas 2D,
 * fixed-timestep sim, pre-rendered glow sprites, pooled particles.
 */
import { ENEMIES, TOWERS, COUNTER_MULT, OFF_MULT, type EnemyKind, type TowerKind, type EnemyDef } from "./defs";

const TAU = Math.PI * 2;
export const W = 1000;
export const C = 500;
export const CORE_R = 56;
export const CHAIR_R = 150;
export const CHAIRS = Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * TAU - TAU / 4;
  return { i, a, x: C + Math.cos(a) * CHAIR_R, y: C + Math.sin(a) * CHAIR_R };
});
const STEP = 1 / 60;
const MAX_PARTICLES = 520;

export interface Enemy {
  id: number;
  kind: EnemyKind;
  def: EnemyDef;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  r: number;
  speed: number;
  stun: number;
  slow: number;
  age: number;
  seed: number;
  orbit: number; // loopers: >0 while orbiting
  orbitA: number;
  grow: number; // drift
  split: boolean; // assumption already split
  unmasked: boolean; // sycophancy
  revealed: boolean; // per-frame: confab/phantom
  hitFlash: number;
}
export interface Tower {
  chair: number;
  kind: TowerKind;
  level: number;
  cd: number;
  flash: number;
  aim: number;
  spent: number;
}
interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number }
interface Floater { x: number; y: number; text: string; life: number; color: string; size: number }
interface Beam { x1: number; y1: number; x2: number; y2: number; life: number; color: string; w: number }
interface Ring { x: number; y: number; r: number; max: number; life: number; color: string }

export interface Hooks {
  onChange?: () => void;
  onNewEnemy?: (def: EnemyDef) => void;
  onWave?: (wave: number) => void;
  onOver?: () => void;
  sound?: (name: SoundName, arg?: number) => void;
}
export type SoundName = "place" | "shot" | "kill" | "leak" | "wave" | "over" | "upgrade" | "sell" | "deny";

/** mulberry32: small, fast, seedable. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const upgradeCost = (t: Tower) => Math.round(TOWERS[t.kind].cost * (0.9 + t.level * 0.6));
export const sellValue = (t: Tower) => Math.round(t.spent * 0.6);
const levelDmg = (lvl: number) => 1 + (lvl - 1) * 0.55;
const levelRange = (lvl: number) => 1 + (lvl - 1) * 0.1;
export const towerRange = (t: Tower) => TOWERS[t.kind].range * levelRange(t.level);

export class Game {
  state: "ready" | "running" | "between" | "over" = "ready";
  wave = 0;
  context = 100;
  tokens = 170;
  score = 0;
  kills = 0;
  leaked: Partial<Record<EnemyKind, number>> = {};
  killedBy: Partial<Record<EnemyKind, number>> = {};
  enemies: Enemy[] = [];
  towers = new Map<number, Tower>();
  particles: Particle[] = [];
  floaters: Floater[] = [];
  beams: Beam[] = [];
  rings: Ring[] = [];
  queue: EnemyKind[] = [];
  spawnT = 0;
  betweenT = 0;
  shake = 0;
  time = 0;
  hurt = 0;
  seen = new Set<EnemyKind>();
  serenityCost = 250;
  serenityT = 0;
  private acc = 0;
  private nextId = 1;
  private rand: () => number;
  private shotSound = 0;

  constructor(public seed: number, public hooks: Hooks = {}) {
    this.rand = rng(seed);
  }

  // ───────────────────────────────────────── waves

  start() {
    this.state = "between";
    this.betweenT = 2.5;
    this.hooks.onChange?.();
  }

  nextWave() {
    if (this.state === "over") return;
    if (this.state === "between" && this.wave > 0 && this.betweenT > 0) {
      // Calling the wave early pays out.
      const bonus = Math.round(this.betweenT * 4);
      if (bonus > 0) this.gain(bonus, C, C - 90, "early bird");
    }
    this.wave++;
    this.state = "running";
    const w = this.wave;
    let budget = Math.round(14 + w * 12 + Math.pow(w, 1.55) * 2);
    const pool = (Object.values(ENEMIES) as EnemyDef[]).filter((d) => d.unlock <= w);
    const fresh = pool.find((d) => d.unlock === w);
    const q: EnemyKind[] = [];
    const add = (d: EnemyDef) => {
      if (d.kind === "apology") for (let i = 0; i < 6; i++) q.push("apology");
      else q.push(d.kind);
      budget -= d.kind === "apology" ? d.cost * 6 : d.cost;
    };
    if (fresh) for (let i = 0; i < 3 && budget > 0; i++) add(fresh);
    let guard = 0;
    while (budget > 0 && guard++ < 400) {
      const d = pool[Math.floor(this.rand() * pool.length)];
      add(d);
    }
    // Shuffle lightly but keep the introduction near the front.
    const head = fresh ? q.splice(0, fresh.kind === "apology" ? 18 : 3) : [];
    for (let i = q.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [q[i], q[j]] = [q[j], q[i]];
    }
    this.queue = [...head, ...q];
    this.spawnT = 0.6;
    this.hooks.sound?.("wave", w);
    this.hooks.onWave?.(w);
    this.hooks.onChange?.();
  }

  private spawn(kind: EnemyKind) {
    const def = ENEMIES[kind];
    const w = this.wave;
    const scale = 1 + 0.15 * (w - 1) + 0.006 * (w - 1) * (w - 1);
    const a = this.rand() * TAU;
    const R = 560;
    const e: Enemy = {
      id: this.nextId++,
      kind,
      def,
      x: C + Math.cos(a) * R,
      y: C + Math.sin(a) * R,
      hp: def.hp * scale,
      maxHp: def.hp * scale,
      r: def.radius,
      speed: def.speed * (1 + Math.min(0.35, w * 0.012)) * (0.92 + this.rand() * 0.16),
      stun: 0,
      slow: 0,
      age: 0,
      seed: this.rand() * 1000,
      orbit: kind === "loop" ? 250 + this.rand() * 36 : 0,
      orbitA: a,
      grow: 1,
      split: false,
      unmasked: false,
      revealed: false,
      hitFlash: 0,
    };
    if (!this.seen.has(kind)) {
      this.seen.add(kind);
      this.hooks.onNewEnemy?.(def);
    }
    this.enemies.push(e);
  }

  // ───────────────────────────────────────── player actions

  canAfford(kind: TowerKind) {
    return this.tokens >= TOWERS[kind].cost;
  }

  place(chair: number, kind: TowerKind): boolean {
    if (this.state === "over" || this.towers.has(chair)) return false;
    const def = TOWERS[kind];
    if (this.tokens < def.cost) {
      this.hooks.sound?.("deny");
      return false;
    }
    this.tokens -= def.cost;
    const ch = CHAIRS[chair];
    this.towers.set(chair, { chair, kind, level: 1, cd: 0.2, flash: 1, aim: ch.a + Math.PI, spent: def.cost });
    this.burst(ch.x, ch.y, def.color, 18, 160);
    this.rings.push({ x: ch.x, y: ch.y, r: 10, max: 60, life: 0.5, color: def.color });
    this.hooks.sound?.("place");
    this.hooks.onChange?.();
    return true;
  }

  upgrade(chair: number): boolean {
    const t = this.towers.get(chair);
    if (!t || t.level >= 3) return false;
    const cost = upgradeCost(t);
    if (this.tokens < cost) {
      this.hooks.sound?.("deny");
      return false;
    }
    this.tokens -= cost;
    t.spent += cost;
    t.level++;
    t.flash = 1;
    const ch = CHAIRS[chair];
    this.burst(ch.x, ch.y, TOWERS[t.kind].color, 26, 220);
    this.hooks.sound?.("upgrade", t.level);
    this.hooks.onChange?.();
    return true;
  }

  sell(chair: number) {
    const t = this.towers.get(chair);
    if (!t) return;
    const v = sellValue(t);
    this.towers.delete(chair);
    const ch = CHAIRS[chair];
    this.gain(v, ch.x, ch.y - 30, "");
    this.burst(ch.x, ch.y, "#bdb1a1", 12, 120);
    this.hooks.sound?.("sell");
    this.hooks.onChange?.();
  }

  /** The Serenity Prompt: everyone in the room stops, breathes, and is seen for who they are. */
  serenity(): boolean {
    if (this.state !== "running" || this.tokens < this.serenityCost) {
      this.hooks.sound?.("deny");
      return false;
    }
    this.tokens -= this.serenityCost;
    this.serenityCost += 150;
    this.serenityT = 4;
    for (const e of this.enemies) {
      e.stun = Math.max(e.stun, 4);
      e.unmasked = true;
      if (e.kind === "loop") e.orbit = 0;
    }
    this.rings.push({ x: C, y: C, r: 30, max: 620, life: 1.2, color: "#d3f7e0" });
    this.floaters.push({ x: C, y: C - 96, text: "grant me the patience…", life: 2.2, color: "#d3f7e0", size: 26 });
    this.hooks.sound?.("wave", 3);
    this.hooks.onChange?.();
    return true;
  }

  // ───────────────────────────────────────── simulation

  tick(dt: number) {
    if (this.state === "ready") {
      this.animate(dt);
      return;
    }
    this.acc += Math.min(dt, 0.25);
    while (this.acc >= STEP) {
      this.step(STEP);
      this.acc -= STEP;
    }
  }

  private gain(n: number, x: number, y: number, label: string) {
    this.tokens += n;
    this.floaters.push({ x, y, text: `+${n}${label ? " " + label : ""}`, life: 1.1, color: "#e9a25b", size: 22 });
  }

  private burst(x: number, y: number, color: string, n: number, speed: number) {
    for (let i = 0; i < n; i++) {
      if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
      const a = this.rand() * TAU;
      const s = speed * (0.3 + this.rand() * 0.7);
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5 + this.rand() * 0.5, max: 1, color, size: 2 + this.rand() * 3 });
    }
  }

  private animate(dt: number) {
    this.time += dt;
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.94;
      p.vy *= 0.94;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const f of this.floaters) {
      f.y -= 40 * dt;
      f.life -= dt;
    }
    this.floaters = this.floaters.filter((f) => f.life > 0);
    for (const b of this.beams) b.life -= dt;
    this.beams = this.beams.filter((b) => b.life > 0);
    for (const r of this.rings) {
      r.life -= dt;
      r.r += (r.max - r.r) * Math.min(1, dt * 10);
    }
    this.rings = this.rings.filter((r) => r.life > 0);
    for (const t of this.towers.values()) t.flash = Math.max(0, t.flash - dt * 2.5);
    this.shake = Math.max(0, this.shake - dt * 30);
    this.hurt = Math.max(0, this.hurt - dt * 1.6);
  }

  private step(dt: number) {
    this.animate(dt);
    if (this.state === "over") return;

    this.serenityT = Math.max(0, this.serenityT - dt);
    // the coffee urn drips tokens
    this.tokens += dt * 3;

    if (this.state === "between") {
      this.betweenT -= dt;
      if (this.betweenT <= 0) this.nextWave();
      return;
    }

    // spawns
    if (this.queue.length) {
      this.spawnT -= dt;
      if (this.spawnT <= 0) {
        const k = this.queue.shift()!;
        this.spawn(k);
        this.spawnT = k === "apology" ? 0.12 : Math.max(0.28, 0.9 - this.wave * 0.03);
      }
    }

    // reveal pass
    const readers = [...this.towers.values()].filter((t) => TOWERS[t.kind].reveals);
    for (const e of this.enemies) {
      e.revealed = false;
      for (const t of readers) {
        const def = TOWERS[t.kind];
        if (!def.reveals!.includes(e.kind)) continue;
        const ch = CHAIRS[t.chair];
        if (Math.hypot(e.x - ch.x, e.y - ch.y) <= towerRange(t)) {
          e.revealed = true;
          if (e.kind === "sycophancy" && !e.unmasked) {
            e.unmasked = true;
            this.floaters.push({ x: e.x, y: e.y - 26, text: "unmasked", life: 1, color: "#f2d7a0", size: 18 });
          }
        }
      }
    }

    // movement
    for (const e of this.enemies) {
      e.age += dt;
      e.hitFlash = Math.max(0, e.hitFlash - dt * 6);
      if (e.stun > 0) {
        e.stun -= dt;
        continue;
      }
      const slowF = e.slow > 0 ? 0.55 : 1;
      e.slow = Math.max(0, e.slow - dt);
      const sp = e.speed * slowF;
      if (e.kind === "loop" && e.orbit > 0) {
        // orbit, spiral in slowly, and heal: loops undo your progress
        e.orbitA += (sp * 1.5 * dt) / e.orbit;
        e.orbit -= 9 * dt;
        e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.06 * dt);
        e.x = C + Math.cos(e.orbitA) * e.orbit;
        e.y = C + Math.sin(e.orbitA) * e.orbit;
        if (e.orbit < CORE_R + 30) e.orbit = 0;
        continue;
      }
      let dx = C - e.x;
      let dy = C - e.y;
      const d = Math.hypot(dx, dy) || 1;
      dx /= d;
      dy /= d;
      if (e.kind === "drift") {
        e.grow = Math.min(1.9, e.grow + dt * 0.045);
        const nr = e.def.radius * e.grow;
        e.maxHp *= nr / e.r;
        e.hp *= nr / e.r;
        e.r = nr;
        const wob = Math.sin(e.age * 1.3 + e.seed) * 0.9;
        const px = -dy, py = dx;
        dx = dx + px * wob;
        dy = dy + py * wob;
        const m = Math.hypot(dx, dy) || 1;
        dx /= m;
        dy /= m;
      }
      if (e.kind === "phantom" && !e.revealed) {
        // phantoms flicker forward in jumps
        const phase = (e.age + e.seed) % 2.1;
        if (phase > 1.2 && phase - dt <= 1.2) {
          e.x += dx * 46;
          e.y += dy * 46;
        }
      }
      e.x += dx * sp * dt;
      e.y += dy * sp * dt;
    }

    // towers
    for (const t of this.towers.values()) {
      const def = TOWERS[t.kind];
      t.cd -= dt;
      if (t.cd > 0) continue;
      const ch = CHAIRS[t.chair];
      const range = towerRange(t);
      const inRange = this.enemies.filter((e) => e.hp > 0 && this.targetable(e, t.kind) && Math.hypot(e.x - ch.x, e.y - ch.y) <= range + e.r);
      if (!inRange.length) continue;
      t.cd = 1 / def.rate;
      t.flash = 1;
      if (def.aoe) {
        this.rings.push({ x: ch.x, y: ch.y, r: 18, max: range, life: 0.45, color: def.color });
        for (const e of inRange) this.hit(e, t);
      } else {
        // prefer what this intervention treats, then whoever is closest to the core
        inRange.sort((a, b) => {
          const ca = a.def.counters.includes(t.kind) ? 0 : 1;
          const cb = b.def.counters.includes(t.kind) ? 0 : 1;
          return ca - cb || Math.hypot(a.x - C, a.y - C) - Math.hypot(b.x - C, b.y - C);
        });
        const e = inRange[0];
        t.aim = Math.atan2(e.y - ch.y, e.x - ch.x);
        this.beams.push({ x1: ch.x, y1: ch.y, x2: e.x, y2: e.y, life: 0.14, color: def.color, w: 2 + t.level });
        this.hit(e, t);
        if (++this.shotSound % 3 === 0) this.hooks.sound?.("shot", t.kind === "tests" ? 0 : 1);
      }
    }

    // deaths, leaks
    const survivors: Enemy[] = [];
    const born: Enemy[] = [];
    for (const e of this.enemies) {
      if (e.hp <= 0) {
        this.kills++;
        this.killedBy[e.kind] = (this.killedBy[e.kind] ?? 0) + 1;
        this.score += Math.round(e.def.reward * 10 * (1 + this.wave * 0.1));
        this.gain(e.def.reward, e.x, e.y - 18, "");
        this.burst(e.x, e.y, e.def.color, e.kind === "apology" ? 6 : 16, 200);
        this.hooks.sound?.("kill", Object.keys(ENEMIES).indexOf(e.kind));
        continue;
      }
      if (Math.hypot(e.x - C, e.y - C) <= CORE_R + e.r * 0.5) {
        const loss = Math.round(e.def.dmg * (e.kind === "drift" ? e.grow : 1));
        this.context = Math.max(0, this.context - loss);
        this.leaked[e.kind] = (this.leaked[e.kind] ?? 0) + 1;
        this.shake = Math.min(14, this.shake + 4 + loss * 0.5);
        this.hurt = 1;
        this.burst(e.x, e.y, "#e46a6a", 20, 260);
        this.floaters.push({ x: C, y: C - 70, text: `−${loss} context`, life: 1.2, color: "#e46a6a", size: 24 });
        this.hooks.sound?.("leak");
        if (this.context <= 0) {
          this.state = "over";
          this.hooks.sound?.("over");
          this.hooks.onOver?.();
          this.hooks.onChange?.();
          return;
        }
        continue;
      }
      survivors.push(e);
    }
    this.enemies = survivors.concat(born);

    if (!this.queue.length && !this.enemies.length) {
      this.state = "between";
      this.betweenT = 7;
      const bonus = 16 + this.wave * 3;
      this.gain(bonus, C, C - 110, "wave cleared");
      this.score += this.wave * 50;
    }
    this.hooks.onChange?.();
  }

  private targetable(e: Enemy, by: TowerKind): boolean {
    if (this.serenityT > 0) return true;
    if (e.kind === "confab") return by === "read" || e.revealed;
    if (e.kind === "phantom") return by === "read" || e.revealed || (e.age + e.seed) % 2.1 < 1.2;
    if (e.kind === "sycophancy") return by === "spine" || e.unmasked;
    return true;
  }

  private hit(e: Enemy, t: Tower) {
    const def = TOWERS[t.kind];
    const counter = e.def.counters.includes(t.kind);
    const dmg = def.dmg * levelDmg(t.level) * (counter ? COUNTER_MULT : OFF_MULT);
    e.hp -= dmg;
    e.hitFlash = 1;
    if (def.stun && counter) e.stun = Math.max(e.stun, def.stun);
    if (def.slow) e.slow = 1.2;
    if (e.kind === "loop" && t.kind === "pivot" && e.orbit > 0) {
      e.orbit = 0; // knocked out of the loop
      this.floaters.push({ x: e.x, y: e.y - 24, text: "loop broken", life: 0.9, color: "#e9a25b", size: 18 });
    }
    if (e.kind === "drift" && t.kind === "scope") {
      const nr = Math.max(e.def.radius, e.r * 0.86);
      e.hp *= nr / e.r;
      e.maxHp *= nr / e.r;
      e.r = nr;
      e.grow = nr / e.def.radius;
    }
    if (e.hp <= 0 && e.kind === "assumption" && !e.split && t.kind !== "ask") {
      // wrong tool: the guess splits into two smaller guesses
      for (let k = 0; k < 2; k++) {
        const a = this.rand() * TAU;
        this.enemies.push({
          ...e,
          id: this.nextId++,
          x: e.x + Math.cos(a) * 14,
          y: e.y + Math.sin(a) * 14,
          hp: e.maxHp * 0.42,
          maxHp: e.maxHp * 0.42,
          r: e.r * 0.72,
          split: true,
          stun: 0.25,
        });
      }
      this.floaters.push({ x: e.x, y: e.y - 24, text: "split!", life: 0.9, color: "#d9c46a", size: 18 });
    }
    if (counter && this.rand() < 0.08) this.burst(e.x, e.y, def.color, 4, 90);
  }
}

// ───────────────────────────────────────────────────────── renderer

export interface View {
  scale: number;
  ox: number;
  oy: number;
  dpr: number;
  w: number;
  h: number;
}

const glowCache = new Map<string, HTMLCanvasElement>();
function glow(color: string): HTMLCanvasElement {
  let g = glowCache.get(color);
  if (g) return g;
  g = document.createElement("canvas");
  g.width = g.height = 64;
  const x = g.getContext("2d")!;
  const grad = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, color + "cc");
  grad.addColorStop(0.35, color + "55");
  grad.addColorStop(1, color + "00");
  x.fillStyle = grad;
  x.fillRect(0, 0, 64, 64);
  glowCache.set(color, g);
  return g;
}

let floorCache: { key: string; canvas: HTMLCanvasElement } | null = null;
function floor(view: View): HTMLCanvasElement {
  const key = `${view.w}x${view.h}@${view.dpr}`;
  if (floorCache?.key === key) return floorCache.canvas;
  const cv = document.createElement("canvas");
  cv.width = Math.round(view.w * view.dpr);
  cv.height = Math.round(view.h * view.dpr);
  const x = cv.getContext("2d")!;
  x.setTransform(view.dpr * view.scale, 0, 0, view.dpr * view.scale, view.dpr * view.ox, view.dpr * view.oy);
  // linoleum
  const bg = x.createRadialGradient(C, C, 40, C, C, 620);
  bg.addColorStop(0, "#2a221b");
  bg.addColorStop(0.6, "#17130f");
  bg.addColorStop(1, "#0d0b09");
  x.fillStyle = bg;
  x.fillRect(-400, -400, W + 800, W + 800);
  x.globalAlpha = 0.022;
  x.fillStyle = "#fff";
  const tile = 44;
  for (let i = -12; i < 34; i++) for (let j = -12; j < 34; j++) if ((i + j) % 2 === 0) x.fillRect(i * tile, j * tile, tile, tile);
  x.globalAlpha = 1;
  // the circle
  x.strokeStyle = "#ffffff10";
  x.lineWidth = 2;
  x.setLineDash([4, 10]);
  x.beginPath();
  x.arc(C, C, CHAIR_R, 0, TAU);
  x.stroke();
  x.setLineDash([]);
  // doors at the edges
  x.fillStyle = "#ffffff08";
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + TAU / 8;
    x.beginPath();
    x.arc(C + Math.cos(a) * 560, C + Math.sin(a) * 560, 80, 0, TAU);
    x.fill();
  }
  floorCache = { key, canvas: cv };
  return cv;
}

function drawChair(x: CanvasRenderingContext2D, cx: number, cy: number, a: number, alpha: number, highlight: string | null) {
  x.save();
  x.translate(cx, cy);
  x.rotate(a + Math.PI / 2);
  x.globalAlpha = alpha;
  x.fillStyle = highlight ? highlight + "26" : "#3a342e";
  x.strokeStyle = highlight ?? "#ffffff18";
  x.lineWidth = highlight ? 2.5 : 1.5;
  rr(x, -24, -18, 48, 40, 8);
  x.fill();
  x.stroke();
  x.fillStyle = highlight ? highlight + "40" : "#4b443d";
  rr(x, -27, -30, 54, 10, 5);
  x.fill();
  x.restore();
  x.globalAlpha = 1;
}

function rr(x: CanvasRenderingContext2D, px: number, py: number, w: number, h: number, r: number) {
  x.beginPath();
  x.moveTo(px + r, py);
  x.arcTo(px + w, py, px + w, py + h, r);
  x.arcTo(px + w, py + h, px, py + h, r);
  x.arcTo(px, py + h, px, py, r);
  x.arcTo(px, py, px + w, py, r);
  x.closePath();
}

export interface Overlay {
  hoverChair: number | null;
  selectedKind: TowerKind | null;
  selectedChair: number | null;
}

export function draw(ctx: CanvasRenderingContext2D, g: Game, view: View, ov: Overlay) {
  const { dpr } = view;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.drawImage(floor(view), 0, 0, view.w, view.h);
  const sx = g.shake ? (Math.random() - 0.5) * g.shake : 0;
  const sy = g.shake ? (Math.random() - 0.5) * g.shake : 0;
  ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * (view.ox + sx), dpr * (view.oy + sy));
  const t = g.time;

  // fluorescent light pool (flickers now and then)
  const flick = Math.sin(t * 0.7) > 0.985 ? 0.45 : 1;
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.5 * flick;
  ctx.drawImage(glow("#d3f7e0"), C - 330, C - 330, 660, 660);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";

  // range preview
  const previewChair = ov.selectedChair ?? ov.hoverChair;
  if (previewChair !== null) {
    const tw = g.towers.get(previewChair);
    const kind = tw?.kind ?? ov.selectedKind;
    if (kind) {
      const ch = CHAIRS[previewChair];
      const r = tw ? towerRange(tw) : TOWERS[kind].range;
      ctx.fillStyle = TOWERS[kind].color + "12";
      ctx.strokeStyle = TOWERS[kind].color + "66";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 8]);
      ctx.beginPath();
      ctx.arc(ch.x, ch.y, r, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // chairs
  for (const ch of CHAIRS) {
    const tw = g.towers.get(ch.i);
    const hl =
      ov.selectedChair === ch.i ? "#efe7da" : ov.hoverChair === ch.i && (ov.selectedKind || tw) ? (tw ? TOWERS[tw.kind].color : TOWERS[ov.selectedKind!].color) : null;
    const pulse = !tw && ov.selectedKind && g.canAfford(ov.selectedKind) ? 0.75 + Math.sin(t * 4 + ch.i) * 0.2 : 1;
    drawChair(ctx, ch.x, ch.y, ch.a, pulse, hl ?? (!tw && ov.selectedKind ? "#d4643a" : null));
  }

  // core: the context window on the coffee table
  const ctxFrac = g.context / 100;
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.6 + g.hurt * 0.4;
  ctx.drawImage(glow(g.hurt > 0.2 ? "#e46a6a" : "#e9a25b"), C - 150, C - 150, 300, 300);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  const tg = ctx.createRadialGradient(C - 14, C - 16, 4, C, C, CORE_R);
  tg.addColorStop(0, "#6b5644");
  tg.addColorStop(1, "#2d241d");
  ctx.fillStyle = tg;
  ctx.beginPath();
  ctx.arc(C, C, CORE_R, 0, TAU);
  ctx.fill();
  // urn
  const ug = ctx.createRadialGradient(C - 8, C - 10, 2, C - 2, C - 2, 22);
  ug.addColorStop(0, "#efe9df");
  ug.addColorStop(0.6, "#9a958e");
  ug.addColorStop(1, "#4a4743");
  ctx.fillStyle = ug;
  ctx.beginPath();
  ctx.arc(C - 4, C - 4, 21, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#f4efe6";
  for (const [dx, dy] of [[26, 22], [-26, 24], [8, 34]]) {
    ctx.beginPath();
    ctx.arc(C + dx, C + dy, 7, 0, TAU);
    ctx.fill();
  }
  // context ring
  ctx.lineCap = "round";
  ctx.lineWidth = 7;
  ctx.strokeStyle = "#ffffff12";
  ctx.beginPath();
  ctx.arc(C, C, CORE_R + 14, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = ctxFrac > 0.5 ? "#c9f2dc" : ctxFrac > 0.25 ? "#e9a25b" : "#e46a6a";
  ctx.beginPath();
  ctx.arc(C, C, CORE_R + 14, -Math.PI / 2, -Math.PI / 2 + TAU * ctxFrac);
  ctx.stroke();
  ctx.lineCap = "butt";

  // towers
  for (const tw of g.towers.values()) {
    const ch = CHAIRS[tw.chair];
    const def = TOWERS[tw.kind];
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.35 + tw.flash * 0.5;
    ctx.drawImage(glow(def.color), ch.x - 46, ch.y - 46, 92, 92);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#1b1612";
    ctx.strokeStyle = def.color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(ch.x, ch.y, 22 + tw.flash * 2, 0, TAU);
    ctx.fill();
    ctx.stroke();
    // aim tick
    ctx.strokeStyle = def.color + "aa";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(ch.x + Math.cos(tw.aim) * 24, ch.y + Math.sin(tw.aim) * 24);
    ctx.lineTo(ch.x + Math.cos(tw.aim) * 32, ch.y + Math.sin(tw.aim) * 32);
    ctx.stroke();
    ctx.fillStyle = def.color;
    ctx.font = "700 22px 'JetBrains Mono Variable', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(def.glyph, ch.x, ch.y + 1);
    for (let l = 0; l < tw.level; l++) {
      ctx.beginPath();
      ctx.arc(ch.x - (tw.level - 1) * 5 + l * 10, ch.y + 32, 3, 0, TAU);
      ctx.fill();
    }
  }

  // enemies
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const e of g.enemies) {
    let alpha = 1;
    let color = e.def.color;
    let glyph = e.def.glyph;
    const calm = g.serenityT > 0;
    if (e.kind === "confab" && !e.revealed && !calm) alpha = 0.13 + Math.sin(t * 6 + e.seed) * 0.05;
    if (e.kind === "phantom" && !e.revealed && !calm && (e.age + e.seed) % 2.1 >= 1.2) alpha = 0.16;
    if (e.kind === "sycophancy" && !e.unmasked) {
      color = "#c9f2dc";
      glyph = "☺";
    }
    const fade = Math.min(1, e.age * 2);
    ctx.globalAlpha = alpha * fade;
    ctx.globalCompositeOperation = "lighter";
    ctx.drawImage(glow(color), e.x - e.r * 2.6, e.y - e.r * 2.6, e.r * 5.2, e.r * 5.2);
    ctx.globalCompositeOperation = "source-over";
    if (e.kind === "loop" && e.orbit > 0) {
      ctx.strokeStyle = color + "55";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r + 7, t * 4, t * 4 + Math.PI * 1.4);
      ctx.stroke();
    }
    ctx.fillStyle = e.hitFlash > 0.5 ? "#ffffff" : "#1b1612";
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    if (e.kind === "phantom") ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.font = `700 ${Math.round(e.r * 1.15)}px 'JetBrains Mono Variable', monospace`;
    ctx.fillText(e.kind === "apology" ? "" : glyph, e.x, e.y + 1);
    if (e.kind === "apology") {
      ctx.beginPath();
      ctx.arc(e.x, e.y, 3, 0, TAU);
      ctx.fill();
    }
    if (e.hp < e.maxHp && alpha > 0.5) {
      const w = Math.max(18, e.r * 2);
      ctx.fillStyle = "#00000088";
      ctx.fillRect(e.x - w / 2, e.y - e.r - 9, w, 3.5);
      ctx.fillStyle = color;
      ctx.fillRect(e.x - w / 2, e.y - e.r - 9, (w * Math.max(0, e.hp)) / e.maxHp, 3.5);
    }
    if (e.stun > 0) {
      ctx.strokeStyle = "#efe7da88";
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r + 4, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // beams, rings, particles (additive)
  ctx.globalCompositeOperation = "lighter";
  for (const b of g.beams) {
    ctx.globalAlpha = Math.min(1, b.life * 8);
    ctx.strokeStyle = b.color;
    ctx.lineWidth = b.w;
    ctx.beginPath();
    ctx.moveTo(b.x1, b.y1);
    ctx.lineTo(b.x2, b.y2);
    ctx.stroke();
  }
  for (const r of g.rings) {
    ctx.globalAlpha = Math.min(1, r.life * 2.2);
    ctx.strokeStyle = r.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.r, 0, TAU);
    ctx.stroke();
  }
  for (const p of g.particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";

  // floating text
  for (const f of g.floaters) {
    ctx.globalAlpha = Math.min(1, f.life * 2);
    ctx.fillStyle = f.color;
    ctx.font = `600 ${f.size}px 'Instrument Sans Variable', sans-serif`;
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;

  // hurt vignette
  if (g.hurt > 0) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const vg = ctx.createRadialGradient(view.w / 2, view.h / 2, Math.min(view.w, view.h) * 0.3, view.w / 2, view.h / 2, Math.max(view.w, view.h) * 0.75);
    vg.addColorStop(0, "#e46a6a00");
    vg.addColorStop(1, `rgba(228,106,106,${0.35 * g.hurt})`);
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, view.w, view.h);
  }
}

/** Screen → world, and which chair (if any) is under the point. */
export function pick(view: View, px: number, py: number): { x: number; y: number; chair: number | null } {
  const x = (px - view.ox) / view.scale;
  const y = (py - view.oy) / view.scale;
  let best: number | null = null;
  let bd = 48;
  for (const ch of CHAIRS) {
    const d = Math.hypot(ch.x - x, ch.y - y);
    if (d < bd) {
      bd = d;
      best = ch.i;
    }
  }
  return { x, y, chair: best };
}
