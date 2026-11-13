import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Same-origin in development too, so auth cookies behave exactly as in production.
    proxy: { "/api": { target: process.env.MB_API_URL ?? "http://localhost:5242", changeOrigin: false, xfwd: true } },
  },
  build: { outDir: "dist", sourcemap: false, target: "es2022" },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
