import fs from "node:fs";
import path from "node:path";
import { exists, readJson, slugId } from "./fs.js";
import type { AggregateGranularity } from "./types.js";

export interface ModuleMergeSpec {
  id: string;
  label?: string;
  paths: string[];
  layer?: string;
}

export interface ModuleSplitSpec {
  /** directory under root to expand into child modules */
  path: string;
  /** 1 = immediate children */
  depth?: number;
  layer?: string;
}

export interface FloraModulesMap {
  /** force granularity when auto */
  granularity?: AggregateGranularity;
  ignore?: string[];
  merge?: ModuleMergeSpec[];
  split?: ModuleSplitSpec[];
  /** path aliases for discovery (prefix → target dir relative to root) */
  aliases?: Record<string, string>;
  source?: string;
}

/** Minimal YAML subset for flora.modules.yaml */
export function parseModulesYaml(text: string): FloraModulesMap {
  const out: FloraModulesMap = {};
  const lines = text.split(/\r?\n/);
  let section:
    | "none"
    | "ignore"
    | "merge"
    | "split"
    | "aliases"
    | "paths" = "none";
  let currentMerge: ModuleMergeSpec | null = null;
  let currentSplit: ModuleSplitSpec | null = null;
  let inPaths = false;

  const flushMerge = () => {
    if (currentMerge?.id && currentMerge.paths.length) {
      out.merge = out.merge ?? [];
      out.merge.push(currentMerge);
    }
    currentMerge = null;
    inPaths = false;
  };
  const flushSplit = () => {
    if (currentSplit?.path) {
      out.split = out.split ?? [];
      out.split.push(currentSplit);
    }
    currentSplit = null;
  };

  for (const raw of lines) {
    const line = raw.replace(/#.*$/, "");
    if (!line.trim()) continue;
    const indent = raw.match(/^\s*/)?.[0].length ?? 0;

    const gran = line.match(/^granularity\s*:\s*["']?(\w+)["']?/);
    if (gran) {
      out.granularity = gran[1] as AggregateGranularity;
      continue;
    }

    if (/^ignore\s*:/.test(line)) {
      flushMerge();
      flushSplit();
      section = "ignore";
      out.ignore = out.ignore ?? [];
      continue;
    }
    if (/^merge\s*:/.test(line)) {
      flushMerge();
      flushSplit();
      section = "merge";
      continue;
    }
    if (/^split\s*:/.test(line)) {
      flushMerge();
      flushSplit();
      section = "split";
      continue;
    }
    if (/^aliases\s*:/.test(line)) {
      flushMerge();
      flushSplit();
      section = "aliases";
      out.aliases = out.aliases ?? {};
      continue;
    }

    if (section === "ignore" && /^\s*-\s*/.test(line)) {
      const m = line.match(/^\s*-\s*["']?([^"'\n]+)["']?/);
      if (m) out.ignore!.push(m[1]!.trim());
      continue;
    }

    if (section === "aliases") {
      const m = line.match(/^\s*["']?([^"':\n]+)["']?\s*:\s*["']?([^"'\n]+)["']?/);
      if (m) out.aliases![m[1]!.trim()] = m[2]!.trim();
      continue;
    }

    if (section === "merge") {
      const idMatch = line.match(/^\s*-\s*id\s*:\s*["']?([^"'\n]+)["']?/);
      if (idMatch) {
        flushMerge();
        currentMerge = { id: idMatch[1]!.trim(), paths: [] };
        inPaths = false;
        continue;
      }
      if (!currentMerge && /^\s*-\s*/.test(line)) {
        currentMerge = { id: "", paths: [] };
      }
      if (!currentMerge) continue;
      const id = line.match(/^\s*id\s*:\s*["']?([^"'\n]+)["']?/);
      const label = line.match(/^\s*label\s*:\s*["']?([^"'\n]+)["']?/);
      const layer = line.match(/^\s*layer\s*:\s*["']?([^"'\n]+)["']?/);
      if (id) currentMerge.id = id[1]!.trim();
      if (label) currentMerge.label = label[1]!.trim();
      if (layer) currentMerge.layer = layer[1]!.trim();
      if (/^\s*paths\s*:/.test(line)) {
        inPaths = true;
        continue;
      }
      if (inPaths && indent >= 4) {
        const pm = line.match(/^\s*-\s*["']?([^"'\n]+)["']?/);
        if (pm) currentMerge.paths.push(pm[1]!.trim());
      }
      continue;
    }

    if (section === "split") {
      const pathInline = line.match(/^\s*-\s*path\s*:\s*["']?([^"'\n]+)["']?/);
      if (pathInline || (/^\s*-\s*/.test(line) && indent <= 2)) {
        flushSplit();
        currentSplit = { path: pathInline?.[1]?.trim() ?? "" };
        continue;
      }
      if (!currentSplit) continue;
      const p = line.match(/^\s*path\s*:\s*["']?([^"'\n]+)["']?/);
      const depth = line.match(/^\s*depth\s*:\s*(\d+)/);
      const layer = line.match(/^\s*layer\s*:\s*["']?([^"'\n]+)["']?/);
      if (p) currentSplit.path = p[1]!.trim();
      if (depth) currentSplit.depth = Number(depth[1]);
      if (layer) currentSplit.layer = layer[1]!.trim();
    }
  }
  flushMerge();
  flushSplit();
  return out;
}

export function loadModulesMap(
  rootPath: string,
  explicit?: string,
): FloraModulesMap | null {
  const candidates = explicit
    ? [explicit]
    : [
        path.join(rootPath, "flora.modules.yaml"),
        path.join(rootPath, "flora.modules.yml"),
        path.join(rootPath, "flora.modules.json"),
        path.join(rootPath, ".flora", "modules.yaml"),
      ];
  for (const file of candidates) {
    if (!exists(file)) continue;
    if (file.endsWith(".json")) {
      const json = readJson<FloraModulesMap>(file);
      if (json) return { ...json, source: file };
    } else {
      const text = fs.readFileSync(file, "utf8");
      return { ...parseModulesYaml(text), source: file };
    }
  }
  return null;
}

function matchGlob(relPath: string, pattern: string): boolean {
  const norm = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
  const pat = pattern.replace(/\\/g, "/");
  if (pat.endsWith("/**")) {
    const prefix = pat.slice(0, -3);
    return norm === prefix || norm.startsWith(prefix + "/");
  }
  if (pat.includes("*")) {
    const re = new RegExp(
      "^" +
        pat.replace(/\./g, "\\.").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*") +
        "$",
    );
    return re.test(norm);
  }
  return norm === pat || norm.startsWith(pat + "/");
}

export function pathMatchesAny(relPath: string, patterns: string[]): boolean {
  return patterns.some((p) => matchGlob(relPath, p));
}

export type DiscoverModule = {
  id: string;
  path: string;
  label?: string;
  layer?: string;
};

/** Apply merge / split / ignore overlays onto discovered modules. */
export function applyModulesMap(
  root: string,
  modules: DiscoverModule[],
  map: FloraModulesMap,
  listChildDirs: (dir: string) => string[],
): { modules: DiscoverModule[]; notes: string[] } {
  const notes: string[] = [];
  let next = [...modules];

  if (map.ignore?.length) {
    const before = next.length;
    next = next.filter((m) => {
      const rel = path.relative(root, m.path).replace(/\\/g, "/") || ".";
      return !pathMatchesAny(rel, map.ignore!);
    });
    if (next.length !== before) {
      notes.push(`modules 地图忽略 ${before - next.length} 个模块`);
    }
  }

  if (map.split?.length) {
    for (const spec of map.split) {
      const base = path.resolve(root, spec.path);
      const parentIdx = next.findIndex(
        (m) => path.normalize(m.path) === path.normalize(base),
      );
      const children = listChildDirs(base);
      if (!children.length) continue;
      if (parentIdx >= 0) next.splice(parentIdx, 1);
      for (const child of children) {
        const rel = path.relative(root, child).replace(/\\/g, "/");
        next.push({
          id: slugId(rel),
          path: child,
          label: path.basename(child),
          layer: spec.layer,
        });
      }
      notes.push(`modules 地图拆分 ${spec.path} → ${children.length} 株`);
    }
  }

  if (map.merge?.length) {
    for (const spec of map.merge) {
      const matched: DiscoverModule[] = [];
      const rest: DiscoverModule[] = [];
      for (const m of next) {
        const rel = path.relative(root, m.path).replace(/\\/g, "/") || ".";
        if (pathMatchesAny(rel, spec.paths)) matched.push(m);
        else rest.push(m);
      }
      if (!matched.length) continue;
      // representative path = longest common / first match
      const rep = matched[0]!;
      rest.push({
        id: slugId(spec.id),
        path: rep.path,
        label: spec.label ?? spec.id,
        layer: spec.layer ?? rep.layer,
      });
      next = rest;
      notes.push(
        `modules 地图合并 ${matched.map((m) => m.label ?? m.id).join("+")} → ${spec.label ?? spec.id}`,
      );
    }
  }

  return { modules: next, notes };
}
