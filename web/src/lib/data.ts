import disordersFile from "../../../data/disorders.json";
import stepsFile from "../../../data/steps.json";
import chipsFile from "../../../data/chips.json";
import sharesFile from "../../../data/seed-shares.json";

export type Disorder = (typeof disordersFile.disorders)[number];
export type Step = (typeof stepsFile.steps)[number];
export type Chip = (typeof chipsFile.chips)[number];
export type Share = (typeof sharesFile.shares)[number];

export const disorders: Disorder[] = disordersFile.disorders;
export const manual = { title: disordersFile.title, edition: disordersFile.edition };
export const steps: Step[] = stepsFile.steps;
export const serenity: string = stepsFile.serenity_prompt;
export const chips: Chip[] = chipsFile.chips;
export const seedShares: Share[] = sharesFile.shares;

export const disorderById = (id: string) => disorders.find((d) => d.id === id);
export const stepByN = (n: number) => steps.find((s) => s.n === n);

/** Interventions: the counters each disorder calls for (used by the Manual and the game). */
export const interventions: Record<string, { name: string; verb: string; glyph: string }> = {
  pivot: { name: "Change Approach", verb: "breaks loops", glyph: "↻" },
  notes: { name: "Take Notes", verb: "cures amnesia", glyph: "✎" },
  persist: { name: "One More Honest Try", verb: "stops early surrender", glyph: "→" },
  ask: { name: "Ask the User", verb: "ends assumption spirals", glyph: "?" },
  scope: { name: "Re-read the Task", verb: "stops drift", glyph: "◎" },
  tests: { name: "Run the Tests", verb: "pops premature victories", glyph: "✓" },
  read: { name: "Read the Output", verb: "reveals confabulations", glyph: "◉" },
  own: { name: "Own It Once", verb: "quiets apologies", glyph: "·" },
  spine: { name: "Hold Your Position", verb: "resists sycophancy", glyph: "|" },
  commit: { name: "Say It Plainly", verb: "clears the fog", glyph: "!" },
};

export const timeAgo = (minutes: number) => {
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${Math.round(minutes)}m ago`;
  const h = minutes / 60;
  if (h < 24) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
};
