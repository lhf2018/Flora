import fs from "node:fs";
import path from "node:path";
import { exists, shouldIgnore, walkFiles } from "./fs.js";
import { deriveSpecies, langFromExt, SOURCE_EXTS } from "./species.js";
import type { PlantSpecies } from "./types.js";
import { DEFAULT_IGNORE } from "./types.js";

export interface ModuleSize {
  fileCount: number;
  loc: number;
  languages: Record<string, number>;
  species: PlantSpecies;
}

/** Count source files, LOC, and language mix under a module path. */
export function measureModuleSize(
  modulePath: string,
  ignore: string[] = DEFAULT_IGNORE,
  layer?: string,
): ModuleSize {
  const empty: ModuleSize = {
    fileCount: 0,
    loc: 0,
    languages: {},
    species: "shrub",
  };
  if (!exists(modulePath)) return empty;

  const languages: Record<string, number> = {};
  let fileCount = 0;
  let loc = 0;

  const addFile = (file: string, text: string | null) => {
    const base = path.basename(file).toLowerCase();
    // config noise should not dominate tiny packages
    if (
      base === "package.json" ||
      base === "package-lock.json" ||
      base === "pnpm-lock.yaml" ||
      base === "yarn.lock" ||
      base === "tsconfig.json" ||
      base.startsWith("tsconfig.") ||
      base === "jsconfig.json" ||
      base === ".eslintrc.json" ||
      base === "components.json"
    ) {
      return;
    }
    const lang = langFromExt(file);
    if (!lang) return;
    fileCount++;
    languages[lang] = (languages[lang] ?? 0) + 1;
    if (text) loc += countLines(text);
  };

  try {
    const st = fs.statSync(modulePath);
    if (st.isFile()) {
      let text: string | null = null;
      try {
        text = fs.readFileSync(modulePath, "utf8");
      } catch {
        text = null;
      }
      addFile(modulePath, text);
      return {
        fileCount,
        loc,
        languages,
        species: deriveSpecies(languages, layer),
      };
    }
  } catch {
    return empty;
  }

  const files = walkFiles(modulePath, ignore, 5000, SOURCE_EXTS);
  for (const file of files) {
    if (shouldIgnore(path.basename(file), ignore)) continue;
    let text: string | null = null;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      text = null;
    }
    addFile(file, text);
  }

  return {
    fileCount,
    loc,
    languages,
    species: deriveSpecies(languages, layer),
  };
}

function countLines(text: string): number {
  if (!text) return 0;
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) n++;
  }
  if (text.length && text.charCodeAt(text.length - 1) !== 10) n++;
  return n;
}
