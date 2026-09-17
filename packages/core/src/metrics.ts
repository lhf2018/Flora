import fs from "node:fs";
import path from "node:path";
import { exists } from "./fs.js";

/** Parse lcov and aggregate hit ratio by directory prefix */
export function loadCoverageByPath(
  root: string,
  coverageFile?: string,
): Map<string, number> {
  const candidates = coverageFile
    ? [coverageFile]
    : [
        path.join(root, "coverage", "lcov.info"),
        path.join(root, "coverage", "lcov", "lcov.info"),
      ];

  const file = candidates.find((c) => exists(c));
  const map = new Map<string, number>();
  if (!file) return map;

  const text = fs.readFileSync(file, "utf8");
  let current = "";
  let found = 0;
  let hit = 0;

  const flush = () => {
    if (!current) return;
    const ratio = found === 0 ? 0 : hit / found;
    map.set(path.normalize(current), ratio);
    current = "";
    found = 0;
    hit = 0;
  };

  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("SF:")) {
      flush();
      current = path.resolve(path.dirname(file), line.slice(3));
      // also try as absolute already
      if (!exists(current)) current = line.slice(3);
    } else if (line.startsWith("DA:")) {
      const parts = line.slice(3).split(",");
      const count = Number(parts[1] ?? 0);
      found++;
      if (count > 0) hit++;
    } else if (line === "end_of_record") {
      flush();
    }
  }
  flush();
  return map;
}

export function coverageForModule(
  modulePath: string,
  coverage: Map<string, number>,
): number | null {
  if (!coverage.size) return null;
  let sum = 0;
  let n = 0;
  const base = path.normalize(modulePath);
  for (const [file, ratio] of coverage) {
    if (file === base || file.startsWith(base + path.sep)) {
      sum += ratio;
      n++;
    }
  }
  if (!n) return null;
  return sum / n;
}

/** Cheap churn proxy: count git commits touching path in last N days (best-effort). */
export async function loadChurnByPath(
  root: string,
  modulePaths: string[],
  days = 14,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  for (const p of modulePaths) map.set(p, 0);

  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const { stdout } = await execFileAsync(
      "git",
      ["log", `--since=${since}`, "--name-only", "--pretty=format:"],
      { cwd: root, maxBuffer: 8 * 1024 * 1024 },
    );
    const counts = new Map<string, number>();
    for (const line of stdout.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const abs = path.normalize(path.join(root, line.trim()));
      for (const mod of modulePaths) {
        const base = path.normalize(mod);
        if (abs === base || abs.startsWith(base + path.sep)) {
          counts.set(mod, (counts.get(mod) ?? 0) + 1);
        }
      }
    }
    let max = 1;
    for (const v of counts.values()) max = Math.max(max, v);
    for (const mod of modulePaths) {
      map.set(mod, (counts.get(mod) ?? 0) / max);
    }
  } catch {
    // no git — leave zeros
  }
  return map;
}
