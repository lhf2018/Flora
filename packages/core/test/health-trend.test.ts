import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyHealthTrends,
  computeHealthTrend,
} from "../src/health-trend.js";
import type { GardenSnapshot, Plant, PlantState } from "../src/types.js";

function plant(
  id: string,
  state: PlantState,
  health: number,
  extra: Partial<Plant> = {},
): Plant {
  return {
    id,
    label: id,
    species: "shrub",
    languages: {},
    metrics: {
      coverage: 0.8,
      coverageKnown: false,
      coupling: 0.2,
      churn: 0.1,
      ageDays: 0,
      fileCount: 3,
      loc: 100,
      fanIn: 1,
      fanOut: 1,
      importWeight: 1,
      health,
    },
    state,
    violations: [],
    dependsOn: [],
    dependedBy: [],
    cycleWith: extra.cycleWith ?? [],
    ...extra,
  };
}

function snap(plants: Plant[], day: string): GardenSnapshot {
  return {
    meta: {
      projectId: "t",
      commit: "abc",
      branch: "main",
      capturedAt: `${day}T00:00:00.000Z`,
      floraVersion: "0.1.0",
    },
    plants,
    vines: [],
    pollutions: [],
    layout: { positions: {} },
    report: {
      plantCount: plants.length,
      vineCount: 0,
      cycleCount: 0,
      cycles: [],
      stateCounts: {
        healthy: 0,
        blooming: 0,
        wilting: 0,
        dying: 0,
        entangled: 0,
      },
      topCoupled: [],
      hotspots: [],
      totalFiles: 0,
      totalLoc: 0,
      avgHealth: 0,
    },
  };
}

describe("computeHealthTrend", () => {
  it("marks new modules when history is empty of that id", () => {
    const t = computeHealthTrend(plant("a", "healthy", 0.8), []);
    assert.equal(t.kind, "new");
  });

  it("detects declining health", () => {
    const t = computeHealthTrend(plant("a", "wilting", 0.4), [
      snap([plant("a", "healthy", 0.85)], "2026-09-01"),
    ]);
    assert.equal(t.kind, "declining");
    assert.ok(t.delta < 0);
  });

  it("detects a newly appeared cycle", () => {
    const t = computeHealthTrend(
      plant("a", "entangled", 0.3, { cycleWith: ["b"] }),
      [snap([plant("a", "healthy", 0.8)], "2026-09-01")],
    );
    assert.equal(t.kind, "new-cycle");
    assert.equal(t.label, "循环刚出现");
  });

  it("detects chronic wilt across three frames", () => {
    const t = computeHealthTrend(plant("a", "wilting", 0.4), [
      snap([plant("a", "wilting", 0.42)], "2026-09-01"),
      snap([plant("a", "dying", 0.41)], "2026-09-08"),
    ]);
    assert.equal(t.kind, "chronic-wilt");
  });

  it("detects recovery", () => {
    const t = computeHealthTrend(plant("a", "healthy", 0.82), [
      snap([plant("a", "wilting", 0.4)], "2026-09-01"),
    ]);
    assert.equal(t.kind, "recovering");
  });
});

describe("applyHealthTrends", () => {
  it("writes trend + warn violation onto declining plants", () => {
    const plants = [plant("a", "wilting", 0.4)];
    const n = applyHealthTrends(plants, [
      snap([plant("a", "healthy", 0.9)], "2026-09-01"),
    ]);
    assert.equal(n, 1);
    assert.equal(plants[0]!.trend?.kind, "declining");
    assert.ok(plants[0]!.violations.some((v) => v.ruleId.startsWith("trend:")));
  });
});
