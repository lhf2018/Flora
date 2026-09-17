import type { Plant, Vine, Violation } from "./types.js";
import { exists, readJson } from "./fs.js";
import fs from "node:fs";
import path from "node:path";

export interface RuleLayer {
  name: string;
  paths: string[];
}

export interface ForbiddenRule {
  from?: string; // layer name or "*"
  to?: string;
  when?: "cycle";
  message: string;
  severity?: "warn" | "error";
}

export interface ArchitectureRules {
  layers: RuleLayer[];
  forbidden: ForbiddenRule[];
  source?: string;
}

export interface RulesResult {
  plantViolations: Map<string, Violation[]>;
  vineKinds: Map<string, "illegal" | "cycle" | "normal">;
  notes: string[];
}

/** Minimal YAML subset parser for flora.rules.yaml */
export function parseRulesYaml(text: string): ArchitectureRules {
  const layers: RuleLayer[] = [];
  const forbidden: ForbiddenRule[] = [];
  const lines = text.split(/\r?\n/);
  let section: "none" | "layers" | "forbidden" = "none";
  let currentLayer: RuleLayer | null = null;
  let currentForbidden: ForbiddenRule | null = null;
  let inPaths = false;

  const flushLayer = () => {
    if (currentLayer?.name) layers.push(currentLayer);
    currentLayer = null;
    inPaths = false;
  };
  const flushForbidden = () => {
    if (currentForbidden?.message || currentForbidden?.when || currentForbidden?.from) {
      if (!currentForbidden!.message) {
        currentForbidden!.message = currentForbidden!.when
          ? "禁止循环依赖"
          : `禁止 ${currentForbidden!.from} → ${currentForbidden!.to}`;
      }
      forbidden.push(currentForbidden!);
    }
    currentForbidden = null;
  };

  for (const raw of lines) {
    const line = raw.replace(/#.*$/, "");
    if (!line.trim()) continue;
    const indent = raw.match(/^\s*/)?.[0].length ?? 0;

    if (/^layers\s*:/.test(line)) {
      flushLayer();
      flushForbidden();
      section = "layers";
      continue;
    }
    if (/^forbidden\s*:/.test(line)) {
      flushLayer();
      flushForbidden();
      section = "forbidden";
      continue;
    }

    if (section === "layers") {
      const nameMatch = line.match(/^\s*-\s*name\s*:\s*["']?([^"'\n]+)["']?/);
      if (nameMatch) {
        flushLayer();
        currentLayer = { name: nameMatch[1]!.trim(), paths: [] };
        inPaths = false;
        continue;
      }
      if (/^\s*paths\s*:/.test(line)) {
        inPaths = true;
        continue;
      }
      if (inPaths && indent >= 4) {
        const pm = line.match(/^\s*-\s*["']?([^"'\n]+)["']?/);
        if (pm && currentLayer) currentLayer.paths.push(pm[1]!.trim());
      }
    }

    if (section === "forbidden") {
      if (/^\s*-\s*/.test(line) && indent <= 2) {
        flushForbidden();
        currentForbidden = { message: "" };
        const inlineFrom = line.match(/^\s*-\s*from\s*:\s*["']?([^"'\n]+)["']?/);
        const inlineWhen = line.match(/^\s*-\s*when\s*:\s*["']?([^"'\n]+)["']?/);
        if (inlineFrom) currentForbidden.from = inlineFrom[1]!.trim();
        if (inlineWhen) {
          currentForbidden.when = inlineWhen[1]!.trim() as "cycle";
        }
        continue;
      }
      if (!currentForbidden) currentForbidden = { message: "" };
      const from = line.match(/^\s*from\s*:\s*["']?([^"'\n]+)["']?/);
      const to = line.match(/^\s*to\s*:\s*["']?([^"'\n]+)["']?/);
      const when = line.match(/^\s*when\s*:\s*["']?([^"'\n]+)["']?/);
      const message = line.match(/^\s*message\s*:\s*["']?([^"'\n]+)["']?/);
      const severity = line.match(/^\s*severity\s*:\s*["']?([^"'\n]+)["']?/);
      if (from) currentForbidden.from = from[1]!.trim();
      if (to) currentForbidden.to = to[1]!.trim();
      if (when) currentForbidden.when = when[1]!.trim() as "cycle";
      if (message) currentForbidden.message = message[1]!.trim();
      if (severity?.[1] === "warn" || severity?.[1] === "error") {
        currentForbidden.severity = severity![1] as "warn" | "error";
      }
    }
  }
  flushLayer();
  flushForbidden();
  return { layers, forbidden };
}

export function loadRules(rootPath: string, explicit?: string): ArchitectureRules | null {
  const candidates = explicit
    ? [explicit]
    : [
        path.join(rootPath, "flora.rules.yaml"),
        path.join(rootPath, "flora.rules.yml"),
        path.join(rootPath, "flora.rules.json"),
        path.join(rootPath, ".flora", "rules.yaml"),
      ];
  for (const file of candidates) {
    if (!exists(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    if (file.endsWith(".json")) {
      const json = readJson<ArchitectureRules>(file);
      if (json) return { ...json, source: file };
    } else {
      return { ...parseRulesYaml(text), source: file };
    }
  }
  // default: cycles only
  return {
    layers: [],
    forbidden: [
      {
        when: "cycle",
        message: "禁止循环依赖",
        severity: "error",
      },
    ],
    source: "(default)",
  };
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
      "^" + pat.replace(/\./g, "\\.").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*") + "$",
    );
    return re.test(norm);
  }
  return norm === pat || norm.startsWith(pat + "/");
}

/** Assign layer from rules paths (overrides guess). */
export function layerFromRules(
  relPath: string,
  rules: ArchitectureRules,
): string | undefined {
  for (const layer of rules.layers) {
    for (const p of layer.paths) {
      if (matchGlob(relPath, p)) return layer.name;
    }
  }
  return undefined;
}

export function applyArchitectureRules(input: {
  plants: Plant[];
  vines: Vine[];
  rules: ArchitectureRules;
  cycleEdgeKeys: Set<string>;
}): RulesResult {
  const { plants, vines, rules, cycleEdgeKeys } = input;
  const plantViolations = new Map<string, Violation[]>();
  const vineKinds = new Map<string, "illegal" | "cycle" | "normal">();
  const notes: string[] = [];

  const layerOf = new Map(plants.map((p) => [p.id, p.layer]));

  for (const v of vines) {
    const key = `${v.from}→${v.to}`;
    let kind: "illegal" | "cycle" | "normal" = cycleEdgeKeys.has(key)
      ? "cycle"
      : "normal";

    for (const rule of rules.forbidden) {
      if (rule.when === "cycle") {
        if (kind === "cycle") {
          const sev = rule.severity ?? "error";
          for (const id of [v.from, v.to]) {
            const list = plantViolations.get(id) ?? [];
            if (!list.some((x) => x.ruleId === "no-cycles")) {
              list.push({
                ruleId: "no-cycles",
                message: rule.message,
                severity: sev,
              });
              plantViolations.set(id, list);
            }
          }
        }
        continue;
      }

      const fromLayer = layerOf.get(v.from);
      const toLayer = layerOf.get(v.to);
      const fromOk =
        !rule.from || rule.from === "*" || rule.from === fromLayer;
      const toOk = !rule.to || rule.to === "*" || rule.to === toLayer;
      if (fromOk && toOk && rule.from && rule.to) {
        kind = "illegal";
        const sev = rule.severity ?? "error";
        const msg =
          rule.message ||
          `跨层违规: ${fromLayer ?? "?"} → ${toLayer ?? "?"}`;
        for (const id of [v.from, v.to]) {
          const list = plantViolations.get(id) ?? [];
          list.push({
            ruleId: `forbidden:${rule.from}->${rule.to}`,
            message: msg,
            severity: sev,
          });
          plantViolations.set(id, list);
        }
      }
    }

    vineKinds.set(key, kind);
  }

  const illegal = [...vineKinds.values()].filter((k) => k === "illegal").length;
  if (rules.source) notes.push(`架构规则: ${rules.source}`);
  if (illegal) notes.push(`跨层违规边 ${illegal} 条`);

  return { plantViolations, vineKinds, notes };
}
