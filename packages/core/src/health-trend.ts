import path from "node:path";
import { exists, readJson } from "./fs.js";
import type {
  GardenSnapshot,
  GardenTimeline,
  HealthTrend,
  HealthTrendKind,
  Plant,
  PlantState,
} from "./types.js";

const UNHEALTHY: PlantState[] = ["wilting", "dying", "entangled"];

function isUnhealthy(state: PlantState | undefined): boolean {
  return Boolean(state && UNHEALTHY.includes(state));
}

function inCycle(plant: Plant | undefined): boolean {
  if (!plant) return false;
  return plant.state === "entangled" || plant.cycleWith.length > 0;
}

export function computeHealthTrend(
  current: Plant,
  history: GardenSnapshot[],
): HealthTrend {
  const series = history
    .map((s) => s.plants.find((p) => p.id === current.id))
    .filter((p): p is Plant => Boolean(p));

  if (!series.length) {
    return {
      kind: "new",
      label: "新出现的模块",
      delta: 0,
      consecutive: 1,
    };
  }

  const prev = series[series.length - 1]!;
  const delta = current.metrics.health - prev.metrics.health;
  const older = series.length >= 2 ? series[series.length - 2] : undefined;
  const windowDelta =
    series.length >= 2
      ? current.metrics.health - series[0]!.metrics.health
      : delta;

  let consecutive = 1;
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i]!.state === current.state) consecutive += 1;
    else break;
  }

  const cycleNow = inCycle(current);
  const cycleBefore = inCycle(prev);
  if (cycleNow && !cycleBefore) {
    return {
      kind: "new-cycle",
      label: "循环刚出现",
      delta,
      consecutive: 1,
    };
  }

  const recentStates = [...series.slice(-2), current].map((p) => p.state);
  if (
    recentStates.length >= 3 &&
    recentStates.every((s) => isUnhealthy(s))
  ) {
    const days = recentStates.length;
    return {
      kind: "chronic-wilt",
      label: days >= 3 ? `已连续 ${days} 帧枯萎/缠绕` : "持续枯萎",
      delta,
      consecutive: days,
    };
  }

  if (delta <= -0.08 || windowDelta <= -0.12) {
    const stillDown =
      !older || current.metrics.health <= older.metrics.health + 0.02;
    if (stillDown) {
      return {
        kind: "declining",
        label: `健康下滑 ${Math.round(Math.abs(delta) * 100)}%`,
        delta,
        consecutive,
      };
    }
  }

  if (
    (delta >= 0.08 || windowDelta >= 0.12) &&
    (isUnhealthy(prev.state) || current.metrics.health > prev.metrics.health)
  ) {
    return {
      kind: "recovering",
      label: `健康回升 ${Math.round(delta * 100)}%`,
      delta,
      consecutive,
    };
  }

  return {
    kind: "stable",
    label: "趋势平稳",
    delta,
    consecutive,
  };
}

const NOTABLE: HealthTrendKind[] = [
  "declining",
  "chronic-wilt",
  "new-cycle",
  "recovering",
];

export function applyHealthTrends(
  plants: Plant[],
  history: GardenSnapshot[],
): number {
  if (!history.length) return 0;
  let notable = 0;
  for (const plant of plants) {
    const trend = computeHealthTrend(plant, history);
    plant.trend = trend;
    plant.metrics.healthDelta = trend.delta;
    if (!NOTABLE.includes(trend.kind)) continue;
    notable += 1;
    const already = plant.violations.some((v) => v.ruleId === `trend:${trend.kind}`);
    if (!already) {
      plant.violations.push({
        ruleId: `trend:${trend.kind}`,
        message: trend.label,
        severity: "warn",
      });
    }
  }
  return notable;
}

/** Oldest → newest. Mutates each snapshot using previous frames as history. */
export function annotateSnapshotsWithTrends(snapshots: GardenSnapshot[]): void {
  const ordered = [...snapshots].sort((a, b) =>
    a.meta.capturedAt.localeCompare(b.meta.capturedAt),
  );
  for (let i = 0; i < ordered.length; i++) {
    const snap = ordered[i]!;
    const history = ordered.slice(0, i);
    const n = applyHealthTrends(snap.plants, history);
    if (n) {
      snap.meta.notes = [
        ...(snap.meta.notes ?? []).filter((x) => !x.startsWith("健康趋势")),
        `健康趋势 ${n} 株有变化（下滑/回升/新循环）`,
      ];
    }
    // refresh hotspot reasons from trends
    if (snap.report) {
      for (const p of snap.plants) {
        if (!p.trend || !NOTABLE.includes(p.trend.kind)) continue;
        const hit = snap.report.hotspots.find((h) => h.id === p.id);
        if (hit) {
          if (!hit.reason.includes(p.trend.label)) {
            hit.reason = `${p.trend.label} · ${hit.reason}`;
          }
        } else {
          snap.report.hotspots.unshift({
            id: p.id,
            label: p.label,
            reason: p.trend.label,
          });
        }
      }
      snap.report.hotspots = snap.report.hotspots.slice(0, 12);
    }
  }
}

export function loadHistorySnapshots(
  rootPath: string,
  limit = 10,
): GardenSnapshot[] {
  const index = path.join(rootPath, ".flora", "timeline.json");
  if (!exists(index)) return [];
  const timeline = readJson<GardenTimeline>(index);
  if (!timeline?.frames?.length) return [];
  const today = new Date().toISOString().slice(0, 10);
  const frames = timeline.frames
    .filter((f) => f.date !== today)
    .slice(-limit);
  const out: GardenSnapshot[] = [];
  for (const f of frames) {
    const file = path.isAbsolute(f.snapshotRef)
      ? f.snapshotRef
      : path.join(rootPath, f.snapshotRef);
    const snap = readJson<GardenSnapshot>(file);
    if (snap) out.push(snap);
  }
  return out;
}
