import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { exists, readJson, writeJson } from "./fs.js";
import { analyze } from "./analyze.js";
import { analyzeAtRef } from "./ref-analyze.js";
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

export interface TimelineProgress {
  phase: "sample" | "analyze" | "approx" | "done";
  done: number;
  total: number;
  label: string;
  cached?: number;
}

function commitCacheKey(
  sha: string,
  granularity: string,
  targetPlants?: number,
): string {
  const t = targetPlants ?? "default";
  return `${sha.slice(0, 12)}-${granularity}-t${t}`;
}

function commitCachePath(rootPath: string, key: string): string {
  return path.join(rootPath, ".flora", "commit-cache", `${key}.json`);
}

function loadCommitCache(
  rootPath: string,
  sha: string,
  granularity: string,
  targetPlants?: number,
): GardenSnapshot | null {
  const file = commitCachePath(
    rootPath,
    commitCacheKey(sha, granularity, targetPlants),
  );
  if (!exists(file)) return null;
  return readJson<GardenSnapshot>(file);
}

function saveCommitCache(
  rootPath: string,
  sha: string,
  granularity: string,
  targetPlants: number | undefined,
  snap: GardenSnapshot,
) {
  const dir = path.join(rootPath, ".flora", "commit-cache");
  fs.mkdirSync(dir, { recursive: true });
  writeJson(
    commitCachePath(rootPath, commitCacheKey(sha, granularity, targetPlants)),
    snap,
  );
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}

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
  void historyDir;
  return timeline;
}

interface CommitSample {
  sha: string;
  date: string;
}

/** Evenly sample commits from the last `days` for timeline frames. */
async function sampleCommits(
  root: string,
  days: number,
  frames: number,
): Promise<CommitSample[]> {
  const since = dateKey(addDays(new Date(), -days));
  const { stdout } = await execFileAsync(
    "git",
    ["log", `--since=${since}`, "--format=%H|%as", "--reverse"],
    { cwd: root, maxBuffer: 8 * 1024 * 1024 },
  );
  const all: CommitSample[] = [];
  const seenDate = new Set<string>();
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [sha, date] = line.split("|");
    if (!sha || !date) continue;
    // one commit per calendar day (last of that day wins via overwrite later)
    all.push({ sha: sha.trim(), date: date.trim() });
  }
  if (!all.length) return [];

  // Prefer unique dates, keeping last commit of each day
  const byDate = new Map<string, CommitSample>();
  for (const c of all) byDate.set(c.date, c);
  const unique = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));

  if (unique.length <= frames) return unique;

  const picked: CommitSample[] = [];
  for (let i = 0; i < frames; i++) {
    const t = i / Math.max(1, frames - 1);
    const idx = Math.round(t * (unique.length - 1));
    const c = unique[idx]!;
    if (!picked.some((p) => p.sha === c.sha)) picked.push(c);
  }
  // ensure last is newest
  const last = unique[unique.length - 1]!;
  if (picked[picked.length - 1]?.sha !== last.sha) {
    picked[picked.length - 1] = last;
  }
  void seenDate;
  return picked;
}

function retagSnapshot(
  snap: GardenSnapshot,
  opts: {
    projectId: string;
    rootPath: string;
    commit: string;
    date: string;
    note: string;
  },
): GardenSnapshot {
  return {
    ...snap,
    meta: {
      ...snap.meta,
      projectId: opts.projectId,
      rootPath: opts.rootPath,
      commit: opts.commit.slice(0, 7),
      capturedAt: `${opts.date}T12:00:00.000Z`,
      notes: [...(snap.meta.notes ?? []), opts.note],
    },
  };
}

function cloneSnapshotApprox(
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
      notes: [...(base.meta.notes ?? []), `活跃度近似切片 ${date}`],
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
      const first = lines[lines.length - 1];
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
      ["log", `--since=${since}`, `--until=${until}`, "--oneline", "--", rel],
      { cwd: root, maxBuffer: 2 * 1024 * 1024 },
    );
    return stdout.split(/\r?\n/).filter((l) => l.trim()).length;
  } catch {
    return 0;
  }
}

/** Fallback: birth/activity approximation without checkout. */
async function buildApproxTimeline(options: {
  rootPath: string;
  days: number;
  frameCount: number;
  granularity: AggregateGranularity;
  targetPlants?: number;
  current: GardenSnapshot;
}): Promise<GardenSnapshot[]> {
  const { rootPath, days, frameCount, current } = options;
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

      const activity = Math.min(1, touches / 8);
      plant.metrics.churn = activity;
      if (i < frameCount - 1) {
        if (activity < 0.15 && plant.state === "blooming") plant.state = "healthy";
        if (activity < 0.05 && ageDays > 20 && plant.state === "healthy") {
          plant.state = "wilting";
          plant.metrics.health = Math.min(plant.metrics.health, 0.45);
        }
      }
      plants.push(plant);
    }

    const plantIds = new Set(plants.map((p) => p.id));
    let vines = current.vines.filter(
      (v) => plantIds.has(v.from) && plantIds.has(v.to),
    );
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

    snapshots.push(cloneSnapshotApprox(current, date, plants, vines));
  }

  const today = dateKey(end);
  if (!snapshots.some((s) => s.meta.capturedAt.startsWith(today))) {
    snapshots.push(current);
  } else {
    snapshots[snapshots.length - 1] = current;
  }
  return snapshots;
}

/**
 * Build a multi-day timeline.
 * Prefer real git commit worktree analysis; fall back to birth/activity approx.
 */
