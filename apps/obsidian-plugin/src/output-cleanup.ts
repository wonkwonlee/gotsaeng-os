import fs from "node:fs/promises";
import path from "node:path";

import { OUTPUT_ARTIFACTS } from "./artifacts";
import { HIDDEN_OUTPUT_FOLDER, VISIBLE_OUTPUT_FOLDER, normalizeOutputFolder } from "./settings";

export type OutputCleanupResult = {
  outputFolder: string;
  removedFiles: string[];
  removedDirectories: string[];
};

const MANAGED_OUTPUT_FOLDERS = [HIDDEN_OUTPUT_FOLDER, VISIBLE_OUTPUT_FOLDER] as const;
const MANAGED_OUTPUT_FILE_NAMES = new Set(OUTPUT_ARTIFACTS.map((artifact) => artifact.fileName));

export function getStaleManagedOutputFolders(currentOutputFolder: string): string[] {
  const normalizedCurrent = normalizeOutputFolder(currentOutputFolder);
  return MANAGED_OUTPUT_FOLDERS.filter((folder) => folder !== normalizedCurrent);
}

export async function cleanupStaleManagedOutputFolders(
  vaultRoot: string,
  currentOutputFolder: string,
): Promise<OutputCleanupResult[]> {
  const results: OutputCleanupResult[] = [];

  for (const outputFolder of getStaleManagedOutputFolders(currentOutputFolder)) {
    const outputDir = path.resolve(vaultRoot, outputFolder);
    const removedFiles = await removeManagedOutputFiles(outputDir);
    const removedDirectories = await removeEmptyOutputDirectories(vaultRoot, outputDir);

    if (removedFiles.length > 0 || removedDirectories.length > 0) {
      results.push({ outputFolder, removedFiles, removedDirectories });
    }
  }

  return results;
}

async function removeManagedOutputFiles(outputDir: string): Promise<string[]> {
  const removedFiles: string[] = [];

  for (const fileName of MANAGED_OUTPUT_FILE_NAMES) {
    const filePath = path.join(outputDir, fileName);
    if (!(await pathExists(filePath))) {
      continue;
    }

    await fs.rm(filePath, { force: true });
    removedFiles.push(fileName);
  }

  return removedFiles;
}

async function removeEmptyOutputDirectories(
  vaultRoot: string,
  outputDir: string,
): Promise<string[]> {
  const removedDirectories: string[] = [];
  const resolvedVaultRoot = path.resolve(vaultRoot);
  let currentDir = path.resolve(outputDir);

  while (currentDir !== resolvedVaultRoot && isInsidePath(resolvedVaultRoot, currentDir)) {
    try {
      await fs.rmdir(currentDir);
      removedDirectories.push(path.relative(resolvedVaultRoot, currentDir));
      currentDir = path.dirname(currentDir);
    } catch (error) {
      if (isExpectedNonEmptyOrMissingDirectoryError(error)) {
        break;
      }
      throw error;
    }
  }

  return removedDirectories;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function isExpectedNonEmptyOrMissingDirectoryError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOTEMPTY" || error.code === "ENOENT" || error.code === "EEXIST")
  );
}

function isInsidePath(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
