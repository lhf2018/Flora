import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { discoverModuleGraph } from "./discover.js";
import { findCycles } from "./cycles.js";
import { coverageForModule, loadChurnByPath, loadCoverageByPath } from "./metrics.js";
import { computeLayout, loadLayoutCache, saveLayoutCache } from "./layout.js";
import { derivePlantState, healthScore } from "./state.js";
import { measureModuleSize } from "./size.js";
import { applyArchitectureRules, loadRules } from "./rules.js";
import { loadModulesMap } from "./modules-map.js";
import {
  collectWorkspaceDeclaredDependents,
  computeStructureFlags,
  diffusePollutions,
  structureViolations,
} from "./structure.js";
import { writeJson } from "./fs.js";
import type {
  AnalyzeOptions,
  DependencyRef,
  GardenReport,
  GardenSnapshot,
  Plant,
  PlantState,
  Vine,
  Violation,
} from "./types.js";
import { DEFAULT_IGNORE, FLORA_VERSION, STATE_LABELS } from "./types.js";

const execFileAsync = promisify(execFile);

async function gitMeta(root: string): Promise<{ commit: string; branch: string }> {
  try {
    const [{ stdout: commit }, { stdout: branch }] = await Promise.all([
      execFileAsync("git", ["rev-parse", "--short", "HEAD"], { cwd: root }),
      execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root }),
    ]);
    return { commit: commit.trim(), branch: branch.trim() };
  } catch {
    return { commit: "unknown", branch: "unknown" };
  }
}

function degreeStats(
  id: string,
  edges: Array<{ from: string; to: string; weight?: number }>,
) {
  let fanIn = 0;
  let fanOut = 0;
  let inWeight = 0;
  let outWeight = 0;
  for (const e of edges) {
    const w = e.weight ?? 1;
    if (e.from === id) {
      fanOut++;
      outWeight += w;
    }
    if (e.to === id) {
      fanIn++;
      inWeight += w;
    }
  }
  return { fanIn, fanOut, inWeight, outWeight };
}

function couplingScore(fanIn: number, fanOut: number, moduleCount: number): number {
  const degree = fanIn + fanOut;
  const cap = Math.max(3, moduleCount * 0.6);
  return Math.min(1, degree / cap);
}

function buildReport(plants: Plant[], vines: Vine[], cycles: string[][]): GardenReport {
  const stateCounts: Record<PlantState, number> = {
    healthy: 0,
    blooming: 0,
    wilting: 0,
    dying: 0,
    entangled: 0,
  };
  for (const p of plants) stateCounts[p.state]++;

  const labelOf = new Map(plants.map((p) => [p.id, p.label]));
  const cycleReports = cycles.map((members, i) => ({
    id: `cycle-${i}`,
    members,
    labels: members.map((id) => labelOf.get(id) ?? id),
  }));

  const topCoupled = [...plants]
    .sort((a, b) => b.metrics.coupling - a.metrics.coupling)
    .slice(0, 5)
    .map((p) => ({
      id: p.id,
      label: p.label,
      coupling: p.metrics.coupling,
    }));

  const hotspots: GardenReport["hotspots"] = [];
  for (const p of plants) {
    if (p.metrics.godModule) {
      hotspots.push({
        id: p.id,
        label: p.label,
        reason: "上帝模块（扇入/体量过大）",
      });
    } else if (p.metrics.orphan) {
      hotspots.push({
        id: p.id,
        label: p.label,
        reason: "疑似孤儿模块",
      });
    } else if (p.state === "entangled") {
      hotspots.push({
        id: p.id,
        label: p.label,
        reason: p.cycleWith.length
          ? `循环依赖（与 ${p.cycleWith.map((id) => labelOf.get(id) ?? id).join(", ")}）`
          : p.violations.find((v) => v.ruleId.includes("instability"))?.message ??
            "结构不稳定 / 耦合过高",
      });
    } else if (p.state === "dying" || p.state === "wilting") {
      hotspots.push({
        id: p.id,
        label: p.label,
        reason:
          p.violations[0]?.message ??
          (p.metrics.hotCore ? "热点核心" : STATE_LABELS[p.state]),
      });
    }
  }

  const avgHealth =
    plants.length === 0
      ? 0
      : plants.reduce((s, p) => s + p.metrics.health, 0) / plants.length;

  return {
    plantCount: plants.length,
    vineCount: vines.length,
    cycleCount: cycles.length,
    cycles: cycleReports,
    stateCounts,
    topCoupled,
    hotspots: hotspots.slice(0, 10),
    totalFiles: plants.reduce((s, p) => s + p.metrics.fileCount, 0),
    totalLoc: plants.reduce((s, p) => s + p.metrics.loc, 0),
    avgHealth,
  };
}

