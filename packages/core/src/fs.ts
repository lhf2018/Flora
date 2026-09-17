import fs from "node:fs";
import path from "node:path";
import { DEFAULT_IGNORE } from "./types.js";

export function exists(p: string): boolean {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

export function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

export function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

export function shouldIgnore(name: string, ignore: string[] = DEFAULT_IGNORE): boolean {
  if (name.startsWith(".") && name !== ".") return true;
  return ignore.some((pattern) => {
    if (pattern.includes("*") || pattern.includes("/")) {
      // simple basename match for MVP
      const base = pattern.replace(/^\*\*\//, "").replace(/\/\*\*$/, "");
      return name === base || name === pattern;
    }
    return name === pattern;
  });
}

export function listDirs(root: string, ignore: string[] = DEFAULT_IGNORE): string[] {
  if (!isDir(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !shouldIgnore(d.name, ignore))
    .map((d) => path.join(root, d.name));
}

const CODE_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
]);

export function walkFiles(
  root: string,
  ignore: string[] = DEFAULT_IGNORE,
  maxFiles = 8000,
  exts: Set<string> = CODE_EXT,
): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length && out.length < maxFiles) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (shouldIgnore(entry.name, ignore)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const base = entry.name.toLowerCase();
      const ext = path.extname(base);
      if (exts.has(ext) || base === "dockerfile" || base.startsWith("dockerfile.")) {
        out.push(full);
      }
    }
  }
  return out;
}

export function slugId(input: string): string {
  return input
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "")
    .replace(/[^a-zA-Z0-9@/_.-]+/g, "-")
    .toLowerCase();
}
