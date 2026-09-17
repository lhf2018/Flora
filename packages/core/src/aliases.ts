import fs from "node:fs";
import path from "node:path";
import { exists, readJson } from "./fs.js";

interface TsConfig {
  compilerOptions?: {
    baseUrl?: string;
    paths?: Record<string, string[]>;
  };
  extends?: string;
}

/** Collect path alias maps from root + package tsconfig files. */
export function loadTsPathAliases(
  root: string,
  moduleDirs: string[],
): Array<{ prefix: string; targets: string[]; baseDir: string }> {
  const out: Array<{ prefix: string; targets: string[]; baseDir: string }> = [];
  const files = [
    path.join(root, "tsconfig.json"),
    path.join(root, "tsconfig.base.json"),
    ...moduleDirs.map((d) => path.join(d, "tsconfig.json")),
  ];

  for (const file of files) {
    if (!exists(file)) continue;
    const cfg = readJson<TsConfig>(file);
    if (!cfg?.compilerOptions?.paths) continue;
    const baseUrl = cfg.compilerOptions.baseUrl ?? ".";
    const baseDir = path.resolve(path.dirname(file), baseUrl);
    for (const [key, targets] of Object.entries(cfg.compilerOptions.paths)) {
      const prefix = key.replace(/\*$/, "");
      out.push({
        prefix,
        targets: (targets ?? []).map((t) => t.replace(/\*$/, "")),
        baseDir,
      });
    }
  }
  return out;
}

export function resolveAliasSpec(
  spec: string,
  aliases: Array<{ prefix: string; targets: string[]; baseDir: string }>,
  existsFn: (p: string) => boolean,
): string | null {
  if (spec.startsWith(".") || spec.startsWith("/")) return null;
  for (const a of aliases) {
    if (!spec.startsWith(a.prefix)) continue;
    const rest = spec.slice(a.prefix.length);
    for (const target of a.targets) {
      const base = path.resolve(a.baseDir, target + rest);
      const candidates = [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        `${base}.js`,
        `${base}.jsx`,
        path.join(base, "index.ts"),
        path.join(base, "index.tsx"),
        path.join(base, "index.js"),
      ];
      for (const c of candidates) {
        try {
          if (existsFn(c) && !fs.statSync(c).isDirectory()) return c;
        } catch {
          /* ignore */
        }
      }
    }
  }
  return null;
}
