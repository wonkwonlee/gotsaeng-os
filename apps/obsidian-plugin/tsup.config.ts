import { defineConfig } from "tsup";

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
  noExternal: ["@gotsaeng/core", "fast-glob", "gray-matter", "zod"],
  outExtension: () => ({ js: ".js" })
});
