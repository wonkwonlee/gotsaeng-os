import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createNodeFileSystemAdapter } from "../src/node-file-system";

// Security regression coverage: a vault (or any directory this CLI is
// pointed at as an output root) is not necessarily trusted content. Before
// this fix, writeText/mkdir followed a symlink planted at a generated
// artifact's path and clobbered whatever it pointed to, rather than
// replacing the symlink itself — see the "delete-then-create" comments in
// ../src/node-file-system.ts for the mechanism.
describe("createNodeFileSystemAdapter symlink safety", () => {
  let tempRoot: string;
  let fsAdapter: ReturnType<typeof createNodeFileSystemAdapter>;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gotsaeng-nodefs-symlink-"));
    fsAdapter = createNodeFileSystemAdapter();
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("writeText replaces a symlinked target instead of overwriting what it points to", async () => {
    const outsideFile = path.join(tempRoot, "outside-secret.txt");
    await fs.writeFile(outsideFile, "original outside content", "utf8");

    const outputDir = path.join(tempRoot, "output");
    await fs.mkdir(outputDir, { recursive: true });
    const generatedPath = path.join(outputDir, "PROJECT_CONTEXT.md");
    await fs.symlink(outsideFile, generatedPath);

    await fsAdapter.writeText(generatedPath, "# Generated Content");

    // The outside file is untouched — the symlink was replaced, not followed.
    expect(await fs.readFile(outsideFile, "utf8")).toBe("original outside content");
    // The generated path is now a plain file with the new content.
    const lstat = await fs.lstat(generatedPath);
    expect(lstat.isSymbolicLink()).toBe(false);
    expect(await fs.readFile(generatedPath, "utf8")).toBe("# Generated Content");
  });

  it("writeText still overwrites a normal pre-existing file in place", async () => {
    const filePath = path.join(tempRoot, "REPORT_HUB.md");
    await fs.writeFile(filePath, "stale content", "utf8");

    await fsAdapter.writeText(filePath, "fresh content");

    expect(await fs.readFile(filePath, "utf8")).toBe("fresh content");
  });

  it("writeText replaces a dangling symlink instead of writing through it", async () => {
    // A dangling symlink's target doesn't exist, so an exists()-style check
    // (which follows the link) reports false and would skip removal —
    // letting the write below follow the same link and create a file
    // wherever it points, outside tempRoot. lstat catches this since it
    // reports the link itself without resolving it.
    const missingTarget = path.join(tempRoot, "does-not-exist.txt");
    const generatedPath = path.join(tempRoot, "PROJECT_CONTEXT.md");
    await fs.symlink(missingTarget, generatedPath);

    await fsAdapter.writeText(generatedPath, "# Generated Content");

    const lstat = await fs.lstat(generatedPath);
    expect(lstat.isSymbolicLink()).toBe(false);
    expect(await fs.readFile(generatedPath, "utf8")).toBe("# Generated Content");
    await expect(fs.access(missingTarget)).rejects.toThrow();
  });

  it("writeText preserves permissions when overwriting a normal pre-existing file", async () => {
    const filePath = path.join(tempRoot, "REPORT_HUB.md");
    await fs.writeFile(filePath, "stale content", "utf8");
    await fs.chmod(filePath, 0o600);

    await fsAdapter.writeText(filePath, "fresh content");

    const stat = await fs.stat(filePath);
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("mkdir replaces a symlinked output directory instead of writing through it", async () => {
    const outsideDir = path.join(tempRoot, "outside-dir");
    await fs.mkdir(outsideDir, { recursive: true });
    await fs.writeFile(path.join(outsideDir, "untouched.txt"), "should survive", "utf8");

    const outputDir = path.join(tempRoot, "output");
    await fs.symlink(outsideDir, outputDir);

    await fsAdapter.mkdir(outputDir);

    // outsideDir is untouched — the symlink was removed, not followed.
    expect(await fs.readFile(path.join(outsideDir, "untouched.txt"), "utf8")).toBe(
      "should survive",
    );
    // outputDir is now a real, empty directory.
    const lstat = await fs.lstat(outputDir);
    expect(lstat.isSymbolicLink()).toBe(false);
    expect(lstat.isDirectory()).toBe(true);
    expect(await fs.readdir(outputDir)).toEqual([]);
  });

  it("mkdir stays a no-op that preserves contents for an already-real directory", async () => {
    const outputDir = path.join(tempRoot, "output");
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(path.join(outputDir, "PROJECT_CONTEXT.md"), "from a previous run", "utf8");

    await fsAdapter.mkdir(outputDir);

    expect(await fs.readFile(path.join(outputDir, "PROJECT_CONTEXT.md"), "utf8")).toBe(
      "from a previous run",
    );
  });
});
