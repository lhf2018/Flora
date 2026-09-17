/** Single color semantic — do not reuse for other meanings */
export const FloraTokens = {
  healthy: "#2F6B3A",
  blooming: "#C45B7A",
  wilting: "#A67C52",
  dying: "#C8C8C8",
  entangled: "#5C4A3A",
  illegal: "#8B1E3F",
  cycle: "#5B2C6F",
  pollution: "#3A2A2A",
  vineNormal: "#6B7F6E",
  ground: "#E8E2D6",
  groundAlt: "#D9D0C0",
  water: "#A8C5C0",
  ink: "#2A2A28",
  panel: "rgba(250, 248, 242, 0.94)",
  muted: "#6E6A62",
} as const;

export type TokenKey = keyof typeof FloraTokens;
