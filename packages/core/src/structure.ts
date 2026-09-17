import path from "node:path";
import type { Plant, PlantSpecies, Pollution, Vine, Violation } from "./types.js";
import { exists, readJson } from "./fs.js";

export interface StructureFlags {
  /** Martin instability I = fanOut / (fanIn + fanOut) */
  instability: number;
  /** high fan-in + large size */
  godModule: boolean;
  /** near-zero fan-in and low churn */
  orphan: boolean;
  /** high churn relative to size (hot core) */
  hotCore: boolean;
  /** abstractness proxy: depended-on heavily but depends little */
  stableDependencyViolator: boolean;
}

/** App / page / UI roots normally have fanIn≈0 — not orphans. */
export function looksLikeAppOrEntry(input: {
  label?: string;
  path?: string;
  layer?: string;
  species?: PlantSpecies | string;
  fanOut: number;
  fileCount: number;
}): boolean {
  if (input.layer === "ui") return true;
  if (input.species === "blossom") return true;
  if (input.fanOut >= 2) return true;
  if (input.fanOut >= 1 && input.fileCount >= 8) return true;

  const hay = `${input.label ?? ""} ${input.path ?? ""}`.toLowerCase().replace(/\\/g, "/");
  return (
    /(?:^|\/|-)(apps?|web|ui|frontend|front-end|portal|admin|platform|pages?|site|spa|client|experiment|demo|playground|studio|console)(?:$|\/|-)/i.test(
      hay,
    ) ||
    /platform|frontend|webapp|website/.test(hay)
  );
}

/**
 * Shared / UI kit / viz packages often look "isolated" in the import graph
 * (edges missed, or only consumed by apps) — don't call them orphans.
 */
export function looksLikeSharedOrUiKit(input: {
  label?: string;
  path?: string;
  species?: PlantSpecies | string;
}): boolean {
  if (input.species === "blossom") return true;
  const hay = `${input.label ?? ""} ${input.path ?? ""}`.toLowerCase().replace(/\\/g, "/");
  return (
    /(?:^|\/|-)(viz|visual|graph|chart|plot|components?|component-lib|ui-kit|design|icons?|shared|common|sdk|utils?|hooks?|widgets?|editor|canvas|render(?:er)?|theme|tokens?|core-ui|frontend-lib)(?:$|\/|-)/i.test(
      hay,
    ) || /graph-viz|ui-lib|design-system/.test(hay)
  );
}

