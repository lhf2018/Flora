import fs from "node:fs";
import path from "node:path";
import { SOURCE_EXTS } from "./species.js";

export interface ImportHit {
  spec: string;
  /** type-only import — should not create coupling vines */
  typeOnly?: boolean;
  /** static | dynamic */
  kind?: "static" | "dynamic";
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

function stripCommentsAndStringsRough(source: string): string {
  // enough to avoid false import hits in comments; not a full parser
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

export const jsAdapter: LanguageAdapter = {
  id: "javascript",
  exts: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"],
  extractImports(source) {
    const text = stripCommentsAndStringsRough(source);
    const out: ImportHit[] = [];
    const seen = new Set<string>();

    const push = (spec: string, opts?: Partial<ImportHit>) => {
      const key = `${opts?.typeOnly ? "t" : "v"}:${opts?.kind ?? "static"}:${spec}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ spec, typeOnly: opts?.typeOnly, kind: opts?.kind ?? "static" });
    };

    // import type { X } from 'm' / import type m from 'm'
    for (const m of text.matchAll(
      /\bimport\s+type\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    )) {
      push(m[1]!, { typeOnly: true });
    }
    // export type { X } from 'm'
    for (const m of text.matchAll(
      /\bexport\s+type\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    )) {
      push(m[1]!, { typeOnly: true });
    }
    // import … from 'm' / export … from 'm' / require('m')
    for (const m of text.matchAll(
      /(?:\bimport\s+(?!type\b)[\s\S]*?\s+from\s+|\bexport\s+(?!type\b)[\s\S]*?\s+from\s+|\brequire\s*\(\s*)['"]([^'"]+)['"]/g,
    )) {
      push(m[1]!);
    }
    // side-effect import 'm'
    for (const m of text.matchAll(/\bimport\s+['"]([^'"]+)['"]/g)) {
      push(m[1]!);
    }
    // dynamic import('m') / import("m")
    for (const m of text.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      push(m[1]!, { kind: "dynamic" });
    }

    return out.filter((h) => !h.typeOnly);
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
      path.join(stripped, "index.mjs"),
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
      if (spec) out.push({ spec, kind: "static" });
    }
    // typing-only: from typing import … still a real import; skip TYPE_CHECKING blocks lightly
    return out;
  },
  resolve(fromFile, spec, exists) {
    if (!spec.startsWith(".")) {
      // absolute package: walk up for package root then join
      const parts = spec.split(".");
      let dir = path.dirname(fromFile);
      for (let i = 0; i < 6; i++) {
        const candidate = path.join(dir, ...parts) + ".py";
        const pkg = path.join(dir, ...parts, "__init__.py");
        if (exists(candidate)) return candidate;
        if (exists(pkg)) return pkg;
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
      return null;
    }
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
      out.push({ spec: m[1]!, kind: "static" });
    }
    const block = source.match(/import\s*\(([\s\S]*?)\)/);
    if (block) {
      for (const m of block[1]!.matchAll(/"([^"]+)"/g)) {
        out.push({ spec: m[1]!, kind: "static" });
      }
    }
    return out;
  },
};

const jvmRootsCache = new Map<string, string[]>();

function collectJvmSourceRoots(startFile: string): string[] {
  let dir = path.dirname(startFile);
  let moduleRoot: string | null = null;
  let reactor: string | null = null;
  for (let i = 0; i < 14; i++) {
    const build =
      fs.existsSync(path.join(dir, "pom.xml")) ||
      fs.existsSync(path.join(dir, "build.gradle")) ||
      fs.existsSync(path.join(dir, "build.gradle.kts"));
    if (build) {
      if (!moduleRoot) moduleRoot = dir;
      else {
        reactor = dir;
        break;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const key = reactor ?? moduleRoot ?? path.dirname(startFile);
  const cached = jvmRootsCache.get(key);
  if (cached) return cached;

  const roots: string[] = [];
  const add = (moduleDir: string) => {
    for (const rel of [
      "src/main/java",
      "src/main/kotlin",
      "src/test/java",
      "src/test/kotlin",
    ]) {
      const p = path.join(moduleDir, rel);
      if (fs.existsSync(p)) roots.push(p);
    }
  };
  if (reactor) {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(reactor, { withFileTypes: true });
    } catch {
      entries = [];
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const full = path.join(reactor, entry.name);
      if (
        fs.existsSync(path.join(full, "pom.xml")) ||
        fs.existsSync(path.join(full, "build.gradle")) ||
        fs.existsSync(path.join(full, "build.gradle.kts"))
      ) {
        add(full);
      }
    }
    add(reactor);
  } else if (moduleRoot) {
    add(moduleRoot);
  }
  jvmRootsCache.set(key, roots);
  return roots;
}

/** Java/Kotlin style imports */
export const jvmAdapter: LanguageAdapter = {
  id: "jvm",
  exts: [".java", ".kt", ".kts"],
  extractImports(source) {
    const out: ImportHit[] = [];
    for (const m of source.matchAll(
      /^\s*import\s+(?:static\s+)?([a-zA-Z0-9_.]+)/gm,
    )) {
      const spec = m[1]!.replace(/\.+$/, "");
      if (!spec || spec.endsWith(".")) continue;
      out.push({ spec, kind: "static" });
    }
    return out;
  },
  resolve(fromFile, spec, existsFn) {
    if (!spec || spec.endsWith(".*") || spec.split(".").length < 2) return null;
    const parts = spec.split(".");
    const rels = [parts.join(path.sep)];
    const last = parts[parts.length - 1] ?? "";
    if (parts.length > 2 && /^[a-z]/.test(last)) {
      rels.push(parts.slice(0, -1).join(path.sep));
    }
    for (const root of collectJvmSourceRoots(fromFile)) {
      for (const rel of rels) {
        for (const ext of [".java", ".kt", ".kts"]) {
          const file = path.join(root, rel + ext);
          if (existsFn(file)) return file;
        }
      }
    }
    return null;
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
  for (const e of SOURCE_EXTS) set.add(e);
  return set;
}

/** True if resolved file is the public entry of its module root. */
export function isModuleEntryFile(moduleRoot: string, resolvedFile: string): boolean {
  const root = path.normalize(moduleRoot);
  const file = path.normalize(resolvedFile);
  // File-as-module: the module path is the source file itself
  if (root === file) return true;
  try {
    if (fs.existsSync(root) && !fs.statSync(root).isDirectory()) {
      return root === file;
    }
  } catch {
    /* ignore */
  }
  const rel = path.relative(root, file);
  if (rel.startsWith("..")) return false;
  const base = path.basename(file).toLowerCase();
  const dir = path.dirname(file);
  if (path.normalize(dir) === root) {
    return (
      /^index\.(ts|tsx|js|jsx|mjs|cjs)$/.test(base) ||
      /^main\.(ts|tsx|js|go|py)$/.test(base) ||
      base === "__init__.py" ||
      base === "mod.rs"
    );
  }
  // package root index one level down (src/index.ts) still treated as entry-ish
  if (
    /^(src|lib)$/i.test(path.basename(dir)) &&
    path.normalize(path.dirname(dir)) === root &&
    /^index\.(ts|tsx|js|jsx|mjs|cjs)$/.test(base)
  ) {
    return true;
  }
  return false;
}
