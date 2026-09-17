import type { Plant, Vine, Violation } from "./types.js";
import { exists, readJson } from "./fs.js";
import fs from "node:fs";
import path from "node:path";

export interface RuleLayer {
  name: string;
  paths: string[];
}

export interface ForbiddenRule {
  from?: string; // layer name, module id/label, or "*"
  to?: string;
  when?: "cycle" | "deep-import" | "entry-only";
  /** banned import spec substrings / globs */
  import?: string[];
  message: string;
  severity?: "warn" | "error";
}

export interface ArchitectureRules {
  layers: RuleLayer[];
  forbidden: ForbiddenRule[];
  /** if true, cross-package non-entry imports are illegal by default when layers exist */
  preferEntryOnly?: boolean;
  source?: string;
}

export interface RulesResult {
  plantViolations: Map<string, Violation[]>;
  vineKinds: Map<string, "illegal" | "cycle" | "normal">;
  notes: string[];
}

export interface EdgeMeta {
  from: string;
  to: string;
  deep?: boolean;
  importSpecs?: string[];
}

/** Minimal YAML subset parser for flora.rules.yaml */
export function parseRulesYaml(text: string): ArchitectureRules {
  const layers: RuleLayer[] = [];
  const forbidden: ForbiddenRule[] = [];
  let preferEntryOnly = false;
  const lines = text.split(/\r?\n/);
  let section: "none" | "layers" | "forbidden" = "none";
  let currentLayer: RuleLayer | null = null;
  let currentForbidden: ForbiddenRule | null = null;
  let inPaths = false;
  let inImport = false;

  const flushLayer = () => {
    if (currentLayer?.name) layers.push(currentLayer);
    currentLayer = null;
    inPaths = false;
  };
  const flushForbidden = () => {
    if (
      currentForbidden?.message ||
      currentForbidden?.when ||
      currentForbidden?.from ||
      currentForbidden?.import?.length
    ) {
      if (!currentForbidden!.message) {
        currentForbidden!.message = currentForbidden!.when
          ? currentForbidden!.when === "cycle"
            ? "禁止循环依赖"
            : currentForbidden!.when === "deep-import" ||
                currentForbidden!.when === "entry-only"
              ? "禁止深入包内部（须经入口）"
              : "架构违规"
          : `禁止 ${currentForbidden!.from} → ${currentForbidden!.to}`;
      }
      forbidden.push(currentForbidden!);
    }
    currentForbidden = null;
    inImport = false;
  };

  for (const raw of lines) {
    const line = raw.replace(/#.*$/, "");
    if (!line.trim()) continue;
    const indent = raw.match(/^\s*/)?.[0].length ?? 0;

    const entry = line.match(/^preferEntryOnly\s*:\s*(true|false)/i);
    if (entry) {
      preferEntryOnly = entry[1]!.toLowerCase() === "true";
      continue;
    }

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
          currentForbidden.when = inlineWhen[1]!.trim() as ForbiddenRule["when"];
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
      if (when) currentForbidden.when = when[1]!.trim() as ForbiddenRule["when"];
      if (message) currentForbidden.message = message[1]!.trim();
      if (severity?.[1] === "warn" || severity?.[1] === "error") {
        currentForbidden.severity = severity![1] as "warn" | "error";
      }
      if (/^\s*import\s*:/.test(line)) {
        inImport = true;
        currentForbidden.import = currentForbidden.import ?? [];
        continue;
      }
      if (inImport && indent >= 4) {
        const pm = line.match(/^\s*-\s*["']?([^"'\n]+)["']?/);
        if (pm) {
          currentForbidden.import = currentForbidden.import ?? [];
          currentForbidden.import.push(pm[1]!.trim());
        }
      }
    }
  }
  flushLayer();
  flushForbidden();
  return { layers, forbidden, preferEntryOnly };
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
  return {
    layers: [],
    forbidden: [
      {
        when: "cycle",
        message: "禁止循环依赖",
        severity: "error",
      },
    ],
    preferEntryOnly: false,
    source: "(default)",
  };
}

