import path from "node:path";
import type { PlantSpecies } from "./types.js";

/** Map file extension → language bucket */
const EXT_LANG: Record<string, string> = {
  ".ts": "ts",
  ".tsx": "tsx",
  ".mts": "ts",
  ".cts": "ts",
  ".js": "js",
  ".jsx": "jsx",
  ".mjs": "js",
  ".cjs": "js",
  ".py": "py",
  ".pyi": "py",
  ".go": "go",
  ".rs": "rs",
  ".java": "java",
  ".kt": "kt",
  ".kts": "kt",
  ".cs": "cs",
  ".vue": "vue",
  ".svelte": "svelte",
  ".css": "css",
  ".scss": "css",
  ".sass": "css",
  ".less": "css",
  ".html": "html",
  ".htm": "html",
  ".md": "md",
  ".mdx": "md",
  ".json": "json",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".toml": "toml",
  ".sh": "shell",
  ".bash": "shell",
  ".zsh": "shell",
  ".ps1": "shell",
  ".dockerfile": "docker",
  ".sql": "sql",
  ".rb": "rb",
  ".php": "php",
  ".swift": "swift",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".hpp": "cpp",
  ".cc": "cpp",
};

export const SOURCE_EXTS = new Set(Object.keys(EXT_LANG));

export function langFromExt(filePath: string): string | null {
  const base = path.basename(filePath).toLowerCase();
  if (base === "dockerfile" || base.startsWith("dockerfile.")) return "docker";
  const ext = path.extname(base).toLowerCase();
  return EXT_LANG[ext] ?? null;
}

/**
 * Pick plant species from language histogram + optional architecture layer.
 * Shape encodes "what it is"; color elsewhere encodes health.
 */
export function deriveSpecies(
  languages: Record<string, number>,
  layer?: string,
): PlantSpecies {
  const total = Object.values(languages).reduce((a, b) => a + b, 0);
  if (!total) return "shrub";

  const share = (keys: string[]) =>
    keys.reduce((s, k) => s + (languages[k] ?? 0), 0) / total;

  const uiShare = share(["tsx", "jsx", "vue", "svelte", "css", "html"]);
  const docsShare = share(["md"]);
  const configShare = share(["json", "yaml", "toml", "shell", "docker", "sql"]);

  // strong UI signal or declared ui layer with frontend files
  if (uiShare >= 0.35 || (layer === "ui" && uiShare >= 0.15)) return "blossom";
  if (docsShare >= 0.5) return "fern";
  // only cactus when config/scripts clearly dominate over application code
  const codeShare = share([
    "ts",
    "tsx",
    "js",
    "jsx",
    "py",
    "go",
    "rs",
    "java",
    "kt",
    "cs",
    "vue",
    "svelte",
    "css",
    "html",
    "c",
    "cpp",
    "rb",
    "php",
    "swift",
  ]);
  if (configShare >= 0.6 && codeShare < 0.25) return "cactus";

  // primary coding language
  const ranked = Object.entries(languages).sort((a, b) => b[1] - a[1]);
  const top = ranked[0]?.[0];

  if (top === "ts" || top === "tsx") {
    // tsx-heavy without enough css still pine; pure tsx+css already caught as blossom
    return top === "tsx" && uiShare >= 0.25 ? "blossom" : "pine";
  }
  if (top === "js" || top === "jsx") {
    return top === "jsx" && uiShare >= 0.25 ? "blossom" : "oak";
  }
  if (top === "py") return "willow";
  if (top === "go") return "bamboo";
  if (top === "rs") return "fir";
  if (top === "java" || top === "kt" || top === "cs") return "maple";
  if (top === "vue" || top === "svelte" || top === "css" || top === "html") {
    return "blossom";
  }
  if (top === "md") return "fern";
  if (top === "shell" || top === "yaml" || top === "docker" || top === "json") {
    return "cactus";
  }

  return "shrub";
}

export function primaryLanguageLabel(languages: Record<string, number>): string {
  const ranked = Object.entries(languages).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return "unknown";
  const total = ranked.reduce((s, [, n]) => s + n, 0);
  return ranked
    .slice(0, 3)
    .map(([lang, n]) => `${lang} ${Math.round((n / total) * 100)}%`)
    .join(" · ");
}
