import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: process.env.GITHUB_PAGES === "1" ? "/solax-seller/" : "/",
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/publish": "http://127.0.0.1:8787",
      "/health": "http://127.0.0.1:8787",
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        sell: "sell.html",
      },
    },
  },
});
