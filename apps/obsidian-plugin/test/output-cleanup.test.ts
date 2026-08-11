import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  cleanupStaleManagedOutputFolders,
  countStaleManagedOutputFiles,
  getStaleManagedOutputFolders,
} from "../src/output-cleanup";

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gotsaeng-output-cleanup-"));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

// A minimal, schema-valid COMPILE_REPORT.json — the ownership marker that proves a
// directory was actually written by a GotSaeng compile, not just a folder that
// happens to contain files with the same names.
const MANAGED_OUTPUT_MARKER = JSON.stringify({
  filesScanned: 0,
  markdownFilesParsed: 0,
  filesSkipped: 0,
  parseErrors: [],
  warnings: [],
  generatedFiles: [],
});

async function writeManagedOutputMarker(outputDir: string): Promise<void> {
  await fs.writeFile(path.join(outputDir, "COMPILE_REPORT.json"), MANAGED_OUTPUT_MARKER, "utf8");
}

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

  it("also targets a vacated custom folder, which is not one of the built-in managed folders", () => {
    // Leaving a custom folder for a built-in one: without the explicit
    // previous-folder argument the custom path is invisible to cleanup and its
    // generated files would be orphaned permanently.
    expect(getStaleManagedOutputFolders(".gotsaeng/context-pack", "Reports/GotSaeng")).toEqual([
      "Gotsaeng/Context Pack",
      "Reports/GotSaeng",
    ]);
  });

  it("never targets the current folder, even when it is passed as the previous one", () => {
    expect(getStaleManagedOutputFolders("Reports/GotSaeng", "Reports/GotSaeng")).toEqual([
      ".gotsaeng/context-pack",
      "Gotsaeng/Context Pack",
    ]);
    // A built-in previous folder must not be duplicated in the candidate list.
    expect(getStaleManagedOutputFolders("Gotsaeng/Context Pack", ".gotsaeng/context-pack")).toEqual(
      [".gotsaeng/context-pack"],
    );
  });

  it("counts generated files in a vacated custom folder without deleting anything", async () => {
    const customOutputDir = path.join(tempRoot, "Reports/GotSaeng");
    await fs.mkdir(customOutputDir, { recursive: true });
    await writeManagedOutputMarker(customOutputDir);
    await fs.writeFile(path.join(customOutputDir, "PROJECT_CONTEXT.md"), "stale", "utf8");
    await fs.writeFile(path.join(customOutputDir, "REPORT_HUB.md"), "stale", "utf8");
    await fs.writeFile(path.join(customOutputDir, "USER_NOTE.md"), "keep", "utf8");

    const count = await countStaleManagedOutputFiles(
      tempRoot,
      ".gotsaeng/context-pack",
      "Reports/GotSaeng",
    );

    expect(count).toBe(3);
    // Dry run only — every file must still be on disk.
    await expect(fs.readdir(customOutputDir)).resolves.toHaveLength(4);
  });

  it("removes generated files from a vacated custom folder and leaves user files", async () => {
    const customOutputDir = path.join(tempRoot, "Reports/GotSaeng");
    await fs.mkdir(customOutputDir, { recursive: true });
    await writeManagedOutputMarker(customOutputDir);
    await fs.writeFile(path.join(customOutputDir, "PROJECT_CONTEXT.md"), "stale", "utf8");
    await fs.writeFile(path.join(customOutputDir, "USER_NOTE.md"), "keep", "utf8");

    const results = await cleanupStaleManagedOutputFolders(
      tempRoot,
      ".gotsaeng/context-pack",
      "Reports/GotSaeng",
    );

    expect(results).toEqual([
      {
        outputFolder: "Reports/GotSaeng",
        removedFiles: ["PROJECT_CONTEXT.md", "COMPILE_REPORT.json"],
        removedDirectories: [],
      },
    ]);
    await expect(fs.readFile(path.join(customOutputDir, "USER_NOTE.md"), "utf8")).resolves.toBe(
      "keep",
    );
  });

  it("never sweeps a custom folder that has no GotSaeng ownership marker", async () => {
    // Regression test: a custom output folder can be "." (the vault root) or any
    // other path that already holds the user's own notes. Files merely sharing a
    // managed artifact's name (e.g. a user-authored DECISION_LOG.md) must not be
    // treated as GotSaeng-generated without a real ownership marker.
    const customOutputDir = path.join(tempRoot, "Notes");
    await fs.mkdir(customOutputDir, { recursive: true });
    await fs.writeFile(path.join(customOutputDir, "DECISION_LOG.md"), "my own notes", "utf8");

    const count = await countStaleManagedOutputFiles(tempRoot, ".gotsaeng/context-pack", "Notes");
    expect(count).toBe(0);

    const results = await cleanupStaleManagedOutputFolders(
      tempRoot,
      ".gotsaeng/context-pack",
      "Notes",
    );
    expect(results).toEqual([]);
    await expect(fs.readFile(path.join(customOutputDir, "DECISION_LOG.md"), "utf8")).resolves.toBe(
      "my own notes",
    );
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

  it("counts and removes ARTIFACT_INDEX.json, so a vacated folder doesn't stay non-empty", async () => {
    // Regression test: ARTIFACT_INDEX.json (packages/core writeContextPack) must be
    // registered in OUTPUT_ARTIFACTS, or it is invisible to both the confirmation
    // count and the removal sweep, leaving the folder non-empty and unremovable.
    const staleOutputDir = path.join(tempRoot, "Gotsaeng/Context Pack");
    await fs.mkdir(staleOutputDir, { recursive: true });
    await fs.writeFile(path.join(staleOutputDir, "PROJECT_CONTEXT.md"), "stale", "utf8");
    await fs.writeFile(path.join(staleOutputDir, "ARTIFACT_INDEX.json"), "{}", "utf8");

    const count = await countStaleManagedOutputFiles(tempRoot, ".gotsaeng/context-pack");
    expect(count).toBe(2);

    const results = await cleanupStaleManagedOutputFolders(tempRoot, ".gotsaeng/context-pack");

    expect(results).toEqual([
      {
        outputFolder: "Gotsaeng/Context Pack",
        removedFiles: ["PROJECT_CONTEXT.md", "ARTIFACT_INDEX.json"],
        removedDirectories: ["Gotsaeng/Context Pack", "Gotsaeng"],
      },
    ]);
    await expect(fs.stat(path.join(tempRoot, "Gotsaeng"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
