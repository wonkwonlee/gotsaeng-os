import fs from "node:fs/promises";
import path from "node:path";

import fg from "fast-glob";

import { compareStrings, normalizePath } from "./utils/path";

const DEFAULT_IGNORES = [
  "**/node_modules/**",
  "**/.git/**",
  "**/.obsidian/**",
  "**/.gotsaeng/**",
  "**/dist/**",
  "**/coverage/**"
];

async function assertDirectory(rootPath: string): Promise<string> {
  const resolved = path.resolve(rootPath);
  const stat = await fs.stat(resolved);
  if (!stat.isDirectory()) {
    throw new Error(`Source path is not a directory: ${rootPath}`);
  }
  return resolved;
}

export async function scanSourceFiles(rootPath: string): Promise<string[]> {
  const resolvedRoot = await assertDirectory(rootPath);
  const files = await fg(["**/*"], {
    cwd: resolvedRoot,
    onlyFiles: true,
    absolute: true,
    dot: false,
    ignore: DEFAULT_IGNORES
  });

  return files.map((file) => path.resolve(file)).sort((a, b) => compareStrings(normalizePath(a), normalizePath(b)));
}

export async function scanMarkdownFiles(rootPath: string): Promise<string[]> {
  const files = await scanSourceFiles(rootPath);
  return files.filter((file) => /\.(md|markdown)$/i.test(file));
}