interface PkgDeps {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

/**
 * Modules declared in other workspace packages' package.json deps.
 * Catches "serves frontend" even when import edges weren't resolved.
 */
export function collectWorkspaceDeclaredDependents(
  modules: Array<{ id: string; path: string; label?: string }>,
): Set<string> {
  const nameToId = new Map<string, string>();
  for (const m of modules) {
    nameToId.set(m.id, m.id);
    if (m.label) nameToId.set(m.label, m.id);
    nameToId.set(path.basename(m.path), m.id);
    const pkgFile = path.join(m.path, "package.json");
    if (!exists(pkgFile)) continue;
    const pkg = readJson<PkgDeps>(pkgFile);
    if (pkg?.name) nameToId.set(pkg.name, m.id);
  }

  const depended = new Set<string>();
  for (const m of modules) {
    const pkgFile = path.join(m.path, "package.json");
    if (!exists(pkgFile)) continue;
    const pkg = readJson<PkgDeps>(pkgFile);
    if (!pkg) continue;
    const bags = [
      pkg.dependencies,
      pkg.devDependencies,
      pkg.peerDependencies,
      pkg.optionalDependencies,
    ];
    for (const bag of bags) {
      if (!bag) continue;
      for (const depName of Object.keys(bag)) {
        const id = nameToId.get(depName);
        if (id && id !== m.id) depended.add(id);
      }
    }
  }
  return depended;
}

export function computeStructureFlags(input: {
  fanIn: number;
  fanOut: number;
  loc: number;
  fileCount: number;
  churn: number;
  moduleCount: number;
  label?: string;
  path?: string;
  layer?: string;
  species?: PlantSpecies | string;
  /** referenced from another package.json in the workspace */
  declaredDependent?: boolean;
}): StructureFlags {
  const { fanIn, fanOut, loc, fileCount, churn, moduleCount } = input;
  const denom = fanIn + fanOut;
  const instability = denom === 0 ? 0.5 : fanOut / denom;

  const godModule =
    fanIn >= Math.max(3, Math.ceil(moduleCount * 0.35)) &&
    (loc >= 400 || fileCount >= 12 || fanIn >= 5);

  // Orphan only for true dead leaves: no import graph edges, not declared in
  // any workspace package.json, and not an app / shared UI kit / viz lib.
  const orphan =
    !input.declaredDependent &&
    !looksLikeAppOrEntry(input) &&
    !looksLikeSharedOrUiKit(input) &&
    fanIn === 0 &&
    fanOut === 0 &&
    churn < 0.08 &&
    fileCount >= 1 &&
    fileCount <= 6 &&
    loc < 400 &&
    moduleCount >= 4;

  const hotCore =
    churn >= 0.55 &&
    (loc >= 200 || fileCount >= 8) &&
    fanIn + fanOut >= 2;

  const stableDependencyViolator =
    fanIn >= 2 && instability >= 0.65 && fanOut >= 2;

  return {
    instability,
    godModule,
    orphan,
    hotCore,
    stableDependencyViolator,
  };
}

export function structureViolations(
  flags: StructureFlags,
  label: string,
): Violation[] {
  const out: Violation[] = [];
  if (flags.godModule) {
    out.push({
      ruleId: "structure:god-module",
      message: `${label} 体积/扇入过大（上帝模块）`,
      severity: "warn",
    });
  }
  if (flags.orphan) {
    out.push({
      ruleId: "structure:orphan",
      message: `${label} 无图边、未被 workspace 声明依赖，且不像共享/前端库（疑似死代码包）`,
      severity: "warn",
    });
  }
  if (flags.stableDependencyViolator) {
    out.push({
      ruleId: "structure:instability",
      message: `${label} 被多方依赖却自身不稳定（扇出过高）`,
      severity: "warn",
    });
  }
  if (flags.hotCore) {
    out.push({
      ruleId: "structure:hot-core",
      message: `${label} 大体量且近期改动密集（热点核心）`,
      severity: "warn",
    });
  }
  return out;
}

/** Diffuse pollution along vines with distance decay. */
export function diffusePollutions(
  plants: Plant[],
  vines: Vine[],
  epicenters: Array<{ id: string; reason: string; intensity?: number }>,
): Pollution[] {
  if (!epicenters.length) return [];

  const adj = new Map<string, string[]>();
  for (const v of vines) {
    if (!adj.has(v.from)) adj.set(v.from, []);
    if (!adj.has(v.to)) adj.set(v.to, []);
    adj.get(v.from)!.push(v.to);
    adj.get(v.to)!.push(v.from);
    if (v.kind === "illegal" || v.kind === "cycle") {
      adj.get(v.from)!.push(v.to);
      adj.get(v.to)!.push(v.from);
    }
  }

  const byId = new Map(plants.map((p) => [p.id, p]));
  const pollutions: Pollution[] = [];

  for (const epi of epicenters) {
    if (!byId.has(epi.id)) continue;
    const baseIntensity = epi.intensity ?? 0.72;
    pollutions.push({
      epicenter: epi.id,
      radius: 150,
      intensity: baseIntensity,
      reason: epi.reason,
    });

    const dist = new Map<string, number>();
    const q: string[] = [epi.id];
    dist.set(epi.id, 0);
    while (q.length) {
      const cur = q.shift()!;
      const d = dist.get(cur)!;
      if (d >= 2) continue;
      for (const next of adj.get(cur) ?? []) {
        if (dist.has(next)) continue;
        dist.set(next, d + 1);
        q.push(next);
      }
    }

    for (const [id, d] of dist) {
      if (d === 0) continue;
      const intensity = baseIntensity * (d === 1 ? 0.42 : 0.22);
      const radius = d === 1 ? 95 : 70;
      pollutions.push({
        epicenter: id,
        radius,
        intensity,
        reason: `受「${epi.reason}」扩散影响`,
      });
    }
  }

  const merged = new Map<string, Pollution>();
  for (const p of pollutions) {
    const prev = merged.get(p.epicenter);
    if (!prev || p.intensity > prev.intensity) merged.set(p.epicenter, p);
  }
  return [...merged.values()];
}
