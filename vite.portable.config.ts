import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  publicDir: false,
  base: "./",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    lib: {
      entry: fileURLToPath(new URL("./portable/main.tsx", import.meta.url)),
      name: "SliceLab",
      formats: ["iife"],
      fileName: () => "app.js",
      cssFileName: "app",
    },
  },
});
