import { describe, expect, it } from "vitest";

import { buildOutputIgnoreGlobs, resolveOutputPath } from "../src/vault-path";

type ObsidianApp = Parameters<typeof resolveOutputPath>[0];

function createApp(vaultRoot: string): ObsidianApp {
  return {
    vault: {
      adapter: {
        getBasePath: () => vaultRoot,
      },
    },
  } as unknown as ObsidianApp;
}

describe("Obsidian vault path resolution", () => {
  it("keeps output folders vault-relative", () => {
    expect(resolveOutputPath(createApp("/vault"), "Gotsaeng/Context Pack")).toEqual({
      vaultRoot: "/vault",
      outputFolder: "Gotsaeng/Context Pack",
      outputDir: "/vault/Gotsaeng/Context Pack",
    });
  });

  it("rejects invalid output folders with the shared settings contract", () => {
    const app = createApp("/vault");

    expect(() => resolveOutputPath(app, "../outside")).toThrow(
      "Output folder cannot include '..' path segments.",
    );
    expect(() => resolveOutputPath(app, "/absolute/path")).toThrow(
      "Output folder must be vault-relative; absolute paths are not supported.",
    );
    expect(() => resolveOutputPath(app, "C:/absolute/path")).toThrow(
      "Output folder must be vault-relative; absolute paths are not supported.",
    );
    expect(() => resolveOutputPath(app, "D:outside")).toThrow(
      "Output folder must be vault-relative; absolute paths are not supported.",
    );
  });

  it("builds an ignore glob that excludes the output folder, with separators preserved", () => {
    expect(buildOutputIgnoreGlobs("Gotsaeng/Context Pack")).toEqual(["Gotsaeng/Context Pack/**"]);
  });

  it("escapes glob metacharacters in custom folder names so the folder is matched literally", () => {
    // A folder like "Reports [v2]" must not be parsed as a glob character class,
    // otherwise it would fail to ignore the real folder and re-introduce issue #6.
    expect(buildOutputIgnoreGlobs("Reports [v2]")).toEqual(["Reports \\[v2\\]/**"]);
    expect(buildOutputIgnoreGlobs("Notes (draft)/out!")).toEqual(["Notes \\(draft\\)/out\\!/**"]);
  });
});
