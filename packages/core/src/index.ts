export type {
  AggregateGranularity,
  AnalyzeOptions,
  CycleReport,
  DependencyRef,
  FrameDelta,
  GardenReport,
  GardenSnapshot,
  GardenTimeline,
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
} from "./rules.js";
export type { ArchitectureRules, ForbiddenRule, RuleLayer } from "./rules.js";
export {
  appendTimelineFrame,
  buildTimeline,
  loadTimeline,
  loadTimelineFrame,
} from "./timeline.js";
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