export async function buildTimeline(options: {
  rootPath: string;
  days?: number;
  frames?: number;
  granularity?: AggregateGranularity;
  targetPlants?: number;
  /** force approximate mode (no worktree) */
  mode?: "auto" | "commits" | "approx";
  /** parallel worktree analyses (default 2) */
  concurrency?: number;
  onProgress?: (p: TimelineProgress) => void;
}): Promise<{ timeline: GardenTimeline; snapshots: GardenSnapshot[] }> {
  const rootPath = path.resolve(options.rootPath);
  const days = options.days ?? 30;
  const frameCount = Math.max(3, Math.min(16, options.frames ?? 8));
  const granularity = options.granularity ?? "auto";
  const mode = options.mode ?? "auto";
  const concurrency = Math.max(1, Math.min(4, options.concurrency ?? 2));
  const report = options.onProgress;
  const { index } = timelinePaths(rootPath);

  report?.({
    phase: "analyze",
    done: 0,
    total: frameCount,
    label: "分析当前树…",
  });

  const current = await analyze({
    rootPath,
    granularity,
    targetPlants: options.targetPlants,
    writeSnapshot: true,
    appendTimeline: false,
  });

  let snapshots: GardenSnapshot[] = [];
  let usedCommits = false;
  let cacheHits = 0;

  if (mode !== "approx") {
    try {
      report?.({
        phase: "sample",
        done: 0,
        total: frameCount,
        label: "抽样 git 提交…",
      });
      const samples = await sampleCommits(rootPath, days, frameCount);
      if (samples.length >= 2) {
        const projectId = current.meta.projectId;
        const total = samples.length;
        // Analyze non-HEAD frames with limited parallelism + disk cache
        const work = samples.map((sample, i) => ({ sample, i }));
        const built = await mapPool(work, concurrency, async ({ sample, i }) => {
          const isLast = i === samples.length - 1;
          let snap: GardenSnapshot;
          let fromCache = false;
          if (isLast) {
            snap = retagSnapshot(current, {
              projectId,
              rootPath,
              commit: sample.sha,
              date: sample.date,
              note: `真实提交切片 HEAD ${sample.sha.slice(0, 7)}`,
            });
          } else {
            const cached = loadCommitCache(
              rootPath,
              sample.sha,
              granularity,
              options.targetPlants,
            );
            if (cached) {
              snap = retagSnapshot(cached, {
                projectId,
                rootPath,
                commit: sample.sha,
                date: sample.date,
                note: `真实提交切片 ${sample.sha.slice(0, 7)} @ ${sample.date}（缓存）`,
              });
              fromCache = true;
            } else {
              const raw = await analyzeAtRef({
                rootPath,
                ref: sample.sha,
                granularity,
                targetPlants: options.targetPlants,
              });
              saveCommitCache(
                rootPath,
                sample.sha,
                granularity,
                options.targetPlants,
                raw,
              );
              snap = retagSnapshot(raw, {
                projectId,
                rootPath,
                commit: sample.sha,
                date: sample.date,
                note: `真实提交切片 ${sample.sha.slice(0, 7)} @ ${sample.date}`,
              });
            }
          }
          if (!isLast && current.layout?.positions) {
            const positions = { ...snap.layout.positions };
            for (const [id, pos] of Object.entries(current.layout.positions)) {
              if (snap.plants.some((p) => p.id === id)) positions[id] = pos;
            }
            snap = { ...snap, layout: { ...snap.layout, positions } };
          }
          report?.({
            phase: "analyze",
            done: i + 1,
            total,
            label: fromCache
              ? `缓存命中 ${sample.sha.slice(0, 7)}`
              : `分析 ${sample.sha.slice(0, 7)}…`,
          });
          return { snap, date: sample.date, fromCache };
        });

        cacheHits = built.filter((b) => b.fromCache).length;
        for (const { snap, date } of built) {
          const rel = `.flora/history/${date}.json`;
          writeJson(path.join(rootPath, rel), snap);
          snapshots.push(snap);
        }
        usedCommits = true;
        if (cacheHits) {
          current.meta.notes = [
            ...(current.meta.notes ?? []),
            `时间轴缓存命中 ${cacheHits}/${Math.max(0, samples.length - 1)} 帧`,
          ];
        }
      }
    } catch (err) {
      console.warn(
        "[flora] commit timeline failed, falling back to approx:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  if (!usedCommits) {
    report?.({
      phase: "approx",
      done: 0,
      total: frameCount,
      label: "活跃度近似切片…",
    });
    snapshots = await buildApproxTimeline({
      rootPath,
      days,
      frameCount,
      granularity,
      targetPlants: options.targetPlants,
      current,
    });
    for (const snap of snapshots) {
      const date = snap.meta.capturedAt.slice(0, 10);
      writeJson(path.join(rootPath, `.flora/history/${date}.json`), snap);
    }
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

  const byDate = new Map<string, (typeof frames)[0]>();
  for (const f of frames) byDate.set(f.date, f);
  const unique = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));

  const timeline: GardenTimeline = {
    projectId: current.meta.projectId,
    range: {
      from: unique[0]?.date ?? dateKey(new Date()),
      to: unique[unique.length - 1]?.date ?? dateKey(new Date()),
    },
    frames: unique,
  };
  writeJson(index, timeline);

  if (usedCommits) {
    current.meta.notes = [
      ...(current.meta.notes ?? []),
      `时间轴模式：真实 git 提交（${unique.length} 帧）`,
    ];
  } else {
    current.meta.notes = [
      ...(current.meta.notes ?? []),
      `时间轴模式：活跃度近似（${unique.length} 帧）`,
    ];
  }

  report?.({
    phase: "done",
    done: unique.length,
    total: unique.length,
    label: usedCommits ? "提交切片完成" : "近似切片完成",
    cached: cacheHits,
  });

  return {
    timeline,
    snapshots: unique.map(
      (f) => loadTimelineFrame(rootPath, f.snapshotRef) ?? current,
    ),
  };
}
