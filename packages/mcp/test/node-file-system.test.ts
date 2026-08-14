import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createNodeFileSystemAdapter } from "../src/node-file-system";

// Same fix as packages/cli/test/node-file-system.test.ts, duplicated because
// the implementation is: writeText/mkdir must not follow a symlink planted
// at a generated artifact's path. See that file's comments for the full
// rationale.
describe("createNodeFileSystemAdapter symlink safety", () => {
  let tempRoot: string;
  let fsAdapter: ReturnType<typeof createNodeFileSystemAdapter>;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gotsaeng-mcp-nodefs-symlink-"));
    fsAdapter = createNodeFileSystemAdapter();
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("writeText replaces a symlinked target instead of overwriting what it points to", async () => {
    const outsideFile = path.join(tempRoot, "outside-secret.txt");
    await fs.writeFile(outsideFile, "original outside content", "utf8");

    const generatedPath = path.join(tempRoot, "LLM_HANDOFF.md");
    await fs.symlink(outsideFile, generatedPath);

    await fsAdapter.writeText(generatedPath, "# Handoff");

    expect(await fs.readFile(outsideFile, "utf8")).toBe("original outside content");
    expect((await fs.lstat(generatedPath)).isSymbolicLink()).toBe(false);
    expect(await fs.readFile(generatedPath, "utf8")).toBe("# Handoff");
  });

  it("writeText replaces a dangling symlink instead of writing through it", async () => {
    // A dangling symlink's target doesn't exist, so an exists()-style check
    // (which follows the link) reports false and would skip removal —
    // letting the write below follow the same link and create a file
    // wherever it points, outside tempRoot. lstat catches this since it
    // reports the link itself without resolving it.
    const missingTarget = path.join(tempRoot, "does-not-exist.txt");
    const generatedPath = path.join(tempRoot, "LLM_HANDOFF.md");
    await fs.symlink(missingTarget, generatedPath);

    await fsAdapter.writeText(generatedPath, "# Handoff");

    const lstat = await fs.lstat(generatedPath);
    expect(lstat.isSymbolicLink()).toBe(false);
    expect(await fs.readFile(generatedPath, "utf8")).toBe("# Handoff");
    await expect(fs.access(missingTarget)).rejects.toThrow();
  });

  it("writeText preserves permissions when overwriting a normal pre-existing file", async () => {
    const filePath = path.join(tempRoot, "LLM_HANDOFF.md");
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

    expect(await fs.readFile(path.join(outsideDir, "untouched.txt"), "utf8")).toBe(
      "should survive",
    );
    expect((await fs.lstat(outputDir)).isSymbolicLink()).toBe(false);
  });
});
