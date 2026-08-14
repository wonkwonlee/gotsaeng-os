import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { scanMarkdownFiles, scanSourceFiles } from "../src/index";
import { createNodeFileSystemAdapter } from "./helpers/node-file-system";

const fsAdapter = createNodeFileSystemAdapter();

describe("scanner", () => {
  it("ignores Obsidian internals and generated GotSaeng output", async () => {
    const vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), "gotsaeng-scanner-"));
    await fs.mkdir(path.join(vaultDir, ".obsidian/plugins/gotsaeng-os"), { recursive: true });
    await fs.mkdir(path.join(vaultDir, ".gotsaeng/context-pack"), { recursive: true });
    await fs.mkdir(path.join(vaultDir, "notes"), { recursive: true });

    await fs.writeFile(path.join(vaultDir, "notes/project.md"), "# Project", "utf8");
    await fs.writeFile(
      path.join(vaultDir, ".obsidian/plugins/gotsaeng-os/README.md"),
      "# Plugin",
      "utf8",
    );
    await fs.writeFile(
      path.join(vaultDir, ".gotsaeng/context-pack/PROJECT_CONTEXT.md"),
      "# Context",
      "utf8",
    );

    const files = await scanMarkdownFiles(fsAdapter, vaultDir);

    expect(files.map((file) => path.relative(vaultDir, file))).toEqual(["notes/project.md"]);
  });

  it("excludes files matching ignoreGlobs", async () => {
    const vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), "gotsaeng-scanner-ignore-"));
    await fs.mkdir(path.join(vaultDir, "notes"), { recursive: true });
    await fs.mkdir(path.join(vaultDir, "Out"), { recursive: true });

    await fs.writeFile(path.join(vaultDir, "notes/project.md"), "# Project", "utf8");
    await fs.writeFile(path.join(vaultDir, "Out/PROJECT_CONTEXT.md"), "# Generated", "utf8");

    const all = await scanSourceFiles(fsAdapter, vaultDir);
    expect(all.map((file) => path.relative(vaultDir, file)).sort()).toEqual([
      "Out/PROJECT_CONTEXT.md",
      "notes/project.md",
    ]);

    const filtered = await scanSourceFiles(fsAdapter, vaultDir, { ignoreGlobs: ["Out/**"] });
    expect(filtered.map((file) => path.relative(vaultDir, file))).toEqual(["notes/project.md"]);

    // A pattern matching the directory itself, with no "/**" suffix, must
    // exclude its whole subtree too — this is real fast-glob behavior
    // (verified directly against it), not just an extension of it: `ignore:
    // ["Out"]` there excludes everything under Out/, not only a file
    // literally named "Out".
    const bareDirPattern = await scanSourceFiles(fsAdapter, vaultDir, { ignoreGlobs: ["Out"] });
    expect(bareDirPattern.map((file) => path.relative(vaultDir, file))).toEqual([
      "notes/project.md",
    ]);
  });

  it("requires glob metacharacters in a literal folder name to be escaped to be ignored", async () => {
    const vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), "gotsaeng-scanner-meta-"));
    await fs.mkdir(path.join(vaultDir, "notes"), { recursive: true });
    await fs.mkdir(path.join(vaultDir, "Out{a,b}"), { recursive: true });

    await fs.writeFile(path.join(vaultDir, "notes/project.md"), "# Project", "utf8");
    await fs.writeFile(path.join(vaultDir, "Out{a,b}/PROJECT_CONTEXT.md"), "# Generated", "utf8");

    // Naive (unescaped) pattern: picomatch brace-expands "{a,b}", so it does NOT match
    // the literal folder — the generated file leaks back in (issue #6 regression).
    const naive = await scanSourceFiles(fsAdapter, vaultDir, { ignoreGlobs: ["Out{a,b}/**"] });
    expect(naive.map((file) => path.relative(vaultDir, file)).sort()).toEqual([
      "Out{a,b}/PROJECT_CONTEXT.md",
      "notes/project.md",
    ]);

    // Escaped pattern (what buildOutputIgnoreGlobs produces) matches it literally.
    const escaped = await scanSourceFiles(fsAdapter, vaultDir, {
      ignoreGlobs: ["Out\\{a,b\\}/**"],
    });
    expect(escaped.map((file) => path.relative(vaultDir, file))).toEqual(["notes/project.md"]);
  });

  it("excludes dotfiles and dot-folders by default, beyond the named default ignores", async () => {
    // Regression coverage for the fast-glob -> adapter.list() rewrite: the old
    // scan used fast-glob's `dot: false`, which drops every dot-prefixed path
    // segment, not just the four names DEFAULT_IGNORES happens to list.
    const vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), "gotsaeng-scanner-dotfiles-"));
    await fs.mkdir(path.join(vaultDir, ".pinned"), { recursive: true });
    await fs.writeFile(path.join(vaultDir, ".pinned/note.md"), "# Pinned", "utf8");
    await fs.writeFile(path.join(vaultDir, ".hidden-note.md"), "# Hidden", "utf8");
    await fs.writeFile(path.join(vaultDir, "normal.md"), "# Normal", "utf8");

    const files = await scanMarkdownFiles(fsAdapter, vaultDir);

    expect(files.map((file) => path.relative(vaultDir, file))).toEqual(["normal.md"]);
  });

  it("prunes an entire ignored subtree instead of walking it", async () => {
    const vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), "gotsaeng-scanner-prune-"));
    await fs.mkdir(path.join(vaultDir, "notes"), { recursive: true });
    await fs.mkdir(path.join(vaultDir, "Out/nested/deep"), { recursive: true });
    await fs.writeFile(path.join(vaultDir, "notes/project.md"), "# Project", "utf8");
    await fs.writeFile(path.join(vaultDir, "Out/nested/deep/generated.md"), "# Generated", "utf8");

    let listCalls = 0;
    const countingAdapter = {
      ...fsAdapter,
      list: (target: string) => {
        listCalls += 1;
        return fsAdapter.list(target);
      },
    };

    const files = await scanSourceFiles(countingAdapter, vaultDir, { ignoreGlobs: ["Out/**"] });

    expect(files.map((file) => path.relative(vaultDir, file))).toEqual(["notes/project.md"]);
    // vaultDir itself + notes/ only — Out/, Out/nested/, and Out/nested/deep/
    // are pruned without ever being listed.
    expect(listCalls).toBe(2);
  });

  it("prunes a subtree matched by a bare directory-name pattern too, not just a /**-suffixed one", async () => {
    const vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), "gotsaeng-scanner-prune-bare-"));
    await fs.mkdir(path.join(vaultDir, "notes"), { recursive: true });
    await fs.mkdir(path.join(vaultDir, "Out/nested"), { recursive: true });
    await fs.writeFile(path.join(vaultDir, "notes/project.md"), "# Project", "utf8");
    await fs.writeFile(path.join(vaultDir, "Out/nested/generated.md"), "# Generated", "utf8");

    let listCalls = 0;
    const countingAdapter = {
      ...fsAdapter,
      list: (target: string) => {
        listCalls += 1;
        return fsAdapter.list(target);
      },
    };

    const files = await scanSourceFiles(countingAdapter, vaultDir, { ignoreGlobs: ["Out"] });

    expect(files.map((file) => path.relative(vaultDir, file))).toEqual(["notes/project.md"]);
    // vaultDir itself + notes/ only — Out/ is pruned at the top, never listed.
    expect(listCalls).toBe(2);
  });

  it("follows a symlinked file and a symlinked directory, matching fast-glob's old default", async () => {
    const target = await fs.mkdtemp(path.join(os.tmpdir(), "gotsaeng-scanner-symlink-target-"));
    await fs.writeFile(path.join(target, "shared-note.md"), "# Shared", "utf8");

    const vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), "gotsaeng-scanner-symlink-"));
    await fs.writeFile(path.join(vaultDir, "note.md"), "# Note", "utf8");
    await fs.symlink(path.join(target, "shared-note.md"), path.join(vaultDir, "linked-note.md"));
    await fs.symlink(target, path.join(vaultDir, "linked-dir"));

    const files = await scanMarkdownFiles(fsAdapter, vaultDir);

    expect(files.map((file) => path.relative(vaultDir, file)).sort()).toEqual([
      "linked-dir/shared-note.md",
      "linked-note.md",
      "note.md",
    ]);
  });

  it("does not hang or crash on a symlink cycle", async () => {
    // fast-glob, the previous scanner, had no real cycle detection either
    // (verified directly against it): a cyclic vault just hit an incidental
    // recursion-depth ceiling inside its walker and returned increasingly
    // duplicated results, rather than hanging or erroring. MAX_SCAN_DEPTH is
    // an explicit version of that same bound, so a cycle here is expected to
    // produce a bounded amount of duplicated output, not a clean single
    // result — what matters is that the scan terminates at all.
    const vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), "gotsaeng-scanner-symlink-loop-"));
    await fs.writeFile(path.join(vaultDir, "note.md"), "# Note", "utf8");
    await fs.mkdir(path.join(vaultDir, "sub"), { recursive: true });
    // Points back at an ancestor (the scan root itself).
    await fs.symlink(vaultDir, path.join(vaultDir, "sub/loop"));

    const files = await scanMarkdownFiles(fsAdapter, vaultDir);

    expect(files).toContain(path.join(vaultDir, "note.md"));
    expect(files.length).toBeGreaterThan(1);
    expect(files.length).toBeLessThan(500);
  });

  it("returns identical results scanning the same root twice with one adapter instance", async () => {
    // compileContextPack (compiler.ts) calls scanSourceFiles then
    // scanMarkdownFiles against the same sourceRoot, passing the same
    // FileSystemAdapter instance to both. Regression coverage for an earlier
    // draft of the symlink fix above, which tracked "already-visited
    // directories" as state on the adapter itself rather than scoped to one
    // scanSourceFiles() call — the second scan of an already-scanned root
    // came back empty, since every real directory looked "already visited"
    // from the first one.
    const vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), "gotsaeng-scanner-rescan-"));
    await fs.mkdir(path.join(vaultDir, "notes"), { recursive: true });
    await fs.writeFile(path.join(vaultDir, "notes/project.md"), "# Project", "utf8");

    const first = await scanSourceFiles(fsAdapter, vaultDir);
    const second = await scanMarkdownFiles(fsAdapter, vaultDir);

    expect(first.map((file) => path.relative(vaultDir, file))).toEqual(["notes/project.md"]);
    expect(second.map((file) => path.relative(vaultDir, file))).toEqual(["notes/project.md"]);
  });
});
