import fs from "node:fs";
import path from "node:path";
import { exists, listDirs, readJson, slugId, walkFiles } from "./fs.js";
import { adapterForFile, ALL_ADAPTERS, edgeSourceExts } from "./adapters.js";
import type { AggregateGranularity, ModuleGraph } from "./types.js";
import { DEFAULT_IGNORE } from "./types.js";
import { loadTsPathAliases, resolveAliasSpec } from "./aliases.js";
import {
  layerFromRules,
  loadRules,
  type ArchitectureRules,
} from "./rules.js";

interface PkgJson {
  name?: string;
  workspaces?: string[] | { packages?: string[] };
}

function expandWorkspaceGlobs(root: string, patterns: string[]): string[] {
  const results: string[] = [];
  for (const pattern of patterns) {
    // support "packages/*" style only for MVP
    if (pattern.endsWith("/*")) {
      const base = path.join(root, pattern.slice(0, -2));
      if (!exists(base)) continue;
      for (const dir of listDirs(base, [])) {
        results.push(dir);
      }
    } else {
      const full = path.join(root, pattern);
      if (exists(full)) results.push(full);
    }
  }
  return [...new Set(results)];
}

function detectWorkspaces(root: string): string[] | null {
  const pkgPath = path.join(root, "package.json");
  const pkg = readJson<PkgJson>(pkgPath);
  if (pkg?.workspaces) {
    const patterns = Array.isArray(pkg.workspaces)
      ? pkg.workspaces
      : pkg.workspaces.packages ?? [];
    const dirs = expandWorkspaceGlobs(root, patterns).filter((d) =>
      exists(path.join(d, "package.json")),
    );
    if (dirs.length) return dirs;
  }

  const pnpm = path.join(root, "pnpm-workspace.yaml");
  if (exists(pnpm)) {
    const text = fs.readFileSync(pnpm, "utf8");
    const patterns = [...text.matchAll(/-\s*["']?([^"'\n]+)["']?/g)].map((m) =>
      m[1]!.trim(),
    );
    const dirs = expandWorkspaceGlobs(root, patterns).filter((d) =>
      exists(path.join(d, "package.json")),
    );
    if (dirs.length) return dirs;
  }
  return null;
}

function detectPythonPackages(root: string, ignore: string[]): string[] | null {
  const dirs: string[] = [];
  const consider = (dir: string) => {
    if (
      exists(path.join(dir, "pyproject.toml")) ||
      exists(path.join(dir, "setup.py")) ||
      exists(path.join(dir, "__init__.py"))
    ) {
      dirs.push(dir);
    }
  };

  if (exists(path.join(root, "pyproject.toml")) || exists(path.join(root, "setup.py"))) {
    const src = path.join(root, "src");
    if (exists(src)) {
      for (const d of listDirs(src, ignore)) consider(d);
    }
    for (const d of listDirs(root, ignore)) consider(d);
  }

  for (const d of listDirs(root, ignore)) {
    consider(d);
    for (const child of listDirs(d, ignore)) consider(child);
  }

  const unique = [...new Set(dirs.map((d) => path.normalize(d)))];
  return unique.length ? unique : null;
}

function detectGoModules(root: string, ignore: string[]): string[] | null {
  const dirs: string[] = [];
  if (exists(path.join(root, "go.mod"))) {
    for (const d of listDirs(root, ignore)) {
      // treat top-level dirs with .go files as modules
      const hasGo = walkFiles(d, ignore, 20, new Set([".go"])).length > 0;
      if (hasGo) dirs.push(d);
    }
    if (!dirs.length) dirs.push(root);
  }
  for (const d of listDirs(root, ignore)) {
    if (exists(path.join(d, "go.mod"))) dirs.push(d);
  }
  const unique = [...new Set(dirs)];
  return unique.length ? unique : null;
}

function moduleLabel(dir: string, root: string): string {
  const pkg = readJson<PkgJson>(path.join(dir, "package.json"));
  if (pkg?.name) return pkg.name;
  // python: try name in pyproject roughly
  const pyproject = path.join(dir, "pyproject.toml");
  if (exists(pyproject)) {
    const text = fs.readFileSync(pyproject, "utf8");
    const m = text.match(/name\s*=\s*["']([^"']+)["']/);
    if (m) return m[1]!;
  }
  const gomod = path.join(dir, "go.mod");
  if (exists(gomod)) {
    const text = fs.readFileSync(gomod, "utf8");
    const m = text.match(/^module\s+(\S+)/m);
    if (m) return m[1]!.split("/").pop() ?? m[1]!;
  }
  return path.relative(root, dir).replace(/\\/g, "/") || path.basename(dir);
}

