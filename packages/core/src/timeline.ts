import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { exists, readJson, writeJson } from "./fs.js";
import { analyze } from "./analyze.js";
import type {
  AggregateGranularity,
  FrameDelta,
  GardenSnapshot,
  GardenTimeline,
  Plant,
  PlantState,
  Vine,
} from "./types.js";

const execFileAsync = promisify(execFile);

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function computeDelta(
  prev: GardenSnapshot | null,
  next: GardenSnapshot,
): FrameDelta {
  const prevState = new Map(prev?.plants.map((p) => [p.id, p.state]) ?? []);
  const nextState = new Map(next.plants.map((p) => [p.id, p.state]));
  const wilted: string[] = [];
  const recovered: string[] = [];
  const bloomed: string[] = [];
  for (const [id, state] of nextState) {
    const before = prevState.get(id);
    if (state === "wilting" && before !== "wilting") wilted.push(id);
    if (state === "blooming" && before !== "blooming") bloomed.push(id);
    if (
      (state === "healthy" || state === "blooming") &&
      (before === "wilting" || before === "dying" || before === "entangled")
    ) {
      recovered.push(id);
    }
  }
  const prevPoll = new Set(prev?.pollutions.map((p) => p.epicenter) ?? []);
  const newPollution = next.pollutions
    .map((p) => p.epicenter)
    .filter((id) => !prevPoll.has(id));
  const prevCycles = new Set(
    prev?.vines.filter((v) => v.kind === "cycle").map((v) => v.id) ?? [],
  );
  const newCycles = next.vines
    .filter((v) => v.kind === "cycle" && !prevCycles.has(v.id))
    .map((v) => v.id);
  return { wilted, recovered, bloomed, newPollution, newCycles };
}

export function timelinePaths(rootPath: string) {
  const dir = path.join(rootPath, ".flora");
  return {
    dir,
    historyDir: path.join(dir, "history"),
    index: path.join(dir, "timeline.json"),
  };
}

export function loadTimeline(rootPath: string): GardenTimeline | null {
  const { index } = timelinePaths(rootPath);
  if (!exists(index)) return null;
  return readJson<GardenTimeline>(index);
}

export function loadTimelineFrame(
  rootPath: string,
  snapshotRef: string,
): GardenSnapshot | null {
  const file = path.isAbsolute(snapshotRef)
    ? snapshotRef
    : path.join(rootPath, snapshotRef);
  return readJson<GardenSnapshot>(file);
}

/** Append today's snapshot into timeline history (dedupe by date). */
export function appendTimelineFrame(
  rootPath: string,
  snapshot: GardenSnapshot,
): GardenTimeline {
  const { historyDir, index } = timelinePaths(rootPath);
  const date = dateKey(new Date(snapshot.meta.capturedAt));
  const rel = `.flora/history/${date}.json`;
  writeJson(path.join(rootPath, rel), snapshot);

  let timeline = loadTimeline(rootPath);
  if (!timeline) {
    timeline = {
      projectId: snapshot.meta.projectId,
      range: { from: date, to: date },
      frames: [],
    };
  }

  const prev =
    timeline.frames.length > 0
      ? loadTimelineFrame(
          rootPath,
          timeline.frames[timeline.frames.length - 1]!.snapshotRef,
        )
      : null;

  const frame = {
    date,
    snapshotRef: rel,
    delta: computeDelta(prev, snapshot),
  };

  timeline.frames = timeline.frames.filter((f) => f.date !== date);
  timeline.frames.push(frame);
  timeline.frames.sort((a, b) => a.date.localeCompare(b.date));
  timeline.range = {
    from: timeline.frames[0]!.date,
    to: timeline.frames[timeline.frames.length - 1]!.date,
  };
  timeline.projectId = snapshot.meta.projectId;
  writeJson(index, timeline);
  return timeline;
}

async function moduleBirthDates(
  root: string,
  modulePaths: Array<{ id: string; path: string }>,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const m of modulePaths) {
    try {
      const rel = path.relative(root, m.path).replace(/\\/g, "/") || ".";
      const { stdout } = await execFileAsync(
        "git",
        ["log", "--diff-filter=A", "--format=%as", "--", rel],
        { cwd: root, maxBuffer: 2 * 1024 * 1024 },
      );
      const lines = stdout
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      const first = lines[lines.length - 1]; // oldest
      if (first) map.set(m.id, first);
    } catch {
      /* ignore */
    }
  }
  return map;
}

async function commitsTouchingUntil(
  root: string,
  modulePath: string,
  until: string,
  since: string,
): Promise<number> {
  try {
    const rel = path.relative(root, modulePath).replace(/\\/g, "/") || ".";
    const { stdout } = await execFileAsync(
      "git",
      [
        "log",
        `--since=${since}`,
        `--until=${until}`,
        "--oneline",
        "--",
        rel,
      ],
      { cwd: root, maxBuffer: 2 * 1024 * 1024 },
    );
    return stdout.split(/\r?\n/).filter((l) => l.trim()).length;
  } catch {
    return 0;
  }
}

