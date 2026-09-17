import type { Plant, PlantSpecies, PlantState } from "@flora/core";
import { FloraTokens } from "./tokens.js";

function shade(hex: string, amount: number): string {
  const n = hex.replace("#", "");
  const full =
    n.length === 3
      ? n
          .split("")
          .map((c) => c + c)
          .join("")
      : n;
  const num = parseInt(full, 16);
  const r = Math.min(255, Math.max(0, ((num >> 16) & 255) + amount));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 255) + amount));
  const b = Math.min(255, Math.max(0, (num & 255) + amount));
  return `rgb(${r},${g},${b})`;
}

function fillCanopy(
  ctx: CanvasRenderingContext2D,
  color: string,
  draw: () => void,
) {
  const g = ctx.createRadialGradient(0, -6, 2, 0, 0, 28);
  g.addColorStop(0, shade(color, 36));
  g.addColorStop(1, color);
  ctx.fillStyle = g;
  draw();
  ctx.fill();
}

export function plantColor(state: PlantState): string {
  switch (state) {
    case "healthy":
      return FloraTokens.healthy;
    case "blooming":
      return FloraTokens.blooming;
    case "wilting":
      return FloraTokens.wilting;
    case "dying":
      return FloraTokens.dying;
    case "entangled":
      return FloraTokens.entangled;
  }
}

