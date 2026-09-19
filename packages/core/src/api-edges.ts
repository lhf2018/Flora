import fs from "node:fs";
import path from "node:path";
import { exists, walkFiles } from "./fs.js";
import { edgeSourceExts } from "./adapters.js";
import type { ModuleGraph } from "./types.js";

const GENERIC_ROUTES = new Set([
  "/",
  "/api",
  "/health",
  "/ping",
  "/ready",
  "/live",
  "/static",
  "/public",
  "/assets",
  "/favicon.ico",
]);

export function normalizeHttpPath(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  s = s.replace(/^["'`]+/, "").replace(/["'`]+$/, "");
  s = s.replace(/\\/g, "/");
  s = s.replace(/^https?:\/\/[^/]+/i, "");
  s = s.replace(/[?#].*$/, "");
  s = s.replace(/\$\{[^}]+\}/g, "{p}");
  s = s.replace(/:[A-Za-z_][\w]*/g, "{p}");
  s = s.replace(/\{[^}]+\}/g, "{p}");
  s = s.replace(/\/\d+(?=\/|$)/g, "/{p}");
  s = s.replace(/\/{2,}/g, "/");
  if (s.length > 1) s = s.replace(/\/$/, "");
  if (!s.startsWith("/")) s = `/${s}`;
  s = s.toLowerCase();
  if (GENERIC_ROUTES.has(s)) return null;
  const segs = s.split("/").filter(Boolean);
  if (segs.length < 2) return null;
  return s;
}

function joinRoute(prefix: string, sub: string): string {
  const a = prefix.trim();
  const b = sub.trim();
  if (!b) return a;
  if (b.startsWith("http")) return b;
  if (!a) return b.startsWith("/") ? b : `/${b}`;
  return `${a.replace(/\/$/, "")}/${b.replace(/^\//, "")}`;
}

export function httpRoutesMatch(client: string, server: string): boolean {
  if (client === server) return true;
  const c = client.replace(/\/\{p\}$/g, "");
  const s = server.replace(/\/\{p\}$/g, "");
  if (c === s) return true;
  if (c.startsWith(`${s}/`) || s.startsWith(`${c}/`)) return true;
  const cTail = c.split("/").filter(Boolean).slice(-2).join("/");
  const sTail = s.split("/").filter(Boolean).slice(-2).join("/");
  return Boolean(cTail && cTail === sTail);
}

function annotationPath(args: string | undefined): string {
  if (!args) return "";
  const m = args.match(/(?:(?:value|path)\s*=\s*)?["']([^"']+)["']/);
  return m?.[1] ?? "";
}

export function extractHttpClients(source: string): string[] {
  const out = new Set<string>();
  const push = (raw: string | undefined) => {
    const n = raw ? normalizeHttpPath(raw) : null;
    if (n) out.add(n);
  };

  for (const m of source.matchAll(
    /\b(?:fetch|axios)\s*(?:\.(?:get|post|put|delete|patch|request))?\s*\(\s*["'`]([^"'`]+)["'`]/g,
  )) {
    push(m[1]);
  }
  for (const m of source.matchAll(
    /\baxios\s*\(\s*\{[\s\S]*?\burl\s*:\s*["'`]([^"'`]+)["'`]/g,
  )) {
    push(m[1]);
  }
  for (const m of source.matchAll(
    /\b(?:httpx?|https|requests|got|ky|\$http)\.(?:get|post|put|delete|patch|request)\s*\(\s*["'`]([^"'`]+)["'`]/gi,
  )) {
    push(m[1]);
  }
  for (const m of source.matchAll(
    /urllib\.request\.urlopen\(\s*["']([^"']+)["']/g,
  )) {
    push(m[1]);
  }
  // Feign mappings are outbound clients
  if (/@FeignClient\b/.test(source)) {
    for (const p of extractSpringMappings(source)) push(p);
  }

  return [...out];
}

export function extractHttpRoutes(source: string): string[] {
  const out = new Set<string>();
  const push = (raw: string | undefined) => {
    const n = raw ? normalizeHttpPath(raw) : null;
    if (n) out.add(n);
  };

  if (!/@FeignClient\b/.test(source)) {
    for (const p of extractSpringMappings(source)) push(p);
  }
  for (const p of extractNestMappings(source)) push(p);

  for (const m of source.matchAll(
    /(?:app|router|server|r|api|mux)\.(?:get|post|put|delete|patch|all|use|handle)\s*\(\s*["'`](\/[^"'`]+)["'`]/gi,
  )) {
    push(m[1]);
  }
  for (const m of source.matchAll(
    /\.(?:GET|POST|PUT|DELETE|PATCH|HandleFunc|Handle)\s*\(\s*"(\/[^"]+)"/g,
  )) {
    push(m[1]);
  }
  for (const m of source.matchAll(
    /@(?:app|router|api|bp|blueprint)\.(?:get|post|put|delete|patch|route)\(\s*["']([^"']+)["']/g,
  )) {
    push(m[1]);
  }
  for (const m of source.matchAll(
    /add_url_rule\(\s*["']([^"']+)["']/g,
  )) {
    push(m[1]);
  }

  return [...out];
}

function extractSpringMappings(source: string): string[] {
  const classPrefix = classAnnotationPrefix(source, "RequestMapping");
  const paths: string[] = [];
  for (const m of source.matchAll(
    /@(Get|Post|Put|Delete|Patch)Mapping\s*(?:\(([^)]*)\))?/g,
  )) {
    paths.push(joinRoute(classPrefix, annotationPath(m[2])));
  }
  for (const m of source.matchAll(/@RequestMapping\s*(?:\(([^)]*)\))?/g)) {
    const after = source.slice(
      (m.index ?? 0) + m[0].length,
      (m.index ?? 0) + m[0].length + 96,
    );
    if (/\b(?:class|interface)\b/.test(after.split("{")[0] ?? after)) continue;
    paths.push(joinRoute(classPrefix, annotationPath(m[1])));
  }
  if (!paths.length && classPrefix) paths.push(classPrefix);
  return paths;
}

function extractNestMappings(source: string): string[] {
  const prefix = classAnnotationPrefix(source, "Controller");
  const paths: string[] = [];
  for (const m of source.matchAll(
    /@(?:Get|Post|Put|Delete|Patch|All|Head|Options)\s*(?:\(([^)]*)\))?/g,
  )) {
    const sub = annotationPath(m[1]);
    paths.push(joinRoute(prefix, sub));
  }
  return paths;
}

function classAnnotationPrefix(source: string, name: string): string {
  const re = new RegExp(
    `@${name}\\s*(?:\\(([^)]*)\\))?\\s*(?:export\\s+)?(?:public\\s+)?(?:final\\s+)?(?:class|interface)\\b`,
  );
  const m = source.match(re);
  return annotationPath(m?.[1]);
}

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

export interface HttpHit {
  moduleId: string;
  paths: string[];
}

export function collectHttpContracts(
  root: string,
  modules: Array<{ id: string; path: string }>,
  ignore: string[],
): { clients: HttpHit[]; servers: HttpHit[] } {
  const clientMap = new Map<string, Set<string>>();
  const serverMap = new Map<string, Set<string>>();
  const files = walkFiles(root, ignore, 12000, edgeSourceExts());

  for (const file of files) {
    const fromId = fileToModule(file, modules);
    if (!fromId) continue;
    let source = "";
    try {
      if (!exists(file)) continue;
      const st = fs.statSync(file);
      if (!st.isFile() || st.size > 512 * 1024) continue;
      source = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const clients = extractHttpClients(source);
    const routes = extractHttpRoutes(source);
    if (clients.length) {
      const set = clientMap.get(fromId) ?? new Set<string>();
      for (const p of clients) set.add(p);
      clientMap.set(fromId, set);
    }
    if (routes.length) {
      const set = serverMap.get(fromId) ?? new Set<string>();
      for (const p of routes) set.add(p);
      serverMap.set(fromId, set);
    }
  }

  return {
    clients: [...clientMap.entries()].map(([moduleId, paths]) => ({
      moduleId,
      paths: [...paths],
    })),
    servers: [...serverMap.entries()].map(([moduleId, paths]) => ({
      moduleId,
      paths: [...paths],
    })),
  };
}

/** Client module → server module edges from shared HTTP paths. */
export function buildHttpEdges(
  root: string,
  modules: Array<{ id: string; path: string }>,
  ignore: string[],
): {
  edges: ModuleGraph["edges"];
  notes: string[];
} {
  const { clients, servers } = collectHttpContracts(root, modules, ignore);
  const weights = new Map<string, number>();
  const pathsMap = new Map<string, Set<string>>();

  for (const client of clients) {
    for (const cPath of client.paths) {
      for (const server of servers) {
        if (server.moduleId === client.moduleId) continue;
        const hit = server.paths.find((sPath) => httpRoutesMatch(cPath, sPath));
        if (!hit) continue;
        const key = `${client.moduleId}→${server.moduleId}`;
        weights.set(key, (weights.get(key) ?? 0) + 1);
        const set = pathsMap.get(key) ?? new Set<string>();
        set.add(cPath);
        pathsMap.set(key, set);
      }
    }
  }

  const edges: ModuleGraph["edges"] = [...weights.entries()].map(
    ([key, weight]) => {
      const [from, to] = key.split("→") as [string, string];
      const httpPaths = [...(pathsMap.get(key) ?? [])];
      return {
        from,
        to,
        weight,
        deep: false,
        source: "http" as const,
        httpPaths,
        importSpecs: httpPaths.map((p) => `http:${p}`),
      };
    },
  );

  const notes: string[] = [];
  if (edges.length) {
    const samples = edges
      .slice(0, 4)
      .map((e) => `${e.httpPaths?.[0] ?? "?"} → ${e.to}`)
      .join("；");
    notes.push(`跨语言 HTTP 藤蔓 ${edges.length} 条（${samples}）`);
  }

  return { edges, notes };
}