/** Enrich rules with common layer forbids when layers are declared. */
export function thickenRules(rules: ArchitectureRules): ArchitectureRules {
  const names = new Set(rules.layers.map((l) => l.name));
  const forbidden = [...rules.forbidden];
  const has = (from: string, to: string) =>
    forbidden.some((f) => f.from === from && f.to === to);

  const add = (from: string, to: string, message: string) => {
    if (!names.has(from) || !names.has(to) || has(from, to)) return;
    forbidden.push({ from, to, message, severity: "error" });
  };

  add("domain", "application", "domain 不得依赖 application");
  add("domain", "ui", "domain 不得依赖 ui");
  add("domain", "infra", "domain 不得依赖 infra");
  add("application", "ui", "application 不得依赖 ui");
  add("ui", "infra", "ui 不得直接依赖 infra");

  if (
    rules.preferEntryOnly !== false &&
    rules.layers.length > 0 &&
    !forbidden.some((f) => f.when === "entry-only" || f.when === "deep-import")
  ) {
    forbidden.push({
      when: "entry-only",
      message: "跨模块须经公开入口（禁止深入包内部）",
      severity: "warn",
    });
  }

  return { ...rules, forbidden };
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

function actorMatches(
  ruleActor: string | undefined,
  layer: string | undefined,
  plant: Plant | undefined,
): boolean {
  if (!ruleActor || ruleActor === "*") return true;
  if (layer && ruleActor === layer) return true;
  if (plant && (ruleActor === plant.id || ruleActor === plant.label)) return true;
  if (plant?.path && matchGlob(plant.path, ruleActor)) return true;
  return false;
}

function importBanned(specs: string[] | undefined, patterns: string[]): boolean {
  if (!specs?.length || !patterns.length) return false;
  for (const spec of specs) {
    for (const pat of patterns) {
      if (spec.includes(pat) || matchGlob(spec, pat)) return true;
    }
  }
  return false;
}

export function applyArchitectureRules(input: {
  plants: Plant[];
  vines: Vine[];
  rules: ArchitectureRules;
  cycleEdgeKeys: Set<string>;
  edgeMeta?: EdgeMeta[];
}): RulesResult {
  const rules = thickenRules(input.rules);
  const { plants, vines, cycleEdgeKeys, edgeMeta = [] } = input;
  const plantViolations = new Map<string, Violation[]>();
  const vineKinds = new Map<string, "illegal" | "cycle" | "normal">();
  const notes: string[] = [];

  const plantById = new Map(plants.map((p) => [p.id, p]));
  const layerOf = new Map(plants.map((p) => [p.id, p.layer]));
  const metaByKey = new Map<string, EdgeMeta>();
  for (const e of edgeMeta) {
    metaByKey.set(`${e.from}→${e.to}`, e);
  }

  const pushViolation = (id: string, v: Violation) => {
    const list = plantViolations.get(id) ?? [];
    if (!list.some((x) => x.ruleId === v.ruleId && x.message === v.message)) {
      list.push(v);
      plantViolations.set(id, list);
    }
  };

  for (const v of vines) {
    const key = `${v.from}→${v.to}`;
    let kind: "illegal" | "cycle" | "normal" = cycleEdgeKeys.has(key)
      ? "cycle"
      : "normal";
    const meta = metaByKey.get(key);
    const fromPlant = plantById.get(v.from);
    const toPlant = plantById.get(v.to);

    for (const rule of rules.forbidden) {
      if (rule.when === "cycle") {
        if (kind === "cycle") {
          const sev = rule.severity ?? "error";
          for (const id of [v.from, v.to]) {
            pushViolation(id, {
              ruleId: "no-cycles",
              message: rule.message,
              severity: sev,
            });
          }
        }
        continue;
      }

      if (rule.when === "entry-only" || rule.when === "deep-import") {
        if (meta?.deep && v.from !== v.to) {
          kind = "illegal";
          const sev = rule.severity ?? "warn";
          pushViolation(v.from, {
            ruleId: "forbidden:entry-only",
            message: rule.message,
            severity: sev,
          });
          pushViolation(v.to, {
            ruleId: "forbidden:entry-only",
            message: rule.message,
            severity: sev,
          });
        }
        continue;
      }

      if (rule.import?.length) {
        if (importBanned(meta?.importSpecs, rule.import)) {
          const fromOk = actorMatches(
            rule.from,
            layerOf.get(v.from),
            fromPlant,
          );
          if (fromOk) {
            kind = "illegal";
            const sev = rule.severity ?? "error";
            pushViolation(v.from, {
              ruleId: `forbidden:import:${rule.import.join(",")}`,
              message: rule.message || `禁止导入 ${rule.import.join(", ")}`,
              severity: sev,
            });
          }
        }
        continue;
      }

      const fromLayer = layerOf.get(v.from);
      const toLayer = layerOf.get(v.to);
      const fromOk = actorMatches(rule.from, fromLayer, fromPlant);
      const toOk = actorMatches(rule.to, toLayer, toPlant);
      if (fromOk && toOk && rule.from && rule.to) {
        kind = "illegal";
        const sev = rule.severity ?? "error";
        const msg =
          rule.message ||
          `跨层违规: ${fromLayer ?? "?"} → ${toLayer ?? "?"}`;
        pushViolation(v.from, {
          ruleId: `forbidden:${rule.from}->${rule.to}`,
          message: msg,
          severity: sev,
        });
        pushViolation(v.to, {
          ruleId: `forbidden:${rule.from}->${rule.to}`,
          message: msg,
          severity: sev,
        });
      }
    }

    vineKinds.set(key, kind);
  }

  const illegal = [...vineKinds.values()].filter((k) => k === "illegal").length;
  if (rules.source) notes.push(`架构规则: ${rules.source}`);
  if (rules.layers.length) {
    notes.push(
      `分层 ${rules.layers.map((l) => l.name).join("/")}；规则加厚（含常见跨层禁令）`,
    );
  }
  if (illegal) notes.push(`违规藤 ${illegal} 条`);

  return { plantViolations, vineKinds, notes };
}
