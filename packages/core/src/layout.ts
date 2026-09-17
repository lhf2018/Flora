import type { LayoutCache, LayoutHint, Plant, Vine } from "./types.js";
import { exists, readJson, writeJson } from "./fs.js";

const WIDTH = 1280;
const HEIGHT = 860;
const MARGIN = 110;

const LAYER_ORDER = ["ui", "application", "domain", "infra", "default"];
const LAYER_LABELS: Record<string, string> = {
  ui: "UI",
  application: "Application",
  domain: "Domain",
  infra: "Infra",
  default: "Modules",
};

function layerIndex(layer?: string): number {
  if (!layer) return LAYER_ORDER.indexOf("default");
  const i = LAYER_ORDER.indexOf(layer);
  return i >= 0 ? i : LAYER_ORDER.indexOf("default");
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function seedPositions(plants: Plant[]): Record<string, { x: number; y: number }> {
  const groups = new Map<number, Plant[]>();
  for (const p of plants) {
    const li = layerIndex(p.layer);
    if (!groups.has(li)) groups.set(li, []);
    groups.get(li)!.push(p);
  }

  const positions: Record<string, { x: number; y: number }> = {};
  const layers = [...groups.keys()].sort((a, b) => a - b);
  const usableH = HEIGHT - MARGIN * 2;
  const usableW = WIDTH - MARGIN * 2;

  layers.forEach((li, row) => {
    const rowPlants = groups.get(li)!;
    // sort by coupling so important nodes aren't jammed
    rowPlants.sort((a, b) => b.metrics.coupling - a.metrics.coupling);
    const y =
      layers.length === 1
        ? HEIGHT / 2
        : MARGIN + (usableH * row) / Math.max(1, layers.length - 1);
    rowPlants.forEach((p, col) => {
      const x =
        rowPlants.length === 1
          ? WIDTH / 2
          : MARGIN + (usableW * (col + 0.5)) / rowPlants.length;
      const h = hash(p.id);
      positions[p.id] = {
        x: x + ((h % 21) - 10),
        y: y + (((h >> 4) % 17) - 8),
      };
    });
  });
  return positions;
}

/** Force layout with stronger separation for readability. */
export function computeLayout(
  plants: Plant[],
  vines: Vine[],
  cache?: LayoutCache | null,
): LayoutHint {
  const positions = seedPositions(plants);

  if (cache?.positions) {
    for (const p of plants) {
      const cached = cache.positions[p.id];
      if (cached) positions[p.id] = { ...cached };
    }
  }

  const minDist = plants.length <= 8 ? 190 : plants.length <= 16 ? 150 : plants.length <= 28 ? 115 : 95;

  for (let iter = 0; iter < 100; iter++) {
    for (let i = 0; i < plants.length; i++) {
      for (let j = i + 1; j < plants.length; j++) {
        const a = plants[i]!;
        const b = plants[j]!;
        const pa = positions[a.id]!;
        const pb = positions[b.id]!;
        let dx = pa.x - pb.x;
        let dy = pa.y - pb.y;
        let dist = Math.hypot(dx, dy) || 0.01;
        // prefer horizontal separation within same layer band
        const sameBand = Math.abs(pa.y - pb.y) < 80;
        const target = sameBand ? minDist * 1.15 : minDist;
        if (dist < target) {
          const f = ((target - dist) / dist) * 0.14;
          dx *= f;
          dy *= f * (sameBand ? 0.45 : 1);
          if (!cache?.positions[a.id]) {
            pa.x += dx;
            pa.y += dy;
          }
          if (!cache?.positions[b.id]) {
            pb.x -= dx;
            pb.y -= dy;
          }
        }
      }
    }

    for (const v of vines) {
      const pa = positions[v.from];
      const pb = positions[v.to];
      if (!pa || !pb) continue;
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const dist = Math.hypot(dx, dy) || 0.01;
      const ideal = v.kind === "cycle" ? 260 : 230;
      const f = ((dist - ideal) / dist) * 0.014 * (0.4 + v.strength);
      if (!cache?.positions[v.from]) {
        pa.x += dx * f;
        pa.y += dy * f;
      }
      if (!cache?.positions[v.to]) {
        pb.x -= dx * f;
        pb.y -= dy * f;
      }
    }
  }

  for (const id of Object.keys(positions)) {
    const p = positions[id]!;
    p.x = Math.min(WIDTH - 80, Math.max(80, p.x));
    p.y = Math.min(HEIGHT - 80, Math.max(80, p.y));
  }

  return { positions, width: WIDTH, height: HEIGHT };
}

export function loadLayoutCache(filePath: string): LayoutCache | null {
  if (!exists(filePath)) return null;
  return readJson<LayoutCache>(filePath);
}

export function saveLayoutCache(filePath: string, layout: LayoutHint): void {
  const cache: LayoutCache = { version: 1, positions: layout.positions };
  writeJson(filePath, cache);
}

export const LAYOUT_SIZE = { width: WIDTH, height: HEIGHT };
export { LAYER_LABELS, LAYER_ORDER };