/** Draw species silhouette centered at origin; color = health. */
export function drawSpeciesShape(
  ctx: CanvasRenderingContext2D,
  species: PlantSpecies,
  color: string,
  scale: number,
  state: PlantState,
  time: number,
) {
  ctx.save();
  ctx.scale(scale, scale);

  const wilt = state === "wilting" || state === "dying";
  const lean = wilt ? 0.12 : 0;
  ctx.rotate(lean);

  const trunk = (h: number, w = 2.4) => {
    ctx.strokeStyle = state === "dying" ? "#A8A8A8" : "#5A4634";
    ctx.lineWidth = w;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, 8);
    ctx.lineTo(wilt ? 3 : 0, -h);
    ctx.stroke();
  };

  switch (species) {
    case "pine": {
      // layered triangles — TypeScript
      trunk(10, 2.2);
      for (let i = 0; i < 3; i++) {
        const y = -6 - i * 10;
        const w = 16 - i * 3;
        fillCanopy(ctx, color, () => {
          ctx.beginPath();
          ctx.moveTo(0, y - 14);
          ctx.lineTo(-w, y + 6);
          ctx.lineTo(w, y + 6);
          ctx.closePath();
        });
      }
      break;
    }
    case "oak": {
      // round canopy — JavaScript
      trunk(4);
      fillCanopy(ctx, color, () => {
        ctx.beginPath();
        ctx.arc(-8, -2, 11, 0, Math.PI * 2);
        ctx.arc(8, -1, 11, 0, Math.PI * 2);
        ctx.arc(0, -12, 14, 0, Math.PI * 2);
      });
      break;
    }
    case "willow": {
      // drooping strands — Python
      trunk(16, 2);
      fillCanopy(ctx, color, () => {
        ctx.beginPath();
        ctx.ellipse(0, -14, 12, 8, 0, 0, Math.PI * 2);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.4;
      for (let i = -3; i <= 3; i++) {
        ctx.beginPath();
        ctx.moveTo(i * 3, -10);
        ctx.quadraticCurveTo(i * 4, 4, i * 5 + Math.sin(time / 400 + i) * 2, 16);
        ctx.stroke();
      }
      break;
    }
    case "bamboo": {
      // vertical stalks — Go
      for (let i = -1; i <= 1; i++) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(i * 8, 10);
        ctx.lineTo(i * 8, -22);
        ctx.stroke();
        ctx.strokeStyle = shade(color, -30);
        ctx.lineWidth = 1;
        for (let n = 0; n < 4; n++) {
          const y = 6 - n * 8;
          ctx.beginPath();
          ctx.moveTo(i * 8 - 3, y);
          ctx.lineTo(i * 8 + 3, y);
          ctx.stroke();
        }
        // leaf
        fillCanopy(ctx, color, () => {
          ctx.beginPath();
          ctx.ellipse(i * 8 + 6, -18, 7, 3, -0.6, 0, Math.PI * 2);
        });
      }
      break;
    }
    case "fir": {
      // tall thin conifer — Rust
      trunk(8, 2);
      for (let i = 0; i < 4; i++) {
        const y = -4 - i * 8;
        const w = 12 - i * 2;
        fillCanopy(ctx, color, () => {
          ctx.beginPath();
          ctx.moveTo(0, y - 10);
          ctx.lineTo(-w, y + 5);
          ctx.lineTo(w, y + 5);
          ctx.closePath();
        });
      }
      break;
    }
    case "maple": {
      // lobed canopy — JVM
      trunk(2);
      fillCanopy(ctx, color, () => {
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
          const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
          const x = Math.cos(a) * 14;
          const y = Math.sin(a) * 14 - 6;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
          ctx.lineTo(Math.cos(a + 0.3) * 7, Math.sin(a + 0.3) * 7 - 6);
        }
        ctx.closePath();
      });
      break;
    }
    case "blossom": {
      // flowering bush — UI
      trunk(0, 1.5);
      fillCanopy(ctx, color, () => {
        ctx.beginPath();
        ctx.arc(-7, 0, 9, 0, Math.PI * 2);
        ctx.arc(7, 1, 9, 0, Math.PI * 2);
        ctx.arc(0, -8, 10, 0, Math.PI * 2);
      });
      // petals (accent, not health color — only when blooming OR always soft pink accents for species id)
      const petal = state === "blooming" ? FloraTokens.blooming : shade(color, 40);
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI * 2 * i) / 6 + time / 900;
        ctx.beginPath();
        ctx.fillStyle = petal;
        ctx.globalAlpha = state === "dying" ? 0.25 : 0.85;
        ctx.arc(Math.cos(a) * 8, -6 + Math.sin(a) * 8, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      break;
    }
    case "fern": {
      // fronds — docs
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(0, 8);
        ctx.quadraticCurveTo(i * 10, -4, i * 14, -18);
        ctx.stroke();
        for (let j = 0; j < 3; j++) {
          const t = 0.3 + j * 0.2;
          const x = i * 14 * t;
          const y = 8 + (-26) * t;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + (i >= 0 ? 5 : -5), y - 3);
          ctx.stroke();
        }
      }
      break;
    }
    case "cactus": {
      // arms — scripts/config
      fillCanopy(ctx, color, () => {
        ctx.beginPath();
        // body
        ctx.moveTo(-6, 12);
        ctx.lineTo(-6, -14);
        ctx.arc(0, -14, 6, Math.PI, 0);
        ctx.lineTo(6, 12);
        ctx.closePath();
      });
      // left arm
      ctx.fillStyle = color;
      ctx.fillRect(-16, -4, 10, 5);
      ctx.fillRect(-16, -12, 5, 13);
      // right arm
      ctx.fillRect(6, 0, 12, 5);
      ctx.fillRect(13, -8, 5, 13);
      break;
    }
    case "shrub":
    default: {
      trunk(2, 2);
      fillCanopy(ctx, color, () => {
        ctx.beginPath();
        ctx.ellipse(0, -4, 16, 12, 0, 0, Math.PI * 2);
        ctx.ellipse(-10, 2, 9, 8, 0, 0, Math.PI * 2);
        ctx.ellipse(10, 2, 9, 8, 0, 0, Math.PI * 2);
      });
      break;
    }
  }

  ctx.restore();
}

export function drawSpeciesIcon(
  ctx: CanvasRenderingContext2D,
  species: PlantSpecies,
  x: number,
  y: number,
  color: string,
) {
  ctx.save();
  ctx.translate(x, y);
  drawSpeciesShape(ctx, species, color, 0.35, "healthy", 0);
  ctx.restore();
}

export function speciesOf(plant: Plant): PlantSpecies {
  return plant.species ?? "shrub";
}