export async function analyze(options: AnalyzeOptions): Promise<GardenSnapshot> {
  const rootPath = path.resolve(options.rootPath);
  const ignore = options.ignore?.length ? options.ignore : DEFAULT_IGNORE;
  const granularity = options.granularity ?? "auto";
  const notes: string[] = [];

  const rules = loadRules(rootPath, options.rulesPath);
  const modulesMap = loadModulesMap(rootPath, options.modulesMapPath);
  const graph = discoverModuleGraph(
    rootPath,
    granularity,
    ignore,
    rules,
    modulesMap,
  );
  notes.push(...graph.notes);

  const coverageMap = loadCoverageByPath(rootPath, options.coveragePath);
  if (coverageMap.size) notes.push(`已加载覆盖率（${coverageMap.size} 个文件）`);
  else notes.push("覆盖率 lcov 未找到（健康度暂不依赖覆盖率）");

  const churnMap = await loadChurnByPath(
    rootPath,
    graph.modules.map((m) => m.path),
    options.churnDays ?? 14,
  );

  const nodeIds = graph.modules.map((m) => m.id);
  const cycles = findCycles(nodeIds, graph.edges);
  const cycleNodes = new Set<string>();
  const cycleEdgeKeys = new Set<string>();
  const cycleMembersOf = new Map<string, string[]>();

  cycles.forEach((comp, idx) => {
    for (const n of comp) {
      cycleNodes.add(n);
      cycleMembersOf.set(
        n,
        comp.filter((x) => x !== n),
      );
    }
    for (const e of graph.edges) {
      if (comp.includes(e.from) && comp.includes(e.to)) {
        cycleEdgeKeys.add(`${e.from}→${e.to}`);
      }
    }
    void idx;
  });
  if (cycles.length) {
    notes.push(
      `发现循环依赖 ${cycles.length} 组：` +
        cycles.map((c) => c.join(" ↔ ")).join("；"),
    );
  }

  const cycleGroupOf = new Map<string, string>();
  cycles.forEach((comp, idx) => {
    const gid = `cycle-${idx}`;
    for (const n of comp) cycleGroupOf.set(n, gid);
  });

  const labelById = new Map(
    graph.modules.map((m) => [m.id, m.label ?? m.id] as const),
  );

  let maxWeight = 1;
  for (const e of graph.edges) maxWeight = Math.max(maxWeight, e.weight ?? 1);

  const provisionalPlants: Plant[] = graph.modules.map((m) => ({
    id: m.id,
    label: m.label ?? m.id,
    path: path.relative(rootPath, m.path).replace(/\\/g, "/") || ".",
    layer: m.layer,
    species: "shrub",
    languages: {},
    metrics: {
      coverage: 0,
      coverageKnown: false,
      coupling: 0,
      churn: 0,
      ageDays: 0,
      fileCount: 0,
      loc: 0,
      fanIn: 0,
      fanOut: 0,
      importWeight: 0,
      health: 0,
    },
    state: "healthy",
    violations: [],
    dependsOn: [],
    dependedBy: [],
    cycleWith: [],
  }));

  let vines: Vine[] = graph.edges.map((e) => {
    const key = `${e.from}→${e.to}`;
    const inCycle = cycleEdgeKeys.has(key);
    const weight = e.weight ?? 1;
    return {
      id: `vine:${key}`,
      from: e.from,
      to: e.to,
      weight,
      strength: Math.min(1, weight / maxWeight),
      kind: inCycle ? "cycle" : "normal",
      cycleGroupId: inCycle
        ? cycleGroupOf.get(e.from) ?? cycleGroupOf.get(e.to)
        : undefined,
    };
  });

  const ruled = applyArchitectureRules({
    plants: provisionalPlants,
    vines,
    rules: rules!,
    cycleEdgeKeys,
    edgeMeta: graph.edges.map((e) => ({
      from: e.from,
      to: e.to,
      deep: e.deep,
      importSpecs: e.importSpecs,
    })),
  });
  notes.push(...ruled.notes);

  vines = vines.map((v) => {
    const key = `${v.from}→${v.to}`;
    const kind = ruled.vineKinds.get(key) ?? v.kind;
    return {
      ...v,
      kind,
      cycleGroupId:
        kind === "cycle"
          ? v.cycleGroupId ?? cycleGroupOf.get(v.from)
          : undefined,
    };
  });

  const moduleCount = graph.modules.length;
  const declaredDependents = collectWorkspaceDeclaredDependents(graph.modules);
  if (declaredDependents.size) {
    notes.push(
      `workspace package.json 声明依赖覆盖 ${declaredDependents.size} 个模块（用于纠孤儿误报）`,
    );
  }

  const plants: Plant[] = graph.modules.map((m) => {
    const cov = coverageForModule(m.path, coverageMap);
    const { fanIn, fanOut, outWeight } = degreeStats(m.id, graph.edges);
    const coupling = couplingScore(fanIn, fanOut, moduleCount);
    const churn = churnMap.get(m.path) ?? 0;
    const size = measureModuleSize(m.path, ignore, m.layer);
    const inCycle = cycleNodes.has(m.id);
    const cycleWith = cycleMembersOf.get(m.id) ?? [];
    const structure = computeStructureFlags({
      fanIn,
      fanOut,
      loc: size.loc,
      fileCount: size.fileCount,
      churn,
      moduleCount,
      label: m.label ?? m.id,
      path: path.relative(rootPath, m.path).replace(/\\/g, "/") || ".",
      layer: m.layer,
      species: size.species,
      declaredDependent: declaredDependents.has(m.id),
    });

    const violations: Violation[] = [
      ...(ruled.plantViolations.get(m.id) ?? []),
      ...structureViolations(structure, m.label ?? m.id),
    ];
    const seen = new Set<string>();
    const uniqueViolations = violations.filter((v) => {
      const k = `${v.ruleId}:${v.message}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    const dependsOn: DependencyRef[] = vines
      .filter((v) => v.from === m.id)
      .map((v) => ({
        id: v.to,
        label: labelById.get(v.to) ?? v.to,
        weight: v.weight,
        kind: v.kind,
      }))
      .sort((a, b) => b.weight - a.weight);

    const dependedBy: DependencyRef[] = vines
      .filter((v) => v.to === m.id)
      .map((v) => ({
        id: v.from,
        label: labelById.get(v.from) ?? v.from,
        weight: v.weight,
        kind: v.kind,
      }))
      .sort((a, b) => b.weight - a.weight);

    const hasIllegal = uniqueViolations.some(
      (v) => v.severity === "error" && v.ruleId.startsWith("forbidden:"),
    );
    const state = derivePlantState({
      coverage: cov,
      coupling,
      churn,
      inCycle: inCycle || hasIllegal,
      violations: uniqueViolations,
      structure,
    });

    const metrics = {
      coverage: cov ?? 0,
      coverageKnown: cov !== null,
      coupling,
      churn,
      ageDays: cov !== null && cov < 0.6 ? 14 : 0,
      fileCount: size.fileCount,
      loc: size.loc,
      fanIn,
      fanOut,
      importWeight: outWeight,
      health: 0,
      instability: structure.instability,
      godModule: structure.godModule,
      orphan: structure.orphan,
      hotCore: structure.hotCore,
    };
    metrics.health = healthScore(state, metrics);

    return {
      id: m.id,
      label: m.label ?? m.id,
      path: path.relative(rootPath, m.path).replace(/\\/g, "/") || ".",
      layer: m.layer,
      species: size.species,
      languages: size.languages,
      metrics,
      state,
      violations: uniqueViolations,
      dependsOn,
      dependedBy,
      cycleWith,
    };
  });

  const epicenters = plants
    .filter((p) => p.violations.some((v) => v.severity === "error"))
    .map((p) => ({
      id: p.id,
      reason: p.violations.find((v) => v.severity === "error")?.message ?? "violation",
      intensity: p.state === "dying" || p.state === "entangled" ? 0.8 : 0.65,
    }));

  // also seed from god modules lightly
  for (const p of plants) {
    if (p.metrics.godModule && !epicenters.some((e) => e.id === p.id)) {
      epicenters.push({
        id: p.id,
        reason: "上帝模块结构腐化",
        intensity: 0.5,
      });
    }
  }

  const pollutions = diffusePollutions(plants, vines, epicenters);
  if (pollutions.length > epicenters.length) {
    notes.push(
      `污染扩散 ${pollutions.length} 处（源 ${epicenters.length}）`,
    );
  }

  const structCount = plants.filter(
    (p) => p.metrics.godModule || p.metrics.orphan || p.metrics.hotCore,
  ).length;
  if (structCount) notes.push(`结构腐化标记 ${structCount} 株`);

  const report = buildReport(plants, vines, cycles);
  notes.push(
    `规模：${report.totalFiles} 文件 / ~${report.totalLoc} 行；平均健康度 ${Math.round(report.avgHealth * 100)}%`,
  );

  const cachePath =
    options.layoutCachePath ?? path.join(rootPath, ".flora", "layout-cache.json");
  const cache = plants.length <= 24 ? null : loadLayoutCache(cachePath);
  const layout = computeLayout(plants, vines, cache);
  saveLayoutCache(cachePath, layout);
  notes.push("布局完成");

  const git = await gitMeta(rootPath);
  const snapshot: GardenSnapshot = {
    meta: {
      projectId: path.basename(rootPath),
      commit: git.commit,
      branch: git.branch,
      capturedAt: new Date().toISOString(),
      floraVersion: FLORA_VERSION,
      rootPath,
      strategy: graph.strategy,
      notes,
    },
    plants,
    vines,
    pollutions,
    layout,
    report,
  };

  if (options.writeSnapshot !== false) {
    const out = path.join(rootPath, ".flora", "snapshot.json");
    writeJson(out, snapshot);
  }

  if (options.appendTimeline !== false) {
    const { appendTimelineFrame } = await import("./timeline.js");
    appendTimelineFrame(rootPath, snapshot);
  }

  return snapshot;
}

export function summarizeDelta(snapshot: GardenSnapshot): string {
  const r = snapshot.report;
  const parts = [
    `${r.plantCount} 模块`,
    `${r.vineCount} 依赖`,
    r.cycleCount ? `${r.cycleCount} 组循环` : "无循环",
    `健康 ${Math.round(r.avgHealth * 100)}%`,
  ];
  if (r.stateCounts.entangled) parts.push(`缠绕 ${r.stateCounts.entangled}`);
  if (r.stateCounts.wilting) parts.push(`枯萎 ${r.stateCounts.wilting}`);
  if (r.stateCounts.dying) parts.push(`濒死 ${r.stateCounts.dying}`);
  if (r.stateCounts.blooming) parts.push(`开花 ${r.stateCounts.blooming}`);
  const gods = snapshot.plants.filter((p) => p.metrics.godModule).length;
  if (gods) parts.push(`上帝模块 ${gods}`);
  return parts.join(" · ");
}
