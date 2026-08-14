import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { App } from "obsidian";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createObsidianFileSystemAdapter } from "../src/obsidian-file-system";
import { createFakeApp } from "./mocks/fake-app";

// Same fix and rationale as packages/cli/test/node-file-system.test.ts: a
// vault this plugin compiles from is not necessarily trusted content, so
// writing to a generated artifact's path must not follow a pre-existing
// symlink there. mocks/fake-app.ts's adapter is real-disk-backed (see its
// own comment), so this exercises the actual writeText/mkdir code path
// through real symlinks, not a mock that couldn't reproduce the bug.
describe("createObsidianFileSystemAdapter symlink safety", () => {
  let vaultRoot: string;

  beforeEach(async () => {
    vaultRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gotsaeng-obsidian-fs-symlink-"));
  });

  afterEach(async () => {
    await fs.rm(vaultRoot, { recursive: true, force: true });
  });

  it("writeText replaces a symlinked target instead of overwriting what it points to", async () => {
    const outsideFile = path.join(
      vaultRoot,
      "..",
      `outside-secret-${path.basename(vaultRoot)}.txt`,
    );
    await fs.writeFile(outsideFile, "original outside content", "utf8");

    const outputDir = path.join(vaultRoot, "Gotsaeng", "Context Pack");
    await fs.mkdir(outputDir, { recursive: true });
    const generatedPath = path.join(outputDir, "PROJECT_CONTEXT.md");
    await fs.symlink(outsideFile, generatedPath);

    const app = createFakeApp(vaultRoot) as unknown as App;
    const fsAdapter = createObsidianFileSystemAdapter(app);

    await fsAdapter.writeText(generatedPath, "# Generated Content");

    expect(await fs.readFile(outsideFile, "utf8")).toBe("original outside content");
    expect((await fs.lstat(generatedPath)).isSymbolicLink()).toBe(false);
    expect(await fs.readFile(generatedPath, "utf8")).toBe("# Generated Content");

    await fs.rm(outsideFile, { force: true });
  });

  it("writeText replaces a dangling symlink instead of writing through it", async () => {
    // A dangling symlink's target doesn't exist, so the previous
    // exists()-gated removal (which follows the link) reported false and
    // skipped removal — letting adapter.write() follow the same link and
    // create a file wherever it pointed, outside the vault. Unconditional
    // try/catch removal catches this since it acts on the link entry
    // itself without resolving it first.
    const missingTarget = path.join(vaultRoot, "..", `missing-${path.basename(vaultRoot)}.txt`);
    const generatedPath = path.join(vaultRoot, "PROJECT_CONTEXT.md");
    await fs.symlink(missingTarget, generatedPath);

    const app = createFakeApp(vaultRoot) as unknown as App;
    const fsAdapter = createObsidianFileSystemAdapter(app);

    await fsAdapter.writeText(generatedPath, "# Generated Content");

    expect((await fs.lstat(generatedPath)).isSymbolicLink()).toBe(false);
    expect(await fs.readFile(generatedPath, "utf8")).toBe("# Generated Content");
    await expect(fs.access(missingTarget)).rejects.toThrow();
  });

  it("writeText aborts instead of writing through a removal failure that isn't 'not found'", async () => {
    // A removal failure that isn't a confirmed ENOENT (e.g. the target sits
    // in a directory this process can't write to) must not be swallowed the
    // same way a missing target is: falling through to adapter.write() would
    // still follow whatever's left at the path — including a symlink the
    // failed remove() couldn't clear — and write through it.
    const generatedPath = path.join(vaultRoot, "PROJECT_CONTEXT.md");
    const fakeApp = createFakeApp(vaultRoot);
    const permissionError = Object.assign(new Error("EACCES: permission denied"), {
      code: "EACCES",
    });
    fakeApp.vault.adapter.remove.mockRejectedValueOnce(permissionError);

    const fsAdapter = createObsidianFileSystemAdapter(fakeApp as unknown as App);

    await expect(fsAdapter.writeText(generatedPath, "# Generated Content")).rejects.toThrow(
      "EACCES",
    );
    expect(fakeApp.vault.adapter.write).not.toHaveBeenCalled();
  });

  it("writeText still overwrites a normal pre-existing file in place", async () => {
    const filePath = path.join(vaultRoot, "REPORT_HUB.md");
    await fs.writeFile(filePath, "stale content", "utf8");

    const app = createFakeApp(vaultRoot) as unknown as App;
    const fsAdapter = createObsidianFileSystemAdapter(app);

    await fsAdapter.writeText(filePath, "fresh content");

    expect(await fs.readFile(filePath, "utf8")).toBe("fresh content");
  });
});
