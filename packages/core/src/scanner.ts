import path from "node:path";

import mm from "micromatch";

import type { FileSystemAdapter } from "./adapters/file-system";
import { compareStrings, normalizePath } from "./utils/path";

const DEFAULT_IGNORES = [
  "**/node_modules/**",
  "**/.git/**",
  "**/.obsidian/**",
  "**/.gotsaeng/**",
  "**/dist/**",
  "**/coverage/**",
];

// Node adapters follow symlinks (see packages/cli/src/node-file-system.ts),
// which means a symlink cycle (a folder linking back to one of its own
// ancestors) is reachable. fast-glob, the previous scanner, had no real
// cycle detection either — verified directly against it, a cyclic vault just
// hit an incidental recursion-depth ceiling inside its walker and returned
// increasingly duplicated results, rather than hanging or crashing. This is
// an explicit version of that same bound: deep enough that no legitimate
// vault's folder structure should ever hit it, shallow enough that a cycle
// stops doing real work quickly instead of accumulating duplicate output.
const MAX_SCAN_DEPTH = 200;

export type ScanOptions = {
  ignoreGlobs?: string[];
};

export async function scanSourceFiles(
  fsAdapter: FileSystemAdapter,
  rootPath: string,
  options?: ScanOptions,
): Promise<string[]> {
  const resolvedRoot = path.resolve(rootPath);
  if (!(await fsAdapter.isDirectory(resolvedRoot))) {
    throw new Error(`Source path is not a directory: ${rootPath}`);
  }

  const ignoreGlobs = [...DEFAULT_IGNORES, ...(options?.ignoreGlobs ?? [])];
  const files: string[] = [];
  await walk(fsAdapter, resolvedRoot, resolvedRoot, ignoreGlobs, files, 0);

  return files.sort((a, b) => compareStrings(normalizePath(a), normalizePath(b)));
}

export async function scanMarkdownFiles(
  fsAdapter: FileSystemAdapter,
  rootPath: string,
  options?: ScanOptions,
): Promise<string[]> {
  const files = await scanSourceFiles(fsAdapter, rootPath, options);
  return files.filter((file) => /\.(md|markdown)$/i.test(file));
}

async function walk(
  fsAdapter: FileSystemAdapter,
  root: string,
  dir: string,
  ignoreGlobs: string[],
  out: string[],
  depth: number,
): Promise<void> {
  if (depth > MAX_SCAN_DEPTH) {
    return;
  }

  const { files, folders } = await fsAdapter.list(dir);

  for (const file of files) {
    // Dotfiles (any path segment starting with ".") are excluded outright,
    // matching the previous fast-glob-based scan's `dot: false`. This also
    // covers .obsidian/.git/.gotsaeng on its own, but DEFAULT_IGNORES lists
    // them anyway so the ignore list stays self-documenting.
    if (isDotEntry(file) || isIgnored(root, file, ignoreGlobs)) {
      continue;
    }
    out.push(file);
  }

  for (const folder of folders) {
    // A folder whose own path matches an ignore pattern is pruned outright —
    // its entire subtree is skipped without being walked, not just filtered
    // out file-by-file after the fact. This matches fast-glob's actual
    // ignore semantics (verified directly against it): `ignoreGlobs: ["Out"]`
    // excludes everything under Out/, not just a file literally named "Out",
    // and `"Out/**"`-style patterns match the bare folder path too — `**` at
    // the end of a pattern matches zero segments, so `mm.isMatch("Out",
    // "Out/**")` is already true. One check on the folder's own path,
    // reusing the exact match call used for files, covers both pattern
    // shapes; no separate suffix-based case is needed.
    if (isDotEntry(folder) || isIgnored(root, folder, ignoreGlobs)) {
      continue;
    }
    await walk(fsAdapter, root, folder, ignoreGlobs, out, depth + 1);
  }
}

function isDotEntry(entryPath: string): boolean {
  return path.basename(entryPath).startsWith(".");
}

function isIgnored(root: string, entryPath: string, ignoreGlobs: string[]): boolean {
  return mm.isMatch(relativeTo(root, entryPath), ignoreGlobs, { dot: true });
}

function relativeTo(root: string, target: string): string {
  return normalizePath(path.relative(root, target));
}
