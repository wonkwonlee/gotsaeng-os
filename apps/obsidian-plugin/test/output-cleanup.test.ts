import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  cleanupStaleManagedOutputFolders,
  getStaleManagedOutputFolders,
} from "../src/output-cleanup";

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gotsaeng-output-cleanup-"));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe("Obsidian output cleanup", () => {
  it("targets the alternate managed output folder for hidden and visible output modes", () => {
    expect(getStaleManagedOutputFolders(".gotsaeng/context-pack")).toEqual([
      "Gotsaeng/Context Pack",
    ]);
    expect(getStaleManagedOutputFolders("Gotsaeng/Context Pack")).toEqual([
      ".gotsaeng/context-pack",
    ]);
    expect(getStaleManagedOutputFolders("Reports/GotSaeng")).toEqual([
      ".gotsaeng/context-pack",
      "Gotsaeng/Context Pack",
    ]);
  });

  it("removes only managed generated files from stale output folders", async () => {
    const staleOutputDir = path.join(tempRoot, ".gotsaeng/context-pack");
    const currentOutputDir = path.join(tempRoot, "Gotsaeng/Context Pack");
    await fs.mkdir(staleOutputDir, { recursive: true });
    await fs.mkdir(currentOutputDir, { recursive: true });
    await fs.writeFile(path.join(staleOutputDir, "PROJECT_CONTEXT.md"), "stale", "utf8");
    await fs.writeFile(path.join(staleOutputDir, "REPORT_HUB.md"), "stale", "utf8");
    await fs.writeFile(path.join(staleOutputDir, "USER_NOTE.md"), "keep", "utf8");
    await fs.writeFile(path.join(currentOutputDir, "PROJECT_CONTEXT.md"), "current", "utf8");

    const results = await cleanupStaleManagedOutputFolders(tempRoot, "Gotsaeng/Context Pack");

    expect(results).toEqual([
      {
        outputFolder: ".gotsaeng/context-pack",
        removedFiles: ["REPORT_HUB.md", "PROJECT_CONTEXT.md"],
        removedDirectories: [],
      },
    ]);
    await expect(fs.readFile(path.join(staleOutputDir, "USER_NOTE.md"), "utf8")).resolves.toBe(
      "keep",
    );
    await expect(
      fs.readFile(path.join(currentOutputDir, "PROJECT_CONTEXT.md"), "utf8"),
    ).resolves.toBe("current");
  });

  it("removes empty managed output directories after generated files are removed", async () => {
    const staleOutputDir = path.join(tempRoot, "Gotsaeng/Context Pack");
    await fs.mkdir(staleOutputDir, { recursive: true });
    await fs.writeFile(path.join(staleOutputDir, "PROJECT_CONTEXT.md"), "stale", "utf8");

    const results = await cleanupStaleManagedOutputFolders(tempRoot, ".gotsaeng/context-pack");

    expect(results).toEqual([
      {
        outputFolder: "Gotsaeng/Context Pack",
        removedFiles: ["PROJECT_CONTEXT.md"],
        removedDirectories: ["Gotsaeng/Context Pack", "Gotsaeng"],
      },
    ]);
    await expect(fs.stat(path.join(tempRoot, "Gotsaeng"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
