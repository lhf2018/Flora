import fs from "node:fs";
import path from "node:path";
import { SOURCE_EXTS } from "./species.js";

export interface ImportHit {
  spec: string;
}

export interface LanguageAdapter {
  id: string;
  /** file extensions this adapter handles, with leading dot */
  exts: string[];
  extractImports(source: string, filePath: string): ImportHit[];
  /** resolve relative/package spec to absolute file path, or null */
  resolve?(
    fromFile: string,
    spec: string,
    exists: (p: string) => boolean,
  ): string | null;
}

const JS_IMPORT_RE =
  /(?:import\s+(?:[\s\S]*?\s+from\s+)?|export\s+[\s\S]*?\s+from\s+|require\s*\(\s*)['"]([^'"]+)['"]/g;

export const jsAdapter: LanguageAdapter = {
  id: "javascript",
  exts: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"],
  extractImports(source) {
    const out: ImportHit[] = [];
    for (const m of source.matchAll(JS_IMPORT_RE)) out.push({ spec: m[1]! });
    return out;
  },
  resolve(fromFile, spec, exists) {
    if (!spec.startsWith(".") && !spec.startsWith("/")) return null;
    const base = path.resolve(path.dirname(fromFile), spec);
    const stripped = base.replace(/\.(js|jsx|mjs|cjs|ts|tsx)$/i, "");
    const candidates = [
      base,
      stripped,
      `${stripped}.ts`,
      `${stripped}.tsx`,
      `${stripped}.js`,
      `${stripped}.jsx`,
      `${stripped}.mjs`,
      path.join(stripped, "index.ts"),
      path.join(stripped, "index.tsx"),
      path.join(stripped, "index.js"),
    ];
    for (const c of candidates) {
      if (exists(c) && !fs.statSync(c).isDirectory()) return c;
    }
    return null;
  },
};

/** Python: import x / from x import y / from .x import y */
export const pythonAdapter: LanguageAdapter = {
  id: "python",
  exts: [".py", ".pyi"],
  extractImports(source) {
    const out: ImportHit[] = [];
    for (const m of source.matchAll(
      /^\s*(?:from\s+(\.?\w+(?:\.\w+)*)\s+import|import\s+(\w+(?:\.\w+)*))/gm,
    )) {
      const spec = (m[1] || m[2] || "").trim();
      if (spec) out.push({ spec });
    }
    return out;
  },
  resolve(fromFile, spec, exists) {
    if (!spec.startsWith(".")) return null;
    const lead = spec.match(/^\.+/)?.[0] ?? ".";
    let baseDir = path.dirname(fromFile);
    for (let i = 1; i < lead.length; i++) baseDir = path.dirname(baseDir);
    const mod = spec.slice(lead.length).replace(/\./g, path.sep);
    if (!mod) {
      const init = path.join(baseDir, "__init__.py");
      return exists(init) ? init : null;
    }
    const candidates = [
      path.join(baseDir, `${mod}.py`),
      path.join(baseDir, mod, "__init__.py"),
    ];
    for (const c of candidates) {
      if (exists(c)) return c;
    }
    return null;
  },
};

/** Go: import "x" / import ( "a" "b" ) */
export const goAdapter: LanguageAdapter = {
  id: "go",
  exts: [".go"],
  extractImports(source) {
    const out: ImportHit[] = [];
    for (const m of source.matchAll(/import\s+"([^"]+)"/g)) {
      out.push({ spec: m[1]! });
    }
    const block = source.match(/import\s*\(([\s\S]*?)\)/);
    if (block) {
      for (const m of block[1]!.matchAll(/"([^"]+)"/g)) {
        out.push({ spec: m[1]! });
      }
    }
    return out;
  },
};

/** Java/Kotlin style imports */
export const jvmAdapter: LanguageAdapter = {
  id: "jvm",
  exts: [".java", ".kt", ".kts"],
  extractImports(source) {
    const out: ImportHit[] = [];
    for (const m of source.matchAll(/^\s*import\s+(?:static\s+)?([a-zA-Z0-9_.]+)/gm)) {
      out.push({ spec: m[1]! });
    }
    return out;
  },
};

export const ALL_ADAPTERS: LanguageAdapter[] = [
  jsAdapter,
  pythonAdapter,
  goAdapter,
  jvmAdapter,
];

export function adapterForFile(filePath: string): LanguageAdapter | null {
  const ext = path.extname(filePath).toLowerCase();
  return ALL_ADAPTERS.find((a) => a.exts.includes(ext)) ?? null;
}

export function edgeSourceExts(): Set<string> {
  const set = new Set<string>();
  for (const a of ALL_ADAPTERS) for (const e of a.exts) set.add(e);
  // keep SOURCE_EXTS for walking broadly; edges use adapter exts
  for (const e of SOURCE_EXTS) set.add(e);
  return set;
}
