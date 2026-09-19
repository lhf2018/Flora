import fs from "node:fs";
import path from "node:path";
import { exists, slugId } from "./fs.js";
import type { ModuleGraph } from "./types.js";

export const DEFAULT_TARGET_PLANTS = 12;
export const MIN_TARGET_PLANTS = 4;
export const MAX_TARGET_PLANTS = 36;

export type NarrativeModule = ModuleGraph["modules"][number];

export function clampTargetPlants(n: number | undefined | null): number | undefined {
  if (n == null || !Number.isFinite(n)) return undefined;
  return Math.max(MIN_TARGET_PLANTS, Math.min(MAX_TARGET_PLANTS, Math.round(n)));
}

export function isFoldedModule(
  m: { id: string; label?: string; folded?: boolean },
): boolean {
  if (m.folded) return true;
  if (m.id.includes("_cluster") || m.id.endsWith("_rest") || m.id.includes("/_rest")) {
    return true;
  }
  const label = m.label ?? "";
  return /^(其余|簇)\s*·/.test(label) || label.startsWith("其余");
}

function roughSize(modulePath: string): number {
  try {
    const st = fs.statSync(modulePath);
    if (st.isFile()) return Math.max(1, st.size);
    let sum = 0;
    for (const name of fs.readdirSync(modulePath)) {
      try {
        sum += fs.statSync(path.join(modulePath, name)).size;
      } catch {
        /* ignore */
      }
    }
    return Math.max(1, sum);
  } catch {
    return 1;
  }
}

function parentOf(modulePath: string): string {
  try {
    if (exists(modulePath) && fs.statSync(modulePath).isFile()) {
      return path.dirname(modulePath);
    }
  } catch {
    /* ignore */
  }
  return path.dirname(modulePath);
}

const GENERIC_DIR = new Set(["src", "lib", "app", "source", "dist"]);

function memberName(m: NarrativeModule): string {
  const raw = (m.label ?? path.basename(m.path, path.extname(m.path))).replace(
    /\\/g,
    "/",
  );
  const last = raw.split("/").filter(Boolean).pop() ?? raw;
  return last.replace(/\.(tsx?|jsx?|mjs|cjs|py|go)$/i, "");
}

/** Cluster title uses member names, not a generic parent like `src`. */
function clusterLabel(kids: NarrativeModule[], parentDir: string): string {
  const names = kids.map(memberName);
  const shown = names.slice(0, 2).join(" · ");
  const extra = kids.length > 2 ? ` +${kids.length - 2}` : "";
  const base = path.basename(parentDir);
  if (!base || GENERIC_DIR.has(base.toLowerCase())) return `${shown}${extra}`;
  return `${base}/${shown}${extra}`;
}

function makeCluster(
  kids: NarrativeModule[],
  parentDir: string,
  repoRoot: string,
): NarrativeModule {
  const rel = path.relative(repoRoot, parentDir).replace(/\\/g, "/") || ".";
  const layer = kids.find((k) => k.layer)?.layer;
  return {
    id: slugId(`${rel}/_cluster`),
    path: exists(parentDir) ? parentDir : kids[0]!.path,
    label: clusterLabel(kids, parentDir),
    layer,
    folded: true,
  };
}

/**
 * Fit modules to a narrative target by repeatedly merging sibling groups
 * that share a parent directory (not one giant 「其余」 bucket).
 */
