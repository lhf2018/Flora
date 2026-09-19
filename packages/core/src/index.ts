export type {
  AggregateGranularity,
  AnalyzeOptions,
  CycleReport,
  DependencyRef,
  FrameDelta,
  GardenReport,
  GardenSnapshot,
  GardenTimeline,
  HealthTrend,
  HealthTrendKind,
  LayoutCache,
  LayoutHint,
  ModuleGraph,
  Plant,
  PlantMetrics,
  PlantSpecies,
  PlantState,
  Pollution,
  Vine,
  VineKind,
  VineSource,
  Violation,
} from "./types.js";
export {
  DEFAULT_IGNORE,
  FLORA_VERSION,
  SPECIES_LABELS,
  STATE_LABELS,
} from "./types.js";
export { analyze, summarizeDelta } from "./analyze.js";
export { discoverModuleGraph } from "./discover.js";
export type { DiscoverOptions } from "./discover.js";
export {
  DEFAULT_TARGET_PLANTS,
  MIN_TARGET_PLANTS,
  MAX_TARGET_PLANTS,
  clampTargetPlants,
  fitModulesToTarget,
  isFoldedModule,
} from "./narrative.js";
export { findCycles } from "./cycles.js";
export {
  computeLayout,
  LAYOUT_SIZE,
  LAYER_LABELS,
  loadLayoutCache,
  saveLayoutCache,
} from "./layout.js";
export { derivePlantState, healthScore } from "./state.js";
export { deriveSpecies, primaryLanguageLabel } from "./species.js";
export {
  applyArchitectureRules,
  loadRules,
  parseRulesYaml,
  thickenRules,
} from "./rules.js";
export type { ArchitectureRules, ForbiddenRule, RuleLayer } from "./rules.js";
export {
  applyModulesMap,
  loadModulesMap,
  parseModulesYaml,
} from "./modules-map.js";
export type {
  FloraModulesMap,
  ModuleMergeSpec,
  ModuleSplitSpec,
} from "./modules-map.js";
export {
  collectWorkspaceDeclaredDependents,
  computeStructureFlags,
  diffusePollutions,
  looksLikeAppOrEntry,
  looksLikeSharedOrUiKit,
  structureViolations,
} from "./structure.js";
export {
  appendTimelineFrame,
  buildTimeline,
  loadTimeline,
  loadTimelineFrame,
} from "./timeline.js";
export type { TimelineProgress } from "./timeline.js";
export {
  analyzeAtRef,
  annotateSnapshotForDiff,
  compareRefs,
  diffGardens,
  formatDiffComment,
  listGitBranches,
} from "./compare.js";
export type { GardenDiff, GitBranchInfo, PlantChange, VineChange } from "./compare.js";
export { ALL_ADAPTERS, adapterForFile } from "./adapters.js";
export {
  buildHttpEdges,
  extractHttpClients,
  extractHttpRoutes,
  httpRoutesMatch,
  normalizeHttpPath,
} from "./api-edges.js";
export {
  annotateSnapshotsWithTrends,
  applyHealthTrends,
  computeHealthTrend,
  loadHistorySnapshots,
} from "./health-trend.js";
