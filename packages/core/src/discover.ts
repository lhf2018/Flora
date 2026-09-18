import fs from "node:fs";
import path from "node:path";
import { exists, isDir, listDirs, readJson, slugId, walkFiles } from "./fs.js";
import {
  adapterForFile,
  ALL_ADAPTERS,
  edgeSourceExts,
  isModuleEntryFile,
} from "./adapters.js";
import type { AggregateGranularity, ModuleGraph } from "./types.js";
import { DEFAULT_IGNORE } from "./types.js";
import { loadTsPathAliases, resolveAliasSpec } from "./aliases.js";
import {
  layerFromRules,
  loadRules,
  type ArchitectureRules,
} from "./rules.js";
import {
  applyModulesMap,
  loadModulesMap,
  type FloraModulesMap,
} from "./modules-map.js";
import {
  clampTargetPlants,
  fitModulesToTarget,
  remapEdges,
} from "./narrative.js";

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
    // Skip file-as-module paths — basename would be foo.ts, not a package name
    let isDir = false;
    try {
      isDir = exists(m.path) && fs.statSync(m.path).isDirectory();
    } catch {
      isDir = false;
    }
    if (isDir) {
      const pkg = readJson<PkgJson>(path.join(m.path, "package.json"));
      if (pkg?.name) map.set(pkg.name, m.id);
      map.set(path.basename(m.path), m.id);
      const label = moduleLabel(m.path, m.path);
      if (label) map.set(label, m.id);
    }
    map.set(m.id, m.id);
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
): { moduleId: string; resolvedFile: string | null } | null {
  // tsconfig paths alias first (e.g. @/ → src/)
  if (!spec.startsWith(".") && !spec.startsWith("/")) {
    const aliased = resolveAliasSpec(spec, aliases, exists);
    if (aliased) {
      const id = fileToModule(aliased, modules);
      if (id) return { moduleId: id, resolvedFile: aliased };
    }
    const top = spec.startsWith("@")
      ? spec.split("/").slice(0, 2).join("/")
      : spec.split("/")[0]!;
    if (nameIndex.has(spec)) {
      return { moduleId: nameIndex.get(spec)!, resolvedFile: null };
    }
    if (nameIndex.has(top)) {
      // deep package path like @scope/pkg/src/foo
      const rest = spec.slice(top.length);
      const deep = rest.includes("/") && rest !== "";
      return {
        moduleId: nameIndex.get(top)!,
        resolvedFile: deep ? `__deep__:${spec}` : null,
      };
    }
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
    if (best) {
      const deep = spec.length > best.len + 1;
      return {
        moduleId: best.id,
        resolvedFile: deep ? `__deep__:${spec}` : null,
      };
    }
    if (adapterResolve) {
      const resolved = adapterResolve(fromFile, spec, exists);
      if (resolved) {
        const id = fileToModule(resolved, modules);
        if (id) return { moduleId: id, resolvedFile: resolved };
      }
    }
    return null;
  }

  if (adapterResolve) {
    const resolved = adapterResolve(fromFile, spec, exists);
    if (resolved) {
      const id = fileToModule(resolved, modules);
      if (id) return { moduleId: id, resolvedFile: resolved };
    }
  }
  const resolved = resolveImport(fromFile, spec);
  if (!resolved) return null;
  const id = fileToModule(resolved, modules);
  if (!id) return null;
  return { moduleId: id, resolvedFile: resolved };
}

