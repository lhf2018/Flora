import type { GardenSnapshot, Plant, PlantSpecies, Vine } from "@flora/core";
import { FloraTokens } from "./tokens.js";
import {
  drawSpeciesIcon,
  drawSpeciesShape,
  plantColor,
  speciesOf,
} from "./species-draw.js";

const DEFAULT_LAYOUT = { width: 1280, height: 860 };

const SPECIES_SHORT: Record<PlantSpecies, string> = {
  pine: "TS 松",
  oak: "JS 橡",
  willow: "Py 柳",
  bamboo: "Go 竹",
  fir: "Rs 杉",
  maple: "JVM 枫",
  blossom: "UI 花",
  fern: "文档蕨",
  cactus: "配置掌",
  shrub: "混合灌",
};

export interface GardenRendererOptions {
  canvas: HTMLCanvasElement;
  snapshot: GardenSnapshot;
  onSelect?: (plant: Plant | null) => void;
  selectedId?: string | null;
  /** ids to emphasize (e.g. PR worsened modules) */
  highlightIds?: string[] | Set<string>;
  /** optional badge text per plant id */
  badges?: Record<string, string>;
  /** title drawn top-right */
  title?: string;
}

function vineColor(kind: Vine["kind"]): string {
  if (kind === "cycle") return FloraTokens.cycle;
  if (kind === "illegal") return FloraTokens.illegal;
  return FloraTokens.vineNormal;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function plantRadius(plant: Plant): number {
  const base = 14 + Math.min(18, Math.sqrt(Math.max(1, plant.metrics.fileCount)) * 2.2);
  if (plant.state === "dying") return base * 0.7;
  return base;
}

export class GardenRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private snapshot: GardenSnapshot;
  private onSelect?: (plant: Plant | null) => void;
  private selectedId: string | null = null;
  private hoverId: string | null = null;
  private highlightIds = new Set<string>();
  private badges: Record<string, string> = {};
  private title = "";
  private raf = 0;
  private t0 = performance.now();
  private dpr = 1;
  private view = { scale: 1, ox: 0, oy: 0 };

  constructor(opts: GardenRendererOptions) {
    this.canvas = opts.canvas;
    const ctx = opts.canvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    this.ctx = ctx;
    this.snapshot = opts.snapshot;
    this.onSelect = opts.onSelect;
    this.selectedId = opts.selectedId ?? null;
    this.setHighlights(opts.highlightIds);
    this.badges = opts.badges ?? {};
    this.title = opts.title ?? "";
    this.resize();
    this.canvas.addEventListener("click", this.handleClick);
    this.canvas.addEventListener("mousemove", this.handleMove);
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  setSnapshot(snapshot: GardenSnapshot) {
    this.snapshot = snapshot;
  }

  setSelected(id: string | null) {
    this.selectedId = id;
  }

  setHighlights(ids?: string[] | Set<string> | null) {
    this.highlightIds = ids
      ? ids instanceof Set
        ? ids
        : new Set(ids)
      : new Set();
  }

  setBadges(badges?: Record<string, string> | null) {
    this.badges = badges ?? {};
  }

  setTitle(title?: string | null) {
    this.title = title ?? "";
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener("click", this.handleClick);
    this.canvas.removeEventListener("mousemove", this.handleMove);
  }

  private layoutSize() {
    return {
      width: this.snapshot.layout.width ?? DEFAULT_LAYOUT.width,
      height: this.snapshot.layout.height ?? DEFAULT_LAYOUT.height,
    };
  }

  resize() {
    const parent = this.canvas.parentElement;
    const w = parent?.clientWidth || this.canvas.clientWidth || 960;
    const h = parent?.clientHeight || this.canvas.clientHeight || 640;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const size = this.layoutSize();
    const sx = w / size.width;
    const sy = h / size.height;
    // tighter fit in split panes so the garden isn't tiny
    const pad = Math.min(w, h) < 560 ? 0.98 : 0.94;
    this.view.scale = Math.min(sx, sy) * pad;
    this.view.ox = (w - size.width * this.view.scale) / 2;
    this.view.oy = (h - size.height * this.view.scale) / 2;
  }

  private worldFromEvent(e: MouseEvent) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left - this.view.ox) / this.view.scale;
    const y = (e.clientY - rect.top - this.view.oy) / this.view.scale;
    return { x, y };
  }

  private hitTest(x: number, y: number): Plant | null {
    const { positions } = this.snapshot.layout;
    let best: Plant | null = null;
    let bestD = 36;
    for (const p of this.snapshot.plants) {
      const pos = positions[p.id];
      if (!pos) continue;
      const d = Math.hypot(pos.x - x, pos.y - y);
      const r = plantRadius(p) + 8;
      if (d < Math.max(bestD, r) && d < r + 6) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  private handleClick = (e: MouseEvent) => {
    const { x, y } = this.worldFromEvent(e);
    const plant = this.hitTest(x, y);
    this.selectedId = plant?.id ?? null;
    this.onSelect?.(plant);
  };

  private handleMove = (e: MouseEvent) => {
    const { x, y } = this.worldFromEvent(e);
    const plant = this.hitTest(x, y);
    this.hoverId = plant?.id ?? null;
    this.canvas.style.cursor = plant ? "pointer" : "default";
  };

  private loop() {
    this.draw(performance.now() - this.t0);
    this.raf = requestAnimationFrame(this.loop);
  }

  private focusId(): string | null {
    return this.selectedId ?? this.hoverId;
  }

  private draw(time: number) {
    const ctx = this.ctx;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const size = this.layoutSize();
    ctx.clearRect(0, 0, w, h);

    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#E7F0EA");
    sky.addColorStop(0.35, "#EDE6D8");
    sky.addColorStop(1, "#C8BFAE");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(this.view.ox, this.view.oy);
    ctx.scale(this.view.scale, this.view.scale);

    // plot frame
    ctx.fillStyle = "rgba(255,255,255,0.28)";
    roundRect(ctx, 24, 24, size.width - 48, size.height - 48, 28);
    ctx.fill();

    // soft grass patches
    for (let i = 0; i < 16; i++) {
      const hx = 80 + (hash(`t-${i}`) % (size.width - 160));
      const hy = 80 + (hash(`ty-${i}`) % (size.height - 160));
      ctx.beginPath();
      ctx.fillStyle =
        i % 3 === 0 ? "rgba(90,140,100,0.07)" : "rgba(160,190,180,0.12)";
      ctx.ellipse(hx, hy, 90 + (i % 5) * 14, 40 + (i % 4) * 8, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    this.drawLayerBands(size);
    this.drawPollutions();
    this.drawVines(time);
    // highlighted plants last so rings/labels stay readable
    const ordered = [...this.snapshot.plants].sort((a, b) => {
      const ah = this.highlightIds.has(a.id) ? 1 : 0;
      const bh = this.highlightIds.has(b.id) ? 1 : 0;
      if (ah !== bh) return ah - bh;
      const as = this.selectedId === a.id || this.hoverId === a.id ? 1 : 0;
      const bs = this.selectedId === b.id || this.hoverId === b.id ? 1 : 0;
      return as - bs;
    });
    for (const plant of ordered) {
      this.drawPlant(plant, time);
    }
    ctx.restore();

    this.drawLegend(w, h);
    this.drawTitle(w);
  }

  private drawTitle(w: number) {
    if (!this.title) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.font = "600 13px 'Source Sans 3', 'Segoe UI', 'PingFang SC', sans-serif";
    const tw = ctx.measureText(this.title).width;
    const x = w - tw - 36;
    const y = 18;
    ctx.fillStyle = "rgba(250,248,242,0.92)";
    roundRect(ctx, x - 12, y, tw + 24, 28, 10);
    ctx.fill();
    ctx.fillStyle = FloraTokens.ink;
    ctx.textAlign = "left";
    ctx.fillText(this.title, x, y + 19);
    ctx.restore();
  }

  private drawLayerBands(size: { width: number; height: number }) {
    const layers = new Map<string, number[]>();
    for (const p of this.snapshot.plants) {
      const key = p.layer ?? "default";
      const pos = this.snapshot.layout.positions[p.id];
      if (!pos) continue;
      if (!layers.has(key)) layers.set(key, []);
      layers.get(key)!.push(pos.y);
    }
    const ctx = this.ctx;
    const labels: Record<string, string> = {
      ui: "UI 层",
      application: "应用层",
      domain: "领域层",
      infra: "基础设施",
      default: "模块",
    };
    ctx.save();
    for (const [layer, ys] of layers) {
      const y = ys.reduce((a, b) => a + b, 0) / ys.length;
      ctx.fillStyle = "rgba(42,42,40,0.28)";
      ctx.font = "600 13px 'Segoe UI', 'PingFang SC', sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(labels[layer] ?? layer, 48, y - 36);
      ctx.strokeStyle = "rgba(42,42,40,0.08)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(48, y - 28);
      ctx.lineTo(size.width - 48, y - 28);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  private drawPollutions() {
    const ctx = this.ctx;
    const { positions } = this.snapshot.layout;
    for (const p of this.snapshot.pollutions) {
      const pos = positions[p.epicenter];
      if (!pos) continue;
      const grad = ctx.createRadialGradient(pos.x, pos.y, 8, pos.x, pos.y, p.radius);
      grad.addColorStop(0, `rgba(90, 40, 50, ${0.28 * p.intensity})`);
      grad.addColorStop(0.55, `rgba(70, 45, 40, ${0.12 * p.intensity})`);
      grad.addColorStop(1, "rgba(58, 42, 42, 0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawVines(time: number) {
    const ctx = this.ctx;
    const { positions } = this.snapshot.layout;
    const focus = this.focusId();

    const ordered = [...this.snapshot.vines].sort((a, b) => {
      const aHot =
        focus && (a.from === focus || a.to === focus) ? 1 : a.kind === "cycle" ? 0.5 : 0;
      const bHot =
        focus && (b.from === focus || b.to === focus) ? 1 : b.kind === "cycle" ? 0.5 : 0;
      return aHot - bHot;
    });

    for (const vine of ordered) {
      const a = positions[vine.from];
      const b = positions[vine.to];
      if (!a || !b) continue;

      const related = focus && (vine.from === focus || vine.to === focus);
      const dim = focus && !related;

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 1;
      const nx = -dy / dist;
      const ny = dx / dist;
      const wobble =
        vine.kind === "cycle"
          ? Math.sin(time / 450 + hash(vine.id)) * 22
          : 10 + (hash(vine.id) % 9);
      const c1x = a.x + dx * 0.28 + nx * wobble;
      const c1y = a.y + dy * 0.28 + ny * wobble;
      const c2x = a.x + dx * 0.72 - nx * wobble * 0.6;
      const c2y = a.y + dy * 0.72 - ny * wobble * 0.6;

      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.bezierCurveTo(c1x, c1y, c2x, c2y, b.x, b.y);
      ctx.strokeStyle = vineColor(vine.kind);
      ctx.lineWidth = (related ? 2.4 : 1.2) + vine.strength * (related ? 4.5 : 3);
      ctx.globalAlpha = dim ? 0.12 : vine.kind === "cycle" ? 0.9 : related ? 0.85 : 0.4;
      if (vine.kind === "cycle") ctx.setLineDash([7, 5]);
      else ctx.setLineDash([]);
      ctx.stroke();
      ctx.setLineDash([]);

      // arrow head
      if (!dim) {
        const tipX = b.x - (dx / dist) * 18;
        const tipY = b.y - (dy / dist) * 18;
        const ang = Math.atan2(dy, dx);
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(
          tipX - Math.cos(ang - 0.4) * 10,
          tipY - Math.sin(ang - 0.4) * 10,
        );
        ctx.lineTo(
          tipX - Math.cos(ang + 0.4) * 10,
          tipY - Math.sin(ang + 0.4) * 10,
        );
        ctx.closePath();
        ctx.fillStyle = vineColor(vine.kind);
        ctx.globalAlpha = vine.kind === "cycle" ? 0.9 : 0.55;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  private drawPlant(plant: Plant, time: number) {
    const ctx = this.ctx;
    const pos = this.snapshot.layout.positions[plant.id];
    if (!pos) return;
    const color = plantColor(plant.state);
    const species = speciesOf(plant);
    const selected = this.selectedId === plant.id;
    const hovered = this.hoverId === plant.id;
    const highlighted = this.highlightIds.has(plant.id);
    const focus = this.focusId();
    const related =
      focus &&
      this.snapshot.vines.some(
        (v) =>
          (v.from === focus && v.to === plant.id) ||
          (v.to === focus && v.from === plant.id),
      );
    const dim =
      focus && focus !== plant.id && !related && !highlighted;

    const breathe = 1 + Math.sin(time / 700 + hash(plant.id)) * 0.025;
    const r = plantRadius(plant) * breathe * (highlighted ? 1.08 : 1);
    const shapeScale = (r / 18) * breathe;

    ctx.save();
    if (dim) ctx.globalAlpha = 0.22;

    // highlight halo (PR diff / worsened)
    if (highlighted) {
      ctx.globalAlpha = 1;
      const pulse = 0.45 + Math.sin(time / 380 + hash(plant.id)) * 0.12;
      ctx.beginPath();
      ctx.fillStyle = `rgba(139, 30, 63, ${pulse * 0.22})`;
      ctx.arc(pos.x, pos.y, r + 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.strokeStyle = "rgba(139, 30, 63, 0.7)";
      ctx.lineWidth = 2.2;
      ctx.setLineDash([5, 4]);
      ctx.arc(pos.x, pos.y, r + 18, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // shadow
    ctx.beginPath();
    ctx.fillStyle = "rgba(40,30,20,0.14)";
    ctx.ellipse(pos.x, pos.y + r * 0.85, r * 0.95, r * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();

    if (plant.state === "entangled") {
      ctx.strokeStyle = "rgba(92,74,58,0.55)";
      ctx.lineWidth = 1.6;
      for (let i = 0; i < 5; i++) {
        const a = Math.PI * (0.15 + i * 0.18);
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y + 6);
        ctx.quadraticCurveTo(
          pos.x + Math.cos(a) * 20,
          pos.y + 26,
          pos.x + Math.cos(a) * 34,
          pos.y + 16 + (i % 2) * 8,
        );
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.fillStyle = "rgba(92,74,58,0.18)";
      ctx.ellipse(pos.x, pos.y + 18, 34, 12, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.save();
    ctx.translate(pos.x, pos.y);
    drawSpeciesShape(ctx, species, color, shapeScale, plant.state, time);
    ctx.restore();

    if (plant.state === "blooming" && species !== "blossom") {
      const pulse = 5 + Math.sin(time / 280) * 1.8;
      ctx.beginPath();
      ctx.fillStyle = "rgba(196,91,122,0.28)";
      ctx.arc(pos.x, pos.y - r * 0.55, pulse + 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.fillStyle = FloraTokens.blooming;
      ctx.arc(pos.x, pos.y - r * 0.55, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }

    if (selected || hovered) {
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.strokeStyle = selected ? FloraTokens.ink : "rgba(42,42,40,0.45)";
      ctx.lineWidth = selected ? 2.4 : 1.4;
      ctx.setLineDash(selected ? [] : [4, 3]);
      ctx.arc(pos.x, pos.y, r + 14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // label plate — higher contrast, larger when focused
    const maxLen = selected || highlighted ? 28 : 20;
    const label =
      plant.label.length > maxLen
        ? plant.label.slice(0, maxLen - 1) + "…"
        : plant.label;
    const fontSize = selected || highlighted ? 13 : 12;
    ctx.font = `600 ${fontSize}px 'Source Sans 3', 'Segoe UI', 'PingFang SC', sans-serif`;
    ctx.textAlign = "center";
    const tw = ctx.measureText(label).width;
    const badgeY = pos.y + r + 22;
    ctx.globalAlpha = dim ? 0.2 : 1;
    ctx.fillStyle = selected || highlighted
      ? "rgba(255,252,246,0.97)"
      : "rgba(250,248,242,0.94)";
    ctx.strokeStyle = highlighted
      ? "rgba(139, 30, 63, 0.35)"
      : "rgba(42,42,40,0.08)";
    ctx.lineWidth = 1;
    roundRect(ctx, pos.x - tw / 2 - 9, badgeY - 13, tw + 18, 22, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = FloraTokens.ink;
    ctx.fillText(label, pos.x, badgeY + 3);

    ctx.font = "10px 'Source Sans 3', 'Segoe UI', 'PingFang SC', sans-serif";
    ctx.fillStyle = "rgba(42,42,40,0.62)";
    const chip = `${SPECIES_SHORT[species]} · ${plant.metrics.fanIn}↑ ${plant.metrics.fanOut}↓`;
    ctx.fillText(chip, pos.x, badgeY + 18);

    const badge = this.badges[plant.id];
    if (badge && !dim) {
      ctx.font = "700 10px 'Source Sans 3', 'Segoe UI', 'PingFang SC', sans-serif";
      const bw = ctx.measureText(badge).width;
      const bx = pos.x + r * 0.55;
      const by = pos.y - r - 6;
      ctx.fillStyle = "rgba(139, 30, 63, 0.92)";
      roundRect(ctx, bx - 4, by - 11, bw + 10, 16, 6);
      ctx.fill();
      ctx.fillStyle = "#fffaf5";
      ctx.textAlign = "left";
      ctx.fillText(badge, bx + 1, by + 1);
      ctx.textAlign = "center";
    }

    ctx.restore();
  }

  private drawLegend(w: number, h: number) {
    const ctx = this.ctx;
    const healthItems: Array<{ color: string; label: string }> = [
      { color: FloraTokens.healthy, label: "健康" },
      { color: FloraTokens.blooming, label: "开花" },
      { color: FloraTokens.wilting, label: "枯萎" },
      { color: FloraTokens.dying, label: "濒死" },
      { color: FloraTokens.entangled, label: "缠绕" },
      { color: FloraTokens.cycle, label: "循环藤" },
    ];

    const present = new Set(this.snapshot.plants.map((p) => speciesOf(p)));
    const speciesItems = [...present];

    const boxW = Math.max(78 * healthItems.length + 16, speciesItems.length * 64 + 16);
    const x = 18;
    const y = 16;
    const boxH = speciesItems.length ? 62 : 36;

    ctx.fillStyle = "rgba(250,248,242,0.92)";
    roundRect(ctx, x, y, boxW, boxH, 12);
    ctx.fill();

    ctx.font = "11px 'Segoe UI', 'PingFang SC', sans-serif";
    ctx.textAlign = "left";
    healthItems.forEach((item, i) => {
      const ix = x + 14 + i * 78;
      ctx.beginPath();
      ctx.fillStyle = item.color;
      ctx.arc(ix, y + 16, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = FloraTokens.ink;
      ctx.fillText(item.label, ix + 10, y + 20);
    });

    speciesItems.forEach((sp, i) => {
      const ix = x + 22 + i * 64;
      drawSpeciesIcon(ctx, sp, ix, y + 44, FloraTokens.healthy);
      ctx.fillStyle = FloraTokens.muted;
      ctx.font = "10px 'Segoe UI', 'PingFang SC', sans-serif";
      ctx.fillText(SPECIES_SHORT[sp], ix + 12, y + 48);
    });
    void w;
    void h;
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function mountGarden(
  canvas: HTMLCanvasElement,
  snapshot: GardenSnapshot,
  onSelect?: (plant: Plant | null) => void,
): GardenRenderer {
  return new GardenRenderer({ canvas, snapshot, onSelect });
}
