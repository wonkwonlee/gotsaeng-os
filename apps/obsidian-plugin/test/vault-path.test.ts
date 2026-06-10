import { describe, expect, it } from "vitest";

import { resolveOutputPath } from "../src/vault-path";

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
});
