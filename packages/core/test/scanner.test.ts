import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { scanMarkdownFiles, scanSourceFiles } from "../src/index";

describe("scanner", () => {
  it("ignores Obsidian internals and generated GotSaeng output", async () => {
    const vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), "gotsaeng-scanner-"));
    await fs.mkdir(path.join(vaultDir, ".obsidian/plugins/gotsaeng-os"), { recursive: true });
    await fs.mkdir(path.join(vaultDir, ".gotsaeng/context-pack"), { recursive: true });
    await fs.mkdir(path.join(vaultDir, "notes"), { recursive: true });

    await fs.writeFile(path.join(vaultDir, "notes/project.md"), "# Project", "utf8");
    await fs.writeFile(path.join(vaultDir, ".obsidian/plugins/gotsaeng-os/README.md"), "# Plugin", "utf8");
    await fs.writeFile(path.join(vaultDir, ".gotsaeng/context-pack/PROJECT_CONTEXT.md"), "# Context", "utf8");

    const files = await scanMarkdownFiles(vaultDir);

    expect(files.map((file) => path.relative(vaultDir, file))).toEqual(["notes/project.md"]);
  });

  it("excludes files matching ignoreGlobs", async () => {
    const vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), "gotsaeng-scanner-ignore-"));
    await fs.mkdir(path.join(vaultDir, "notes"), { recursive: true });
    await fs.mkdir(path.join(vaultDir, "Out"), { recursive: true });

    await fs.writeFile(path.join(vaultDir, "notes/project.md"), "# Project", "utf8");
    await fs.writeFile(path.join(vaultDir, "Out/PROJECT_CONTEXT.md"), "# Generated", "utf8");

    const all = await scanSourceFiles(vaultDir);
    expect(all.map((file) => path.relative(vaultDir, file)).sort()).toEqual([
      "Out/PROJECT_CONTEXT.md",
      "notes/project.md"
    ]);

    const filtered = await scanSourceFiles(vaultDir, { ignoreGlobs: ["Out/**"] });
    expect(filtered.map((file) => path.relative(vaultDir, file))).toEqual(["notes/project.md"]);
  });

  it("requires glob metacharacters in a literal folder name to be escaped to be ignored", async () => {
    const vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), "gotsaeng-scanner-meta-"));
    await fs.mkdir(path.join(vaultDir, "notes"), { recursive: true });
    await fs.mkdir(path.join(vaultDir, "Out{a,b}"), { recursive: true });

    await fs.writeFile(path.join(vaultDir, "notes/project.md"), "# Project", "utf8");
    await fs.writeFile(path.join(vaultDir, "Out{a,b}/PROJECT_CONTEXT.md"), "# Generated", "utf8");

    // Naive (unescaped) pattern: picomatch brace-expands "{a,b}", so it does NOT match
    // the literal folder — the generated file leaks back in (issue #6 regression).
    const naive = await scanSourceFiles(vaultDir, { ignoreGlobs: ["Out{a,b}/**"] });
    expect(naive.map((file) => path.relative(vaultDir, file)).sort()).toEqual([
      "Out{a,b}/PROJECT_CONTEXT.md",
      "notes/project.md"
    ]);

    // Escaped pattern (what buildOutputIgnoreGlobs produces) matches it literally.
    const escaped = await scanSourceFiles(vaultDir, { ignoreGlobs: ["Out\\{a,b\\}/**"] });
    expect(escaped.map((file) => path.relative(vaultDir, file))).toEqual(["notes/project.md"]);
  });
});
