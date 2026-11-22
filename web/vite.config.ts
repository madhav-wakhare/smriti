import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// In `make dev` the API runs in its own container; SMRITI_API_URL points the dev proxy at it.
const api = process.env.SMRITI_API_URL ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: true, port: 5173, strictPort: true, proxy: { "/api": api } },
  build: {
    outDir: "dist",
    rollupOptions: {
      output: { manualChunks: { react: ["react", "react-dom", "react-router-dom"], query: ["@tanstack/react-query"], dnd: ["@dnd-kit/core"] } },
    },
  },
});