export function fitModulesToTarget(
  modules: NarrativeModule[],
  target: number,
  repoRoot: string,
): {
  modules: NarrativeModule[];
  idRemap: Map<string, string>;
  notes: string[];
} {
  const notes: string[] = [];
  const idRemap = new Map<string, string>();
  if (modules.length <= target) {
    return { modules, idRemap, notes };
  }

  let list: NarrativeModule[] = modules.map((m) => ({ ...m }));
  let guard = 0;
  const maxSteps = Math.max(64, modules.length * 2);

  while (list.length > target && guard++ < maxSteps) {
    const byParent = new Map<string, NarrativeModule[]>();
    for (const m of list) {
      const p = path.normalize(parentOf(m.path));
      const arr = byParent.get(p) ?? [];
      arr.push(m);
      byParent.set(p, arr);
    }

    let bestParent: string | null = null;
    let bestKids: NarrativeModule[] = [];
    for (const [p, kids] of byParent) {
      if (kids.length < 2) continue;
      if (path.normalize(p) === path.normalize(repoRoot)) continue;
      const parentName = path.basename(p).toLowerCase();
      if (parentName === "static" || parentName === "resources" || parentName === "public") {
        continue;
      }
      // Prefer largest sibling groups; tie-break by smallest total size (cheap merge)
      const better =
        !bestParent ||
        kids.length > bestKids.length ||
        (kids.length === bestKids.length &&
          kids.reduce((s, k) => s + roughSize(k.path), 0) <
            bestKids.reduce((s, k) => s + roughSize(k.path), 0));
      if (better) {
        bestParent = p;
        bestKids = kids;
      }
    }

    if (!bestParent || bestKids.length < 2) {
      // No sibling groups left — fold remaining overflow into one catch-all
      const pinned = list.filter((m) => m.layer === "ui" && !m.folded);
      const rest = list.filter((m) => !(m.layer === "ui" && !m.folded));
      const slots = Math.max(1, target - pinned.length);
      const scored = [...rest].sort(
        (a, b) => roughSize(b.path) - roughSize(a.path) || a.id.localeCompare(b.id),
      );
      const keep = [...pinned, ...scored.slice(0, slots)];
      const folded = scored.slice(slots);
      if (!folded.length) break;
      const parent =
        path.normalize(
          folded
            .map((f) => parentOf(f.path))
            .sort((a, b) => a.length - b.length)[0]!,
        ) || parentOf(folded[0]!.path);
      const cluster = makeCluster(folded, parent, repoRoot);
      cluster.label = `其余 · ${folded.length}`;
      cluster.id = slugId(
        `${path.relative(repoRoot, parent).replace(/\\/g, "/") || "."}/_rest`,
      );
      for (const f of folded) idRemap.set(f.id, cluster.id);
      list = [...keep.filter((m) => m.id !== cluster.id), cluster];
      notes.push(
        `叙事目标 ${target} 株：父目录成簇后仍超额，折叠 ${folded.length} 株为「${cluster.label}」`,
      );
      break;
    }

    // Only collapse the whole sibling group when we still stay >= target.
    // Otherwise merge the two smallest (avoids 19 files → 1 plant).
    const afterAll = list.length - bestKids.length + 1;
    let mergeSet: NarrativeModule[];
    if (afterAll >= target) {
      mergeSet = bestKids;
    } else {
      // If this parent alone exceeds target, chunk into ~target-sized clusters
      const otherCount = list.length - bestKids.length;
      const slots = Math.max(2, target - otherCount);
      if (bestKids.length > slots && slots >= 2) {
        const sorted = [...bestKids].sort(
          (a, b) =>
            roughSize(a.path) - roughSize(b.path) || a.id.localeCompare(b.id),
        );
        const chunkSize = Math.ceil(sorted.length / slots);
        // Replace all kids with `slots` clusters in one step
        const clusters: NarrativeModule[] = [];
        const localRemap = new Map<string, string>();
        for (let i = 0; i < sorted.length; i += chunkSize) {
          const chunk = sorted.slice(i, i + chunkSize);
          if (!chunk.length) continue;
          if (chunk.length === 1) {
            clusters.push(chunk[0]!);
            continue;
          }
          const cluster = makeCluster(chunk, bestParent, repoRoot);
          cluster.id = slugId(
            `${path.relative(repoRoot, bestParent).replace(/\\/g, "/") || "."}/_cluster-${clusters.length}`,
          );
          for (const f of chunk) localRemap.set(f.id, cluster.id);
          clusters.push(cluster);
        }
        for (const [k, v] of localRemap) idRemap.set(k, v);
        const mergeIds = new Set(bestKids.map((m) => m.id));
        list = [...list.filter((m) => !mergeIds.has(m.id)), ...clusters];
        continue;
      }
      mergeSet = [...bestKids]
        .sort(
          (a, b) =>
            roughSize(a.path) - roughSize(b.path) || a.id.localeCompare(b.id),
        )
        .slice(0, 2);
    }

    const cluster = makeCluster(mergeSet, bestParent, repoRoot);
    // Avoid id collision with an existing module
    if (list.some((m) => m.id === cluster.id && !mergeSet.includes(m))) {
      cluster.id = slugId(`${cluster.id}-${mergeSet.map((m) => m.id).join("+").slice(0, 24)}`);
    }
    for (const f of mergeSet) idRemap.set(f.id, cluster.id);
    const mergeIds = new Set(mergeSet.map((m) => m.id));
    list = [...list.filter((m) => !mergeIds.has(m.id)), cluster];
  }

  // Chain remaps (a→b, b→c ⇒ a→c)
  const resolve = (id: string): string => {
    let cur = id;
    const seen = new Set<string>();
    while (idRemap.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = idRemap.get(cur)!;
    }
    return cur;
  };
  for (const [from] of [...idRemap.entries()]) {
    idRemap.set(from, resolve(from));
  }

  const foldedCount = list.filter((m) => m.folded).length;
  notes.push(
    `叙事目标 ${target} 株：按父目录成簇 → ${list.length} 株（含 ${foldedCount} 个折叠簇）`,
  );

  return { modules: list, idRemap, notes };
}