function guessLayer(rel: string): string | undefined {
  const lower = rel.toLowerCase();
  if (/(^|\/)(domain|core|entities)\b/.test(lower)) return "domain";
  if (/(^|\/)(app|application|api|services?)\b/.test(lower)) return "application";
  if (/(^|\/)(infra|infrastructure|adapters?|db)\b/.test(lower)) return "infra";
  if (/(^|\/)(ui|web|frontend|apps)\b/.test(lower)) return "ui";
  return undefined;
}

/** Resolve which module a file belongs to (longest path prefix wins). */
function fileToModule(
  file: string,
  modules: Array<{ id: string; path: string }>,
): string | null {
  let best: { id: string; len: number } | null = null;
  const normalized = path.normalize(file);
  for (const m of modules) {
    const base = path.normalize(m.path);
    if (normalized === base || normalized.startsWith(base + path.sep)) {
      if (!best || base.length > best.len) best = { id: m.id, len: base.length };
    }
  }
  return best?.id ?? null;
}

const IMPORT_RE =
  /(?:import\s+(?:[\s\S]*?\s+from\s+)?|export\s+[\s\S]*?\s+from\s+|require\s*\(\s*)['"]([^'"]+)['"]/g;

function extractImports(source: string): string[] {
  const out: string[] = [];
  for (const match of source.matchAll(IMPORT_RE)) {
    out.push(match[1]!);
  }
  return out;
}

function resolveImport(fromFile: string, spec: string): string | null {
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
    try {
      if (exists(c) && !fs.statSync(c).isDirectory()) return c;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function buildPackageNameIndex(
  modules: Array<{ id: string; path: string }>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of modules) {
    const pkg = readJson<PkgJson>(path.join(m.path, "package.json"));
    if (pkg?.name) map.set(pkg.name, m.id);
    // python module name = directory name
    map.set(path.basename(m.path), m.id);
    map.set(m.id, m.id);
    const label = moduleLabel(m.path, m.path);
    if (label) map.set(label, m.id);
  }
  return map;
}

function resolveSpecToModule(
  fromFile: string,
  spec: string,
  modules: Array<{ id: string; path: string }>,
  nameIndex: Map<string, string>,
  aliases: ReturnType<typeof loadTsPathAliases>,
  adapterResolve?: (
    fromFile: string,
    spec: string,
    existsFn: (p: string) => boolean,
  ) => string | null,
): string | null {
  // tsconfig paths alias first (e.g. @/ → src/)
  if (!spec.startsWith(".") && !spec.startsWith("/")) {
    const aliased = resolveAliasSpec(spec, aliases, exists);
    if (aliased) {
      const id = fileToModule(aliased, modules);
      if (id) return id;
    }
    // skip obvious external packages (no workspace match)
    const top = spec.startsWith("@")
      ? spec.split("/").slice(0, 2).join("/")
      : spec.split("/")[0]!;
    if (nameIndex.has(spec)) return nameIndex.get(spec)!;
    if (nameIndex.has(top)) return nameIndex.get(top)!;
    let best: { id: string; len: number } | null = null;
    for (const [name, id] of nameIndex) {
      if (
        spec === name ||
        spec.startsWith(name + "/") ||
        spec.startsWith(name + ".")
      ) {
        if (!best || name.length > best.len) best = { id, len: name.length };
      }
    }
    return best?.id ?? null;
  }

  if (adapterResolve) {
    const resolved = adapterResolve(fromFile, spec, exists);
    if (resolved) return fileToModule(resolved, modules);
  }
  const resolved = resolveImport(fromFile, spec);
  if (!resolved) return null;
  return fileToModule(resolved, modules);
}

function buildEdgesFromImports(
  root: string,
  modules: Array<{ id: string; path: string }>,
  ignore: string[],
): { edges: Array<{ from: string; to: string; weight: number }>; notes: string[] } {
  const weights = new Map<string, number>();
  const nameIndex = buildPackageNameIndex(modules);
  const aliases = loadTsPathAliases(
    root,
    modules.map((m) => m.path),
  );
  const files = walkFiles(root, ignore, 12000, edgeSourceExts());
  const adaptersUsed = new Set<string>();
  let unresolvedExternal = 0;

  for (const file of files) {
    const fromId = fileToModule(file, modules);
    if (!fromId) continue;
    const adapter = adapterForFile(file);
    if (!adapter) continue;
    adaptersUsed.add(adapter.id);
    let source = "";
    try {
      source = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const hit of adapter.extractImports(source, file)) {
      // skip node builtins
      if (
        hit.spec.startsWith("node:") ||
        ["fs", "path", "http", "os", "util", "crypto", "url"].includes(hit.spec)
      ) {
        continue;
      }
      const toId = resolveSpecToModule(
        file,
        hit.spec,
        modules,
        nameIndex,
        aliases,
        adapter.resolve?.bind(adapter),
      );
      if (!toId) {
        if (!hit.spec.startsWith(".") && !hit.spec.startsWith("/")) {
          unresolvedExternal++;
        }
        continue;
      }
      if (toId === fromId) continue;
      const key = `${fromId}→${toId}`;
      weights.set(key, (weights.get(key) ?? 0) + 1);
    }
  }

  void ALL_ADAPTERS;
  void extractImports;

  const notes: string[] = [];
  if (aliases.length) notes.push(`加载 tsconfig paths 别名 ${aliases.length} 条`);
  if (adaptersUsed.size) {
    notes.push(`启用 Adapter: ${[...adaptersUsed].join(", ")}`);
  }
  if (unresolvedExternal > 0) {
    notes.push(`外部依赖引用约 ${unresolvedExternal} 处（已忽略）`);
  }

  return {
    edges: [...weights.entries()].map(([key, weight]) => {
      const [from, to] = key.split("→") as [string, string];
      return { from, to, weight };
    }),
    notes,
  };
}

function discoverPackages(
  root: string,
  ignore: string[],
  rules?: ArchitectureRules | null,
): { modules: ModuleGraph["modules"]; strategy: string; notes: string[] } {
  const notes: string[] = [];
  const applyLayer = (rel: string, guessed?: string) =>
    (rules ? layerFromRules(rel, rules) : undefined) ?? guessed;

  const workspaceDirs = detectWorkspaces(root);
  if (workspaceDirs?.length) {
    notes.push(`识别到 npm/pnpm workspaces（${workspaceDirs.length} packages）`);
    const modules = workspaceDirs.map((dir) => {
      const rel = path.relative(root, dir).replace(/\\/g, "/") || ".";
      const label = moduleLabel(dir, root);
      return {
        id: slugId(label.startsWith("@") ? label : rel || label),
        path: dir,
        label,
        layer: applyLayer(rel, guessLayer(rel)),
      };
    });
    // merge python / go packages living alongside JS monorepo
    const seen = new Set(modules.map((m) => path.normalize(m.path)));
    const extra: typeof modules = [];
    for (const dir of [
      ...(detectPythonPackages(root, ignore) ?? []),
      ...(detectGoModules(root, ignore) ?? []),
    ]) {
      const norm = path.normalize(dir);
      if (seen.has(norm)) continue;
      seen.add(norm);
      const rel = path.relative(root, dir).replace(/\\/g, "/") || ".";
      const label = moduleLabel(dir, root);
      extra.push({
        id: slugId(rel || label),
        path: dir,
        label,
        layer: applyLayer(rel, guessLayer(rel)),
      });
    }
    if (extra.length) {
      notes.push(`额外接入多语言包 ${extra.length} 个`);
      modules.push(...extra);
    }
    return { modules, strategy: "package", notes };
  }

  const py = detectPythonPackages(root, ignore);
  if (py?.length) {
    notes.push(`识别到 Python 包（${py.length}）`);
    return {
      modules: py.map((dir) => {
        const rel = path.relative(root, dir).replace(/\\/g, "/") || ".";
        const label = moduleLabel(dir, root);
        return {
          id: slugId(rel || label),
          path: dir,
          label,
          layer: applyLayer(rel, guessLayer(rel)),
        };
      }),
      strategy: "python",
      notes,
    };
  }

  const go = detectGoModules(root, ignore);
  if (go?.length) {
    notes.push(`识别到 Go module（${go.length}）`);
    return {
      modules: go.map((dir) => {
        const rel = path.relative(root, dir).replace(/\\/g, "/") || ".";
        const label = moduleLabel(dir, root);
        return {
          id: slugId(rel || label),
          path: dir,
          label,
          layer: applyLayer(rel, guessLayer(rel)),
        };
      }),
      strategy: "go",
      notes,
    };
  }

  const dirs = listDirs(root, ignore);
  if (dirs.length) {
    notes.push(`按一级目录聚合（${dirs.length} 个模块）`);
    const modules = dirs.map((dir) => {
      const rel = path.relative(root, dir).replace(/\\/g, "/");
      const label = moduleLabel(dir, root);
      return {
        id: slugId(rel),
        path: dir,
        label,
        layer: applyLayer(rel, guessLayer(rel)),
      };
    });
    return { modules, strategy: "directory", notes };
  }

  notes.push("未发现子目录，将根目录作为单株植物");
  return {
    modules: [
      {
        id: slugId(path.basename(root)),
        path: root,
        label: path.basename(root),
      },
    ],
    strategy: "directory",
    notes,
  };
}

function discoverFiles(
  root: string,
  ignore: string[],
): { modules: ModuleGraph["modules"]; strategy: string; notes: string[] } {
  const files = walkFiles(root, ignore, 400);
  const notes = [`按文件聚合（采样 ${files.length} 个源文件）`];
  const modules = files.map((file) => {
    const rel = path.relative(root, file).replace(/\\/g, "/");
    return {
      id: slugId(rel),
      path: file,
      label: path.basename(file),
      layer: guessLayer(rel),
    };
  });
  return { modules, strategy: "file", notes };
}

export function discoverModuleGraph(
  root: string,
  granularity: AggregateGranularity = "auto",
  ignore: string[] = DEFAULT_IGNORE,
  rules?: ArchitectureRules | null,
): ModuleGraph {
  const abs = path.resolve(root);
  const rulesDoc = rules ?? loadRules(abs);
  let discovered;
  if (granularity === "file") {
    discovered = discoverFiles(abs, ignore);
  } else if (granularity === "directory") {
    const dirs = listDirs(abs, ignore);
    discovered = {
      modules: dirs.map((dir) => {
        const rel = path.relative(abs, dir).replace(/\\/g, "/");
        return {
          id: slugId(rel),
          path: dir,
          label: moduleLabel(dir, abs),
          layer:
            (rulesDoc ? layerFromRules(rel, rulesDoc) : undefined) ??
            guessLayer(rel),
        };
      }),
      strategy: "directory" as const,
      notes: [`强制一级目录聚合（${dirs.length}）`],
    };
    if (!discovered.modules.length) {
      discovered = discoverPackages(abs, ignore, rulesDoc);
    }
  } else if (granularity === "package") {
    const ws = detectWorkspaces(abs);
    if (ws?.length) {
      discovered = {
        modules: ws.map((dir) => {
          const rel = path.relative(abs, dir).replace(/\\/g, "/") || ".";
          const label = moduleLabel(dir, abs);
          return {
            id: slugId(label.startsWith("@") ? label : rel || label),
            path: dir,
            label,
            layer:
              (rulesDoc ? layerFromRules(rel, rulesDoc) : undefined) ??
              guessLayer(rel),
          };
        }),
        strategy: "package" as const,
        notes: [`强制 package 聚合（${ws.length}）`],
      };
    } else {
      discovered = discoverPackages(abs, ignore, rulesDoc);
      discovered.notes.push("未找到 workspaces，回退自动策略");
    }
  } else {
    discovered = discoverPackages(abs, ignore, rulesDoc);
  }

  const { edges, notes: edgeNotes } = buildEdgesFromImports(
    abs,
    discovered.modules,
    ignore,
  );
  discovered.notes.push(...edgeNotes);
  discovered.notes.push(`解析依赖边 ${edges.length}`);
  return {
    modules: discovered.modules,
    edges,
    strategy: discovered.strategy,
    notes: discovered.notes,
  };
}
