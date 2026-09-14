import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// The dashboard runs the REAL pipeline in the browser. It imports the pure pipeline
// modules from ../src (never the fs-bound CsvQuickBooksAdapter/CLI) and the synthetic
// fixtures from ../fixtures via the aliases below. server.fs.allow lets the dev server
// read those parent folders.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@pipeline": fileURLToPath(new URL("../src", import.meta.url)),
      "@fixtures": fileURLToPath(new URL("../fixtures", import.meta.url)),
    },
  },
  server: {
    fs: { allow: [".."] },
    port: 5173,
  },
});