function buildEdgesFromImports(
  root: string,
  modules: Array<{ id: string; path: string }>,
  ignore: string[],
): {
  edges: ModuleGraph["edges"];
  notes: string[];
} {
  const weights = new Map<string, number>();
  const deepFlags = new Map<string, boolean>();
  const specsMap = new Map<string, Set<string>>();
  const nameIndex = buildPackageNameIndex(modules);
  const aliases = loadTsPathAliases(
    root,
    modules.map((m) => m.path),
  );
  const modById = new Map(modules.map((m) => [m.id, m]));
  const files = walkFiles(root, ignore, 12000, edgeSourceExts());
  const adaptersUsed = new Set<string>();
  let unresolvedExternal = 0;
  let typeOnlySkipped = 0;
  let deepCount = 0;

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
    // count type-only before filter (adapter already drops them; detect for notes)
    if (/\bimport\s+type\b|\bexport\s+type\b/.test(source)) {
      typeOnlySkipped += 1;
    }
    for (const hit of adapter.extractImports(source, file)) {
      if (
        hit.spec.startsWith("node:") ||
        ["fs", "path", "http", "os", "util", "crypto", "url"].includes(hit.spec)
      ) {
        continue;
      }
      const hitRes = resolveSpecToModule(
        file,
        hit.spec,
        modules,
        nameIndex,
        aliases,
        adapter.resolve?.bind(adapter),
      );
      if (!hitRes) {
        if (!hit.spec.startsWith(".") && !hit.spec.startsWith("/")) {
          unresolvedExternal++;
        }
        continue;
      }
      const { moduleId: toId, resolvedFile } = hitRes;
      if (toId === fromId) continue;
      const key = `${fromId}→${toId}`;
      weights.set(key, (weights.get(key) ?? 0) + 1);
      const specs = specsMap.get(key) ?? new Set<string>();
      specs.add(hit.spec);
      specsMap.set(key, specs);

      let deep = false;
      if (resolvedFile?.startsWith("__deep__:")) {
        deep = true;
      } else if (resolvedFile) {
        const mod = modById.get(toId);
        if (mod && !isModuleEntryFile(mod.path, resolvedFile)) {
          deep = true;
        }
      }
      if (deep) {
        deepFlags.set(key, true);
        deepCount++;
      }
    }
  }

  void ALL_ADAPTERS;
  void extractImports;

  const notes: string[] = [];
  if (aliases.length) notes.push(`加载 tsconfig paths 别名 ${aliases.length} 条`);
  if (adaptersUsed.size) {
    notes.push(`启用 Adapter: ${[...adaptersUsed].join(", ")}`);
  }
  if (typeOnlySkipped) {
    notes.push(`已跳过 type-only import（约 ${typeOnlySkipped} 个文件含此类写法）`);
  }
  if (deepCount) notes.push(`深入包内部引用 ${deepCount} 处`);
  if (unresolvedExternal > 0) {
    notes.push(`外部依赖引用约 ${unresolvedExternal} 处（已忽略）`);
  }

  return {
    edges: [...weights.entries()].map(([key, weight]) => {
      const [from, to] = key.split("→") as [string, string];
      return {
        from,
        to,
        weight,
        deep: deepFlags.get(key) ?? false,
        importSpecs: [...(specsMap.get(key) ?? [])],
      };
    }),
    notes,
  };
}

/** Soft edges from workspace package.json — fills gaps when imports weren't resolved. */
function buildEdgesFromPackageJson(
  modules: Array<{ id: string; path: string; label?: string }>,
): {
  edges: ModuleGraph["edges"];
  notes: string[];
} {
  const nameToId = new Map<string, string>();
  for (const m of modules) {
    nameToId.set(m.id, m.id);
    if (m.label) nameToId.set(m.label, m.id);
    nameToId.set(path.basename(m.path), m.id);
    const pkg = readJson<PkgJson & {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    }>(path.join(m.path, "package.json"));
    if (pkg?.name) nameToId.set(pkg.name, m.id);
  }

  const weights = new Map<string, number>();
  const specsMap = new Map<string, Set<string>>();
  let count = 0;

  for (const m of modules) {
    const pkg = readJson<{
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    }>(path.join(m.path, "package.json"));
    if (!pkg) continue;
    const bags = [pkg.dependencies, pkg.devDependencies, pkg.peerDependencies];
    for (const bag of bags) {
      if (!bag) continue;
      for (const depName of Object.keys(bag)) {
        const toId = nameToId.get(depName);
        if (!toId || toId === m.id) continue;
        const key = `${m.id}→${toId}`;
        // softer than a real import hit
        weights.set(key, (weights.get(key) ?? 0) + 1);
        const specs = specsMap.get(key) ?? new Set<string>();
        specs.add(`pkg:${depName}`);
        specsMap.set(key, specs);
        count++;
      }
    }
  }

  const notes: string[] = [];
  if (count) {
    notes.push(`workspace package.json 依赖边 ${count} 条（补全漏解析的 import）`);
  }

  return {
    edges: [...weights.entries()].map(([key, weight]) => {
      const [from, to] = key.split("→") as [string, string];
      return {
        from,
        to,
        weight,
        deep: false,
        importSpecs: [...(specsMap.get(key) ?? [])],
      };
    }),
    notes,
  };
}

