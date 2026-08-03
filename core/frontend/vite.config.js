import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Dev-only convenience so `npm run dev` can hit the real running
    // backend/automation containers without nginx in front — mirrors
    // nginx.conf's proxy_pass routes. Ignored by `vite build`.
    proxy: {
      "/api/automation": { target: "http://127.0.0.1:8003", changeOrigin: true, rewrite: (p) => p.replace(/^\/api\/automation/, "") },
      "/api": { target: "http://127.0.0.1:8000", changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, "") },
    },
  },
});