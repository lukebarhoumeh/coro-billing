import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// The dashboard runs the REAL pipeline in the browser. It imports the pure pipeline
// modules from ../src (never the fs-bound CsvQuickBooksAdapter/CLI) and the synthetic
// fixtures from ../fixtures via the aliases below. server.fs.allow lets the dev server
// read those parent folders.
export default defineConfig({
  // GitHub Pages serves the site at /<repo>/; local/dev and most hosts use "/".
  base: process.env.BASE_PATH || "/",
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@pipeline": fileURLToPath(new URL("../src", import.meta.url)),
      "@fixtures": fileURLToPath(new URL("../fixtures", import.meta.url)),
      // Parent folders (../src, ../fixtures) resolve packages from the repo root.
      // Pin shared deps to this app's node_modules so `vite build` works without
      // a root install (GitHub Pages CI only installs web/).
      xlsx: fileURLToPath(new URL("./node_modules/xlsx", import.meta.url)),
      "decimal.js": fileURLToPath(new URL("./node_modules/decimal.js", import.meta.url)),
    },
  },
  server: {
    fs: { allow: [".."] },
    port: 5173,
  },
});
