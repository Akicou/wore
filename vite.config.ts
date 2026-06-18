import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// https://vite.dev/config/
// When running inside Tauri, Vite is told the dev server host/port via env.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Tauri uses fixed port 1420; allow HMR over the lan if required.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  // Produce sourcemaps for production (useful for shipped app debugging).
  build: {
    target: "es2022",
    sourcemap: !!process.env.WORE_SOURCEMAPS,
    chunkSizeWarningLimit: 4096,
  },
}));