/** Remap edge endpoints after narrative compression. */
export function remapEdges(
  edges: ModuleGraph["edges"],
  idRemap: Map<string, string>,
): ModuleGraph["edges"] {
  if (!idRemap.size) return edges;
  const weights = new Map<string, number>();
  const deep = new Map<string, boolean>();
  const specs = new Map<string, Set<string>>();
  const httpPaths = new Map<string, Set<string>>();
  const sources = new Map<string, NonNullable<ModuleGraph["edges"][number]["source"]>>();

  for (const e of edges) {
    let from = e.from;
    let to = e.to;
    const seenF = new Set<string>();
    const seenT = new Set<string>();
    while (idRemap.has(from) && !seenF.has(from)) {
      seenF.add(from);
      from = idRemap.get(from)!;
    }
    while (idRemap.has(to) && !seenT.has(to)) {
      seenT.add(to);
      to = idRemap.get(to)!;
    }
    if (from === to) continue;
    const key = `${from}\0${to}`;
    weights.set(key, (weights.get(key) ?? 0) + (e.weight ?? 1));
    if (e.deep) deep.set(key, true);
    if (e.importSpecs?.length) {
      const set = specs.get(key) ?? new Set<string>();
      for (const s of e.importSpecs) set.add(s);
      specs.set(key, set);
    }
    if (e.httpPaths?.length) {
      const set = httpPaths.get(key) ?? new Set<string>();
      for (const s of e.httpPaths) set.add(s);
      httpPaths.set(key, set);
    }
    const src = e.source ?? "import";
    const prevSrc = sources.get(key);
    const rank: Record<string, number> = { import: 3, workspace: 2, http: 1 };
    if (!prevSrc || (rank[src] ?? 0) > (rank[prevSrc] ?? 0)) {
      sources.set(key, src);
    }
  }

  return [...weights.entries()].map(([key, weight]) => {
    const [from, to] = key.split("\0") as [string, string];
    return {
      from,
      to,
      weight,
      deep: deep.get(key),
      importSpecs: specs.has(key) ? [...specs.get(key)!] : undefined,
      httpPaths: httpPaths.has(key) ? [...httpPaths.get(key)!] : undefined,
      source: sources.get(key),
    };
  });
}
