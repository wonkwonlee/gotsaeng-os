import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

// Tests are run from the workspace root (`pnpm test`) rather than per package, so
// the include globs are declared here instead of relying on vitest's defaults.
// Coverage is measured but not gated: thresholds land once the untested adapter
// shell (apps/obsidian-plugin/src/main.ts, view.ts) has coverage of its own.
export default defineConfig({
  resolve: {
    alias: {
      // The "obsidian" npm package ships types only (package.json "main": "");
      // a real plugin never bundles it, so nothing exists for `import ... from
      // "obsidian"` to resolve to at runtime under Node/vitest. Redirect it to
      // a hand-rolled runtime mock so apps/obsidian-plugin/src can be tested.
      // `tsc` is unaffected by this alias and keeps type-checking against the
      // real obsidian.d.ts declarations.
      obsidian: path.resolve(rootDir, "apps/obsidian-plugin/test/mocks/obsidian.ts"),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
    environment: "node",
    // The Obsidian adapter is the only package that renders DOM. Its runtime
    // mock (apps/obsidian-plugin/test/mocks/obsidian.ts) builds real elements
    // so `document.activeElement` is a real thing — which is what makes
    // src/a11y.ts's FocusRestorer testable at all. Under `environment: "node"`
    // there is no `document`, so `activeFocusKey()`/`isFocused()` short-circuit
    // and every focus assertion is vacuously true. packages/* stay on "node":
    // they are pure logic and do not need (or want) the jsdom startup cost.
    environmentMatchGlobs: [["apps/obsidian-plugin/test/**", "jsdom"]],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["packages/*/src/**/*.ts", "apps/*/src/**/*.ts"],
      exclude: ["**/dist/**", "**/*.d.ts"],
    },
  },
});
