import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "tsup";

const dirname = path.dirname(fileURLToPath(import.meta.url));
// gray-matter's index.js does `require('fs')` unconditionally at module load
// (only used by its unused matter.read(filePath) overload — see
// scripts/fs-stub.cjs). Aliasing it out keeps node:fs from ever being
// require()-able from this bundle, matching the fact that every real
// read/write in this plugin's own source already goes through
// FileSystemAdapter, not node:fs directly.
const fsStubPath = path.join(dirname, "scripts/fs-stub.cjs");

export default defineConfig({
  entry: ["src/main.ts"],
  outDir: "dist",
  format: ["cjs"],
  dts: false,
  sourcemap: false,
  clean: true,
  bundle: true,
  platform: "node",
  target: "es2022",
  external: ["obsidian"],
  noExternal: ["@gotsaeng/core", "micromatch", "gray-matter", "zod"],
  outExtension: () => ({ js: ".js" }),
  esbuildOptions(options) {
    options.alias = {
      ...options.alias,
      fs: fsStubPath,
      "node:fs": fsStubPath,
    };
  },
});
