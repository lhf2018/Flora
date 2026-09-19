/** Flora garden snapshot types — single source of truth for Core / Render / Surfaces */

export type PlantState =
  | "healthy"
  | "blooming"
  | "wilting"
  | "dying"
  | "entangled";

/** Visual species — driven by language / file mix (shape), not by health (color). */
export type PlantSpecies =
  | "pine" // TypeScript
  | "oak" // JavaScript
  | "willow" // Python
  | "bamboo" // Go
  | "fir" // Rust
  | "maple" // JVM / C#
  | "blossom" // UI / frontend
  | "fern" // docs
  | "cactus" // scripts / config / devops
  | "shrub"; // mixed / unknown

export type VineKind = "normal" | "illegal" | "cycle";

export type VineSource = "import" | "workspace" | "http";

export type HealthTrendKind =
  | "stable"
  | "new"
  | "declining"
  | "recovering"
  | "chronic-wilt"
  | "new-cycle";

export interface HealthTrend {
  kind: HealthTrendKind;
  label: string;
  /** health now − previous frame */
  delta: number;
  /** consecutive frames in the same state */
  consecutive: number;
}

export interface Violation {
  ruleId: string;
  message: string;
  severity: "warn" | "error";
}

export interface PlantMetrics {
  coverage: number;
  coverageKnown: boolean;
  coupling: number;
  churn: number;
  ageDays: number;
  /** source files under this module */
  fileCount: number;
  /** approximate lines of code */
  loc: number;
  /** number of modules this depends on */
  fanOut: number;
  /** number of modules that depend on this */
  fanIn: number;
  /** import edge weight sum (out) */
  importWeight: number;
  /** health 0..1 derived from state + metrics */
  health: number;
  /** health now − previous history frame (if any) */
  healthDelta?: number;
  /** Martin instability I = fanOut/(fanIn+fanOut) */
  instability?: number;
  /** structural smell flags */
  godModule?: boolean;
  orphan?: boolean;
  hotCore?: boolean;
}

export interface DependencyRef {
  id: string;
  label: string;
  weight: number;
  kind: VineKind;
  source?: VineSource;
}

export interface Plant {
  id: string;
  label: string;
  path?: string;
  layer?: string;
  /** silhouette kind from language / file types */
  species: PlantSpecies;
  /** top languages by file count, e.g. { ts: 12, css: 3 } */
  languages: Record<string, number>;
  metrics: PlantMetrics;
  state: PlantState;
  violations: Violation[];
  /** modules this plant depends on */
  dependsOn: DependencyRef[];
  /** modules that depend on this plant */
  dependedBy: DependencyRef[];
  /** other plants in the same cycle group */
  cycleWith: string[];
  /** health vs recent timeline frames */
  trend?: HealthTrend;
}

export interface Vine {
  id: string;
  from: string;
  to: string;
  strength: number;
  weight: number;
  kind: VineKind;
  cycleGroupId?: string;
  /** import graph vs HTTP/API contract */
  source?: VineSource;
  /** matched HTTP paths when source is http */
  httpPaths?: string[];
}

export interface Pollution {
  epicenter: string;
  radius: number;
  intensity: number;
  reason: string;
}

export interface LayoutHint {
  positions: Record<string, { x: number; y: number }>;
  width?: number;
  height?: number;
}

export interface CycleReport {
  id: string;
  members: string[];
  labels: string[];
}

export interface GardenReport {
  plantCount: number;
  vineCount: number;
  cycleCount: number;
  cycles: CycleReport[];
  stateCounts: Record<PlantState, number>;
  topCoupled: Array<{ id: string; label: string; coupling: number }>;
  hotspots: Array<{ id: string; label: string; reason: string }>;
  totalFiles: number;
  totalLoc: number;
  avgHealth: number;
}

export interface GardenSnapshot {
  meta: {
    projectId: string;
    commit: string;
    branch: string;
    capturedAt: string;
    floraVersion: string;
    rootPath?: string;
    strategy?: string;
    notes?: string[];
  };
  plants: Plant[];
  vines: Vine[];
  pollutions: Pollution[];
  layout: LayoutHint;
  report: GardenReport;
}

export interface FrameDelta {
  wilted: string[];
  recovered: string[];
  newPollution: string[];
  bloomed: string[];
  newCycles: string[];
}

export interface GardenTimeline {
  projectId: string;
  range: { from: string; to: string };
  frames: Array<{
    date: string;
    snapshotRef: string;
    delta?: FrameDelta;
  }>;
}

export interface ModuleGraph {
  modules: Array<{
    id: string;
    path: string;
    label?: string;
    layer?: string;
    /** narrative fold cluster — excluded from cycle detection */
    folded?: boolean;
  }>;
  edges: Array<{
    from: string;
    to: string;
    weight?: number;
    /** resolved past package public entry */
    deep?: boolean;
    importSpecs?: string[];
    source?: VineSource;
    httpPaths?: string[];
  }>;
  strategy: string;
  notes: string[];
}

export type AggregateGranularity = "auto" | "package" | "directory" | "file";

export interface AnalyzeOptions {
  rootPath: string;
  granularity?: AggregateGranularity;
  ignore?: string[];
  coveragePath?: string;
  churnDays?: number;
  layoutCachePath?: string;
  writeSnapshot?: boolean;
  rulesPath?: string;
  modulesMapPath?: string;
  /** append snapshot into .flora timeline history */
  appendTimeline?: boolean;
  /**
   * Narrative target plant count (auto granularity).
   * Sparse gardens expand toward this; dense gardens fold extras into 「其余」.
   */
  targetPlants?: number;
  /**
   * Zoom into a subdirectory / file path (absolute or relative to rootPath).
   * Analysis root becomes this path; snapshot still tagged with parent projectId.
   */
  focusPath?: string;
}

export interface LayoutCache {
  version: 1;
  positions: Record<string, { x: number; y: number }>;
}

export const FLORA_VERSION = "0.1.0";

export const DEFAULT_IGNORE = [
  "node_modules",
  "dist",
  "build",
  ".git",
  ".flora",
  "coverage",
  ".next",
  ".turbo",
  "out",
  "target",
  "__pycache__",
  ".venv",
  "venv",
];

export const STATE_LABELS: Record<PlantState, string> = {
  healthy: "健康",
  blooming: "开花",
  wilting: "枯萎",
  dying: "濒死",
  entangled: "根系缠绕",
};

export const SPECIES_LABELS: Record<PlantSpecies, string> = {
  pine: "松树 · TypeScript",
  oak: "橡树 · JavaScript",
  willow: "柳树 · Python",
  bamboo: "竹林 · Go",
  fir: "冷杉 · Rust",
  maple: "枫树 · JVM/C#",
  blossom: "花丛 · 前端/UI",
  fern: "蕨类 · 文档",
  cactus: "仙人掌 · 脚本/配置",
  shrub: "灌木 · 混合",
};
