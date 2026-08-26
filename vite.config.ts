import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: process.env.GITHUB_PAGES === "1" ? "/solax-seller/" : "/",
  server: {
    port: 5173,
    host: true,
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
