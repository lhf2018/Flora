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

  const minDist =
    plants.length <= 6 ? 108 : plants.length <= 12 ? 88 : plants.length <= 20 ? 72 : 60;

  for (let iter = 0; iter < 80; iter++) {
    for (let i = 0; i < plants.length; i++) {
      for (let j = i + 1; j < plants.length; j++) {
        const a = plants[i]!;
        const b = plants[j]!;
        const pa = positions[a.id]!;
        const pb = positions[b.id]!;
        let dx = pa.x - pb.x;
        let dy = pa.y - pb.y;
        let dist = Math.hypot(dx, dy) || 0.01;
        const sameBand = Math.abs(pa.y - pb.y) < 70;
        const target = sameBand ? minDist * 1.05 : minDist;
        if (dist < target) {
          const f = ((target - dist) / dist) * 0.12;
          dx *= f;
          dy *= f * (sameBand ? 0.4 : 1);
          pa.x += dx;
          pa.y += dy;
          pb.x -= dx;
          pb.y -= dy;
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
      const ideal = v.kind === "cycle" ? 140 : 118;
      const f = ((dist - ideal) / dist) * 0.02 * (0.35 + v.strength);
      pa.x += dx * f;
      pa.y += dy * f;
      pb.x -= dx * f;
      pb.y -= dy * f;
    }
  }

  fitInside(positions);

  return { positions, width: WIDTH, height: HEIGHT };
}

/** Pull the garden into a padded frame so labels stay inside and off the legend. */
function fitInside(positions: Record<string, { x: number; y: number }>) {
  const ids = Object.keys(positions);
  if (!ids.length) return;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of ids) {
    const p = positions[id]!;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  // room for legend (top), name plates (bottom), and side labels
  const padL = 150;
  const padR = 110;
  const padT = 150;
  const padB = 140;
  const destW = WIDTH - padL - padR;
  const destH = HEIGHT - padT - padB;
  const bw = Math.max(40, maxX - minX);
  const bh = Math.max(40, maxY - minY);
  const scale = Math.min(1, destW / bw, destH / bh);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const dcx = padL + destW / 2;
  const dcy = padT + destH / 2;
  for (const id of ids) {
    const p = positions[id]!;
    p.x = dcx + (p.x - cx) * scale;
    p.y = dcy + (p.y - cy) * scale;
  }
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
