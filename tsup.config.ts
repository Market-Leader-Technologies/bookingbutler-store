import { copyFileSync, mkdirSync } from "node:fs";
import { defineConfig } from "tsup";

const shared = {
  format: ["esm", "cjs"] as ("esm" | "cjs")[],
  dts: true,
  sourcemap: true,
  target: "es2022",
  treeshake: false,
  splitting: false,
};

export default defineConfig([
  {
    // The framework-free core: no React, no "use client", no side effects.
    ...shared,
    entry: { index: "src/index.ts" },
    clean: true,
    platform: "neutral",
  },
  {
    // The React kit imports the core by its package name, so a page holding
    // both entry points shares one copy of it (one StoreApiError class, one
    // cart rule set) rather than a bundled duplicate.
    ...shared,
    entry: { "react/index": "src/react/index.ts" },
    platform: "browser",
    external: [
      "@bookingbutler/store",
      "react",
      "react-dom",
      "react/jsx-runtime",
    ],
    banner: { js: '"use client";' },
    esbuildOptions(options) {
      options.jsx = "automatic";
    },
    onSuccess: async () => {
      mkdirSync("dist", { recursive: true });
      copyFileSync("src/styles.css", "dist/styles.css");
    },
  },
]);
