import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "coverage/**",
      "node_modules/**",
      "packages/*/dist/**",
      "apps/*/dist/**",
      "examples/sample-output/**",
      ".gotsaeng/**",
      ".omx/**",
      ".omc/**",
      ".vault-copy/**",
      "prettier.config.cjs",
      "apps/obsidian-plugin/scripts/fs-stub.cjs",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Type-aware linting for TypeScript only. `projectService` resolves each
    // file through the tsconfig that owns it, so the rules below see the same
    // types `pnpm typecheck` does — including the root tsconfig.json, which
    // exists solely to claim `vitest.config.ts`.
    files: ["**/*.ts"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // The type-checked rules need a TypeScript program; plain .js/.mjs config
    // and script files have none, so keep them on the syntactic rules only.
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    files: ["**/test/**/*.ts"],
    rules: {
      // Vitest spies are asserted on unbound by design (`expect(mock.fn)`),
      // and `vi.fn()` has no `this` to lose.
      "@typescript-eslint/unbound-method": "off",
      // Test callbacks are written `async` uniformly, and fake adapters must
      // stay `async` to match the Promise-returning contracts they stand in
      // for, whether or not a given body happens to await anything.
      "@typescript-eslint/require-await": "off",
    },
  },
);