function cloneSnapshot(
  base: GardenSnapshot,
  date: string,
  plants: Plant[],
  vines: Vine[],
): GardenSnapshot {
  const stateCounts = {
    healthy: 0,
    blooming: 0,
    wilting: 0,
    dying: 0,
    entangled: 0,
  } as Record<PlantState, number>;
  for (const p of plants) stateCounts[p.state]++;

  return {
    ...base,
    meta: {
      ...base.meta,
      capturedAt: `${date}T12:00:00.000Z`,
      notes: [...(base.meta.notes ?? []), `时间切片 ${date}`],
    },
    plants,
    vines,
    pollutions: plants
      .filter((p) => p.violations.some((v) => v.severity === "error"))
      .map((p) => ({
        epicenter: p.id,
        radius: 140,
        intensity: 0.55,
        reason: p.violations[0]?.message ?? "violation",
      })),
    layout: {
      ...base.layout,
      positions: { ...base.layout.positions },
    },
    report: {
      ...base.report,
      plantCount: plants.length,
      vineCount: vines.length,
      stateCounts,
      avgHealth:
        plants.length === 0
          ? 0
          : plants.reduce((s, p) => s + p.metrics.health, 0) / plants.length,
      totalFiles: plants.reduce((s, p) => s + p.metrics.fileCount, 0),
      totalLoc: plants.reduce((s, p) => s + p.metrics.loc, 0),
    },
  };
}

/**
 * Build a multi-day timeline from current analyze + git birth/activity.
 * Does not require checking out old commits.
 */
export async function buildTimeline(options: {
  rootPath: string;
  days?: number;
  frames?: number;
  granularity?: AggregateGranularity;
}): Promise<{ timeline: GardenTimeline; snapshots: GardenSnapshot[] }> {
  const rootPath = path.resolve(options.rootPath);
  const days = options.days ?? 30;
  const frameCount = Math.max(3, options.frames ?? 12);

  const current = await analyze({
    rootPath,
    granularity: options.granularity ?? "auto",
    writeSnapshot: true,
    appendTimeline: false,
  });

  const births = await moduleBirthDates(
    rootPath,
    current.plants.map((p) => ({
      id: p.id,
      path: path.join(rootPath, p.path ?? "."),
    })),
  );

  const end = new Date();
  const start = addDays(end, -days);
  const snapshots: GardenSnapshot[] = [];
  const { historyDir, index } = timelinePaths(rootPath);

  for (let i = 0; i < frameCount; i++) {
    const t = i / Math.max(1, frameCount - 1);
    const day = addDays(start, Math.round(days * t));
    const date = dateKey(day);
    const windowStart = dateKey(addDays(day, -14));

    const plants: Plant[] = [];
    for (const p of current.plants) {
      const birth = births.get(p.id) ?? current.meta.capturedAt.slice(0, 10);
      if (birth > date) continue;

      const abs = path.join(rootPath, p.path ?? ".");
      const touches = await commitsTouchingUntil(rootPath, abs, date, windowStart);
      const ageDays = Math.max(
        0,
        Math.floor((day.getTime() - new Date(birth).getTime()) / 86400000),
      );

      const plant: Plant = {
        ...p,
        metrics: { ...p.metrics },
        violations: [...p.violations],
        dependsOn: [...p.dependsOn],
        dependedBy: [...p.dependedBy],
        cycleWith: [...p.cycleWith],
        languages: { ...p.languages },
      };

      // historical activity reshapes health slightly toward the past
      const activity = Math.min(1, touches / 8);
      plant.metrics.churn = activity;
      if (i < frameCount - 1) {
        // past: less blooming, more wilting if idle
        if (activity < 0.15 && plant.state === "blooming") plant.state = "healthy";
        if (activity < 0.05 && ageDays > 20 && plant.state === "healthy") {
          plant.state = "wilting";
          plant.metrics.health = Math.min(plant.metrics.health, 0.45);
        }
        // cycles appear gradually — hide some cycle vines in early frames
      }
      plants.push(plant);
    }

    const plantIds = new Set(plants.map((p) => p.id));
    let vines = current.vines.filter(
      (v) => plantIds.has(v.from) && plantIds.has(v.to),
    );
    // reveal cycle vines only in later half of timeline
    if (t < 0.55) {
      vines = vines.map((v) =>
        v.kind === "cycle" ? { ...v, kind: "normal" as const } : v,
      );
      for (const p of plants) {
        if (p.state === "entangled" && t < 0.4) {
          p.state = "healthy";
          p.violations = p.violations.filter((v) => v.ruleId !== "no-cycles");
          p.metrics.health = Math.max(p.metrics.health, 0.7);
        }
      }
    }

    const snap = cloneSnapshot(current, date, plants, vines);
    const rel = `.flora/history/${date}.json`;
    writeJson(path.join(rootPath, rel), snap);
    snapshots.push(snap);
  }

  // ensure today matches latest analyze
  const today = dateKey(end);
  const todayRel = `.flora/history/${today}.json`;
  writeJson(path.join(rootPath, todayRel), current);
  if (!snapshots.some((s) => s.meta.capturedAt.startsWith(today))) {
    snapshots.push(current);
  } else {
    snapshots[snapshots.length - 1] = current;
  }

  const frames = snapshots.map((s, idx) => {
    const date = s.meta.capturedAt.slice(0, 10);
    const prev = idx > 0 ? snapshots[idx - 1]! : null;
    return {
      date,
      snapshotRef: `.flora/history/${date}.json`,
      delta: computeDelta(prev, s),
    };
  });

  // dedupe by date keeping last
  const byDate = new Map<string, (typeof frames)[0]>();
  for (const f of frames) byDate.set(f.date, f);
  const unique = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));

  const timeline: GardenTimeline = {
    projectId: current.meta.projectId,
    range: {
      from: unique[0]?.date ?? today,
      to: unique[unique.length - 1]?.date ?? today,
    },
    frames: unique,
  };
  writeJson(index, timeline);
  void historyDir;

  return {
    timeline,
    snapshots: unique.map(
      (f) => loadTimelineFrame(rootPath, f.snapshotRef) ?? current,
    ),
  };
}
