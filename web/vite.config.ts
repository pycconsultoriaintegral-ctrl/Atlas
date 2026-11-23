import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// En desarrollo, la interfaz (puerto 5173) reenvía /api y /ws al cerebro central (8787).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:8787", changeOrigin: false },
      "/ws": { target: "ws://127.0.0.1:8787", ws: true },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});