function mergeEdges(
  primary: ModuleGraph["edges"],
  secondary: ModuleGraph["edges"],
): ModuleGraph["edges"] {
  const map = new Map<string, ModuleGraph["edges"][number]>();
  for (const e of primary) {
    map.set(`${e.from}→${e.to}`, { ...e });
  }
  for (const e of secondary) {
    const key = `${e.from}→${e.to}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...e });
      continue;
    }
    const specs = new Set([
      ...(prev.importSpecs ?? []),
      ...(e.importSpecs ?? []),
    ]);
    map.set(key, {
      ...prev,
      weight: (prev.weight ?? 1) + (e.weight ?? 1),
      deep: Boolean(prev.deep || e.deep),
      importSpecs: [...specs],
    });
  }
  return [...map.values()];
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

const NARRATIVE_CODE_EXTS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".py",
  ".pyi",
  ".go",
  ".java",
  ".kt",
  ".kts",
]);

const JVM_CODE_EXTS = new Set([".java", ".kt", ".kts", ".scala"]);

function isJvmBuildDir(dir: string): boolean {
  return (
    exists(path.join(dir, "pom.xml")) ||
    exists(path.join(dir, "build.gradle")) ||
    exists(path.join(dir, "build.gradle.kts"))
  );
}

function detectMavenModules(root: string, ignore: string[]): string[] | null {
  if (!isJvmBuildDir(root)) return null;
  const kids = listDirs(root, ignore).filter((d) => isJvmBuildDir(d));
  return kids.length >= 2 ? kids : null;
}

function directCodeFiles(dir: string, exts: Set<string>): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile() && exts.has(path.extname(d.name).toLowerCase()))
      .map((d) => path.join(dir, d.name));
  } catch {
    return [];
  }
}

function findEnclosingJvmRoot(dir: string): string | null {
  let cur = dir;
  for (let i = 0; i < 12; i++) {
    const name = path.basename(cur).toLowerCase();
    if (name === "java" || name === "kotlin" || name === "scala") return cur;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

function discoverJvmPackages(
  root: string,
  ignore: string[],
  rules?: ArchitectureRules | null,
  opts?: { repoRoot?: string; labelPrefix?: string },
): { modules: ModuleGraph["modules"]; strategy: string; notes: string[] } | null {
  const repoRoot = opts?.repoRoot ?? root;
  const labelPrefix = opts?.labelPrefix;
  const owned = ["src/main/java", "src/main/kotlin", "src/main/scala"]
    .map((rel) => path.join(root, rel))
    .filter((p) => exists(p) && isDir(p));

  let cursor = root;
  let sourceRoot: string | null = null;
  if (owned.length) {
    sourceRoot = owned[0]!;
    cursor = sourceRoot;
  } else if (findEnclosingJvmRoot(root)) {
    sourceRoot = findEnclosingJvmRoot(root);
    cursor = root;
  }
  if (!sourceRoot) return null;

  for (let i = 0; i < 8; i++) {
    const files = directCodeFiles(cursor, JVM_CODE_EXTS);
    const subs = listDirs(cursor, ignore);
    if (subs.length === 1 && files.length === 0) {
      cursor = subs[0]!;
      continue;
    }
    break;
  }

  const files = directCodeFiles(cursor, JVM_CODE_EXTS).filter((f) => {
    const base = path.basename(f).toLowerCase();
    return base !== "package-info.java" && base !== "module-info.java";
  });
  const subs = listDirs(cursor, ignore);
  if (subs.length < 2 && files.length < 2) return null;

  const applyLayer = (rel: string, guessed?: string) =>
    (rules ? layerFromRules(rel, rules) : undefined) ?? guessed;
  const pkg = path.relative(sourceRoot, cursor).replace(/\\/g, "/") || ".";

  const toModule = (target: string, file: boolean) => {
    const rel = path.relative(repoRoot, target).replace(/\\/g, "/");
    const stem = file
      ? path.basename(target, path.extname(target))
      : path.basename(target);
    const bare = labelPrefix
      ? `${stripGenericLabel(labelPrefix) ?? labelPrefix}/${stem}`
      : stem;
    return {
      id: slugId(rel),
      path: target,
      label: bare,
      layer: applyLayer(rel, guessLayer(rel)),
    };
  };

  const modules = [
    ...subs.map((d) => toModule(d, false)),
    ...(files.length >= 2 && files.length <= 36
      ? files.map((f) => toModule(f, true))
      : []),
  ];
  if (owned.length) {
    for (const app of staticFrontendDirs(root)) {
      const rel = path.relative(repoRoot, app).replace(/\\/g, "/");
      if (modules.some((m) => path.normalize(m.path) === path.normalize(app))) continue;
      modules.push({
        id: slugId(rel),
        path: app,
        label: labelPrefix
          ? `${stripGenericLabel(labelPrefix) ?? labelPrefix}/${path.basename(app)}`
          : path.basename(app),
        layer: "ui",
      });
    }
  }
  if (modules.length < 2) return null;
  const uiCount = modules.filter((m) => m.layer === "ui").length;
  return {
    modules,
    strategy: "jvm-package",
    notes: [
      `按 Java 包聚合（${pkg} · ${modules.length - uiCount} 株${
        uiCount ? `，前端 ${uiCount}` : ""
      }）`,
    ],
  };
}

function discoverMavenReactor(
  root: string,
  ignore: string[],
  rules?: ArchitectureRules | null,
): { modules: ModuleGraph["modules"]; strategy: string; notes: string[] } | null {
  const kids = detectMavenModules(root, ignore);
  if (!kids) return null;
  const applyLayer = (rel: string, guessed?: string) =>
    (rules ? layerFromRules(rel, rules) : undefined) ?? guessed;
  const seen = new Set(kids.map((d) => path.normalize(d)));
  const dirs = [...kids];
  for (const d of listDirs(root, ignore)) {
    if (seen.has(path.normalize(d))) continue;
    if (exists(path.join(d, "package.json"))) dirs.push(d);
  }
  const modules = dirs.map((dir) => {
    const rel = path.relative(root, dir).replace(/\\/g, "/") || ".";
    const label = moduleLabel(dir, root);
    return {
      id: slugId(rel || label),
      path: dir,
      label,
      layer: applyLayer(rel, guessLayer(rel)),
    };
  });
  for (const app of staticFrontendDirs(root)) {
    const norm = path.normalize(app);
    if (seen.has(norm)) continue;
    seen.add(norm);
    const rel = path.relative(root, app).replace(/\\/g, "/");
    modules.push({
      id: slugId(rel),
      path: app,
      label: path.basename(app),
      layer: "ui",
    });
  }
  const fronts = modules.length - kids.length;
  return {
    modules,
    strategy: "maven",
    notes: [
      `识别到 Maven 模块（${kids.length}）${fronts ? `，另有前端 ${fronts}` : ""}`,
    ],
  };
}

function staticFrontendDirs(root: string): string[] {
  const out: string[] = [];
  const consider = (dir: string) => {
    const base = path.join(dir, "src", "main", "resources", "static");
    if (!exists(base) || !isDir(base)) return;
    for (const app of listDirs(base, [])) {
      const hit = walkFiles(
        app,
        [],
        12,
        new Set([".js", ".mjs", ".html", ".tsx", ".jsx", ".vue"]),
      );
      if (hit.length) out.push(app);
    }
  };
  consider(root);
  if (isJvmBuildDir(root)) {
    for (const d of listDirs(root, [])) {
      if (isJvmBuildDir(d)) consider(d);
    }
  }
  return out;
}

function narrativeLang(file: string): string {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".java" || ext === ".kt" || ext === ".kts" || ext === ".scala") return "jvm";
  if (ext === ".py" || ext === ".pyi") return "py";
  if (ext === ".go") return "go";
  if (ext === ".tsx" || ext === ".jsx" || ext === ".vue" || ext === ".svelte") return "ui";
  return "js";
}

function spreadTake(files: string[], cap: number, root: string): string[] {
  if (files.length <= cap) return files;
  const buckets = new Map<string, string[]>();
  for (const file of files) {
    const top = path.relative(root, file).split(/[/\\]/)[0] || ".";
    const arr = buckets.get(top) ?? [];
    arr.push(file);
    buckets.set(top, arr);
  }
  const lists = [...buckets.values()];
  const out: string[] = [];
  let round = 0;
  while (out.length < cap) {
    let added = false;
    for (const list of lists) {
      if (round < list.length) {
        out.push(list[round]!);
        added = true;
        if (out.length >= cap) break;
      }
    }
    if (!added) break;
    round += 1;
  }
  return out;
}

function discoverFiles(
  root: string,
  ignore: string[],
): { modules: ModuleGraph["modules"]; strategy: string; notes: string[] } {
  const raw = walkFiles(root, ignore, 8000, NARRATIVE_CODE_EXTS).filter((file) => {
    const norm = file.replace(/\\/g, "/");
    return !norm.includes("/src/test/") && !norm.includes("/src/it/");
  });
  const byLang = new Map<string, string[]>();
  for (const file of raw) {
    const lang = narrativeLang(file);
    const arr = byLang.get(lang) ?? [];
    arr.push(file);
    byLang.set(lang, arr);
  }
  let major = "";
  let majorCount = 0;
  for (const [lang, list] of byLang) {
    if (list.length > majorCount) {
      major = lang;
      majorCount = list.length;
    }
  }
  const files: string[] = [];
  for (const [lang, list] of byLang) {
    const cap = lang === major && byLang.size > 1 ? 24 : 40;
    files.push(...spreadTake(list, cap, root));
  }
  const notes = [
    `按文件聚合（${raw.length} 个源文件，均衡采样 ${files.length}，避免 ${major || "单一语言"} 淹没其他语言）`,
  ];
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

function discoverFeatureDirs(
  root: string,
  ignore: string[],
  rules?: ArchitectureRules | null,
  opts?: { minKids?: number; repoRoot?: string; labelPrefix?: string },
): { modules: ModuleGraph["modules"]; strategy: string; notes: string[] } | null {
  const jvm = discoverJvmPackages(root, ignore, rules, {
    repoRoot: opts?.repoRoot,
    labelPrefix: opts?.labelPrefix,
  });
  if (jvm) return jvm;

  const minKids = opts?.minKids ?? 2;
  const repoRoot = opts?.repoRoot ?? root;
  const labelPrefix = opts?.labelPrefix;
  const candidates = [
    path.join(root, "src", "features"),
    path.join(root, "src", "modules"),
    path.join(root, "src", "packages"),
    path.join(root, "src", "domains"),
    path.join(root, "app", "modules"),
    path.join(root, "apps"),
    path.join(root, "packages"),
  ];
  const applyLayer = (rel: string, guessed?: string) =>
    (rules ? layerFromRules(rel, rules) : undefined) ?? guessed;

  const toModule = (dir: string) => {
    const rel = path.relative(repoRoot, dir).replace(/\\/g, "/");
    const base = path.basename(dir);
    return {
      id: slugId(rel),
      path: dir,
      label: labelPrefix ? `${labelPrefix}/${base}` : base,
      layer: applyLayer(rel, guessLayer(rel)),
    };
  };

  for (const base of candidates) {
    if (!exists(base)) continue;
    // don't treat repo-root packages/ as feature dirs when root === repoRoot
    // (that's workspace territory); allow when drilling into a single package
    if (
      path.normalize(base) === path.normalize(path.join(repoRoot, "packages")) &&
      path.normalize(root) === path.normalize(repoRoot)
    ) {
      continue;
    }
    const kids = listDirs(base, ignore);
    if (kids.length < minKids) continue;
    const relBase = path.relative(repoRoot, base).replace(/\\/g, "/");
    return {
      modules: kids.map(toModule),
      strategy: "feature",
      notes: [`按功能目录聚合（${relBase} · ${kids.length} 株）`],
    };
  }

  // Prefer narrative folders under src/app/lib; when sparse, keep more of them
  for (const sub of ["src", "app", "lib"]) {
    const base = path.join(root, sub);
    if (!exists(base)) continue;
    const noise = new Set([
      "assets",
      "public",
      "static",
      "styles",
      "css",
      "__tests__",
      "test",
      "tests",
      "__mocks__",
      "fixtures",
      "node_modules",
    ]);
    // only drop tiny utility folders when we already have enough kids
    const softNoise = new Set([
      "types",
      "typings",
      "constants",
      "config",
    ]);
    let kids = listDirs(base, ignore).filter(
      (d) => !noise.has(path.basename(d).toLowerCase()),
    );
    if (kids.length >= 6) {
      kids = kids.filter((d) => !softNoise.has(path.basename(d).toLowerCase()));
    }
    if (kids.length >= minKids && kids.length <= 36) {
      const relBase = path.relative(repoRoot, base).replace(/\\/g, "/");
      return {
        modules: kids.map(toModule),
        strategy: "src-dir",
        notes: [`按 ${relBase} 子目录叙事聚合（${kids.length} 株）`],
      };
    }
  }

  // package root children that look like code areas
  const topKids = listDirs(root, ignore).filter((d) => {
    const name = path.basename(d).toLowerCase();
    return ![
      "node_modules",
      "dist",
      "build",
      "coverage",
      ".flora",
      "docs",
      "doc",
      "scripts",
      "script",
      "tooling",
      "tools",
      "examples",
      "example",
      "fixtures",
    ].includes(name);
  });
  if (topKids.length >= minKids && topKids.length <= 24) {
    return {
      modules: topKids.map(toModule),
      strategy: "dir-drill",
      notes: [
        `按包内一级目录下钻（${topKids.length} 株${
          labelPrefix ? ` · ${labelPrefix}` : ""
        }）`,
      ],
    };
  }

  // Lone src/lib/app folder → recurse so flat-file / feature discovery still runs
  if (topKids.length === 1) {
    const only = topKids[0]!;
    const name = path.basename(only).toLowerCase();
    if (["src", "lib", "app"].includes(name)) {
      const nested = discoverFeatureDirs(only, ignore, rules, {
        minKids,
        repoRoot,
        labelPrefix,
      });
      if (nested) return nested;
    }
  }

  // Flat src (many .ts files, no subfolders): each file becomes a plant
  const flatFiles = expandFlatSourceFiles(root, repoRoot, ignore, labelPrefix, rules);
  if (flatFiles) return flatFiles;

  return null;
}

const GENERIC_CONTAINER = new Set(["src", "lib", "app", "source"]);

function stripGenericLabel(label: string | undefined): string | undefined {
  if (!label) return undefined;
  const parts = label
    .split("/")
    .filter((p) => p && !GENERIC_CONTAINER.has(p.toLowerCase()));
  return parts.length ? parts.join("/") : undefined;
}

/** Don't leave a plant literally named `src` — open that folder. */
function liftGenericContainers(
  modules: ModuleGraph["modules"],
  repoRoot: string,
  ignore: string[],
  rules?: ArchitectureRules | null,
  depth = 0,
): ModuleGraph["modules"] {
  if (depth > 3 || !modules.length) return modules;
  const out: ModuleGraph["modules"] = [];
  let lifted = false;
  for (const m of modules) {
    const base = path.basename(m.path).toLowerCase();
    if (!GENERIC_CONTAINER.has(base) || !isDir(m.path)) {
      out.push(m);
      continue;
    }
    const prefix = stripGenericLabel(m.label);
    const inner = discoverFeatureDirs(m.path, ignore, rules, {
      minKids: 2,
      repoRoot,
      labelPrefix: prefix,
    });
    if (inner && inner.modules.length >= 2) {
      lifted = true;
      out.push(...inner.modules);
      continue;
    }
    const owner = path.basename(path.dirname(m.path));
    out.push({
      ...m,
      label:
        owner && !GENERIC_CONTAINER.has(owner.toLowerCase())
          ? owner
          : m.label ?? owner,
    });
  }
  return lifted
    ? liftGenericContainers(out, repoRoot, ignore, rules, depth + 1)
    : out;
}

function expandFlatSourceFiles(
  dir: string,
  repoRoot: string,
  ignore: string[],
  labelPrefix: string | undefined,
  rules?: ArchitectureRules | null,
): { modules: ModuleGraph["modules"]; strategy: string; notes: string[] } | null {
  if (!exists(dir) || !isDir(dir)) return null;
  // Prefer direct children source files (flat package layout)
  let entries: string[] = [];
  try {
    entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => path.join(dir, d.name));
  } catch {
    return null;
  }
  const codeExt = new Set([
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".py",
    ".go",
    ".java",
    ".kt",
    ".kts",
  ]);
  const files = entries.filter((f) => {
    const ext = path.extname(f).toLowerCase();
    const base = path.basename(f).toLowerCase();
    if (!codeExt.has(ext)) return false;
    if (base.endsWith(".d.ts") || base.endsWith(".test.ts") || base.endsWith(".spec.ts")) {
      return false;
    }
    if (base === "index.ts" || base === "index.js" || base === "main.ts") return false;
    return true;
  });
  if (files.length < 3 || files.length > 48) return null;

  const applyLayer = (rel: string, guessed?: string) =>
    (rules ? layerFromRules(rel, rules) : undefined) ?? guessed;

  const modules = files.map((file) => {
    const rel = path.relative(repoRoot, file).replace(/\\/g, "/");
    const stem = path.basename(file, path.extname(file));
    return {
      id: slugId(rel),
      path: file,
      label: labelPrefix ? `${stripGenericLabel(labelPrefix) ?? labelPrefix}/${stem}` : stem,
      layer: applyLayer(rel, guessLayer(rel)),
    };
  });
  return {
    modules,
    strategy: "flat-files",
    notes: [
      `扁平源码按文件成株（${path.relative(repoRoot, dir) || "."} · ${modules.length} 株）`,
    ],
  };
}

/** When auto would yield too few plants, drill into each package's internals. */
function expandSparseModules(
  modules: ModuleGraph["modules"],
  repoRoot: string,
  ignore: string[],
  rules?: ArchitectureRules | null,
  minPlants = 4,
): { modules: ModuleGraph["modules"]; strategy: string; notes: string[] } | null {
  if (modules.length >= minPlants) return null;
  if (!modules.length) return null;

  const expanded: ModuleGraph["modules"] = [];
  const notes: string[] = [
    `仅发现 ${modules.length} 个粗粒度模块，自动下钻以丰富花园（目标 ≥${minPlants} 株）`,
  ];
  let drilled = false;

  for (const m of modules) {
    const multi = modules.length > 1;
    const prefix = multi ? m.label ?? path.basename(m.path) : undefined;
    const tryRoots = [m.path];
    const baseName = path.basename(m.path).toLowerCase();
    // If the coarse module is already src/lib/app, also try package root
    if (["src", "lib", "app"].includes(baseName)) {
      tryRoots.push(path.dirname(m.path));
    }

    let inner: ReturnType<typeof discoverFeatureDirs> = null;
    for (const tryRoot of tryRoots) {
      inner = discoverFeatureDirs(tryRoot, ignore, rules, {
        minKids: 2,
        repoRoot,
        labelPrefix: prefix,
      });
      if (inner && inner.modules.length >= 2) break;
      inner = null;
    }

    if (inner && inner.modules.length >= 2) {
      drilled = true;
      expanded.push(...inner.modules);
      notes.push(
        `下钻「${m.label ?? m.id}」→ ${inner.modules.length} 株（${inner.strategy}）`,
      );
    } else {
      expanded.push(m);
    }
  }

  if (!drilled || expanded.length <= modules.length) return null;

  const seen = new Set<string>();
  const uniq = expanded.filter((m) => {
    const key = path.normalize(m.path);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const lifted = liftGenericContainers(uniq, repoRoot, ignore, rules);
  notes.push(`下钻后共 ${lifted.length} 株`);
  return { modules: lifted, strategy: "drill-down", notes };
}

function pickAutoStrategy(
  root: string,
  ignore: string[],
  rules?: ArchitectureRules | null,
  sparseFloor = 4,
): { modules: ModuleGraph["modules"]; strategy: string; notes: string[] } {
  const workspaceDirs = detectWorkspaces(root);

  if (workspaceDirs?.length) {
    // Few packages → prefer drilling into package internals for a real garden
    if (workspaceDirs.length <= 3) {
      const packageMods = workspaceDirs.map((dir) => {
        const rel = path.relative(root, dir).replace(/\\/g, "/") || ".";
        const label = moduleLabel(dir, root);
        return {
          id: slugId(label.startsWith("@") ? label : rel || label),
          path: dir,
          label,
          layer:
            (rules ? layerFromRules(rel, rules) : undefined) ?? guessLayer(rel),
        };
      });
      const drilled = expandSparseModules(
        packageMods,
        root,
        ignore,
        rules,
        sparseFloor,
      );
      if (drilled) {
        drilled.notes.unshift(
          `workspaces 仅 ${workspaceDirs.length} 包，启用下钻叙事`,
        );
        return drilled;
      }
      // single fat package: try features inside first package only
      const feature = discoverFeatureDirs(workspaceDirs[0]!, ignore, rules, {
        minKids: 2,
        repoRoot: root,
      });
      if (feature && feature.modules.length >= 2) {
        feature.notes.unshift(
          `workspaces 仅 ${workspaceDirs.length} 包，改用功能目录叙事`,
        );
        return feature;
      }
    }
    const pkgs = discoverPackages(root, ignore, rules);
    const drilled = expandSparseModules(
      pkgs.modules,
      root,
      ignore,
      rules,
      sparseFloor,
    );
    if (drilled) {
      return {
        modules: drilled.modules,
        strategy: drilled.strategy,
        notes: [...pkgs.notes, ...drilled.notes],
      };
    }
    return pkgs;
  }

  const maven = discoverMavenReactor(root, ignore, rules);
  if (maven) {
    if (maven.modules.length < sparseFloor) {
      const drilled = expandSparseModules(
        maven.modules,
        root,
        ignore,
        rules,
        sparseFloor,
      );
      if (drilled) {
        return {
          modules: drilled.modules,
          strategy: drilled.strategy,
          notes: [...maven.notes, ...drilled.notes],
        };
      }
    }
    return maven;
  }

  const feature = discoverFeatureDirs(root, ignore, rules, {
    minKids: 2,
    repoRoot: root,
  });
  if (feature) return feature;

  const pkgs = discoverPackages(root, ignore, rules);
  const drilled = expandSparseModules(
    pkgs.modules,
    root,
    ignore,
    rules,
    sparseFloor,
  );
  if (drilled) {
    return {
      modules: drilled.modules,
      strategy: drilled.strategy,
      notes: [...pkgs.notes, ...drilled.notes],
    };
  }
  return pkgs;
}

export interface DiscoverOptions {
  targetPlants?: number;
}

export function discoverModuleGraph(
  root: string,
  granularity: AggregateGranularity = "auto",
  ignore: string[] = DEFAULT_IGNORE,
  rules?: ArchitectureRules | null,
  modulesMap?: FloraModulesMap | null,
  discoverOpts?: DiscoverOptions,
): ModuleGraph {
  const abs = path.resolve(root);
  const rulesDoc = rules ?? loadRules(abs);
  const map = modulesMap ?? loadModulesMap(abs);
  const effectiveIgnore = [
    ...ignore,
    ...(map?.ignore ?? []).map((p) => p.replace(/\/\*\*$/, "").replace(/\*$/, "")),
  ];
  const effectiveGranularity =
    granularity === "auto" && map?.granularity ? map.granularity : granularity;
  const targetPlants = clampTargetPlants(discoverOpts?.targetPlants);
  const sparseFloor = targetPlants ?? 4;

  let discovered;
  if (effectiveGranularity === "file") {
    discovered = discoverFiles(abs, effectiveIgnore);
  } else if (effectiveGranularity === "directory") {
    const dirs = listDirs(abs, effectiveIgnore);
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
      discovered = discoverPackages(abs, effectiveIgnore, rulesDoc);
    }
  } else if (effectiveGranularity === "package") {
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
      discovered = discoverPackages(abs, effectiveIgnore, rulesDoc);
      discovered.notes.push("未找到 workspaces，回退自动策略");
    }
  } else {
    discovered = pickAutoStrategy(abs, effectiveIgnore, rulesDoc, sparseFloor);
  }

  if (map) {
    const overlay = applyModulesMap(abs, discovered.modules, map, (dir) =>
      listDirs(dir, effectiveIgnore),
    );
    discovered.modules = overlay.modules;
    discovered.notes.push(`模块地图: ${map.source ?? "flora.modules.yaml"}`);
    discovered.notes.push(...overlay.notes);
  }

  // After overlays, still too few plants under auto → one more drill attempt
  if (
    effectiveGranularity === "auto" &&
    discovered.modules.length > 0 &&
    discovered.modules.length < sparseFloor &&
    discovered.strategy !== "file"
  ) {
    const again = expandSparseModules(
      discovered.modules,
      abs,
      effectiveIgnore,
      rulesDoc,
      sparseFloor,
    );
    if (again) {
      discovered = {
        modules: again.modules,
        strategy: again.strategy,
        notes: [...discovered.notes, ...again.notes],
      };
    }
  }

  if (effectiveGranularity === "auto") {
    const lifted = liftGenericContainers(
      discovered.modules,
      abs,
      effectiveIgnore,
      rulesDoc,
    );
    if (lifted.length !== discovered.modules.length) {
      discovered.modules = lifted;
      discovered.notes.push("已展开名为 src/lib/app 的容器目录");
    } else {
      discovered.modules = lifted;
    }
  }

  let idRemap = new Map<string, string>();
  if (
    targetPlants &&
    discovered.modules.length > targetPlants &&
    effectiveGranularity === "auto"
  ) {
    const fitted = fitModulesToTarget(discovered.modules, targetPlants, abs);
    discovered.modules = fitted.modules;
    idRemap = fitted.idRemap;
    discovered.notes.push(...fitted.notes);
    discovered.strategy = `${discovered.strategy}+target`;
  }

  const fromImports = buildEdgesFromImports(
    abs,
    discovered.modules,
    effectiveIgnore,
  );
  const fromPkgs = buildEdgesFromPackageJson(discovered.modules);
  let edges = mergeEdges(fromImports.edges, fromPkgs.edges);
  if (idRemap.size) edges = remapEdges(edges, idRemap);
  discovered.notes.push(...fromImports.notes);
  discovered.notes.push(...fromPkgs.notes);
  discovered.notes.push(`解析依赖边 ${edges.length}`);
  return {
    modules: discovered.modules,
    edges,
    strategy: discovered.strategy,
    notes: discovered.notes,
  };
}
