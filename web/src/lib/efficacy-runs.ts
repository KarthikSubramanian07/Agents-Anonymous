// Build-time only (uses Vite's import.meta.glob): every efficacy run checked into evals/efficacy.
import { summarizeAll, type EfficacyRun, type EfficacySummary } from "./efficacy";

export function efficacyRuns(): EfficacySummary[] {
  const files = import.meta.glob("../../../evals/efficacy/*.json", { eager: true, import: "default" }) as Record<string, EfficacyRun>;
  return summarizeAll(Object.values(files));
}
