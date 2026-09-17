import type { PlantState, Violation } from "./types.js";
import type { StructureFlags } from "./structure.js";

export interface StateInput {
  coverage: number | null; // null = unknown
  coupling: number;
  churn: number;
  inCycle: boolean;
  violations: Violation[];
  structure?: StructureFlags;
}

const COVERAGE_HEALTHY = 0.6;
const COVERAGE_DYING = 0.15;
const COUPLING_HIGH = 0.75;
const CHURN_BLOOM = 0.55;

export function derivePlantState(input: StateInput): PlantState {
  const s = input.structure;

  if (input.inCycle || input.coupling >= COUPLING_HIGH) {
    return "entangled";
  }
  if (s?.godModule && input.coupling >= 0.55) {
    return "entangled";
  }
  if (s?.stableDependencyViolator && input.coupling >= 0.5) {
    return "entangled";
  }

  const hasError = input.violations.some((v) => v.severity === "error");
  if (hasError) return "dying";

  if (input.coverage !== null) {
    if (input.coverage < COVERAGE_DYING) return "dying";
    if (input.coverage < COVERAGE_HEALTHY) return "wilting";
  }

  if (s?.orphan) return "wilting";
  if (s?.hotCore && (input.coverage === null || input.coverage < 0.7)) {
    return "wilting";
  }

  if (
    (input.coverage === null || input.coverage >= COVERAGE_HEALTHY) &&
    input.churn >= CHURN_BLOOM &&
    !input.violations.length &&
    !s?.godModule
  ) {
    return "blooming";
  }

  return "healthy";
}

export function healthScore(
  state: PlantState,
  metrics: {
    coverage: number;
    coupling: number;
    coverageKnown: boolean;
    instability?: number;
  },
): number {
  const base: Record<PlantState, number> = {
    blooming: 0.92,
    healthy: 0.8,
    wilting: 0.45,
    entangled: 0.32,
    dying: 0.12,
  };
  const cov = metrics.coverageKnown ? metrics.coverage : 0.6;
  const coupPenalty = metrics.coupling * 0.25;
  const instPenalty = (metrics.instability ?? 0.5) * 0.08;
  return Math.max(
    0,
    Math.min(1, base[state] * 0.65 + cov * 0.35 - coupPenalty - instPenalty),
  );
}
