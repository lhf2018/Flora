import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  root: ".",
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:4173",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@flora/render": path.resolve(__dirname, "../../packages/render/src/index.ts"),
      "@flora/core": path.resolve(__dirname, "../../packages/core/src/types.ts"),
    },
  },
});
