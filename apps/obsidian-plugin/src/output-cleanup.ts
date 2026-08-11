import fs from "node:fs/promises";
import path from "node:path";

import { CompileReportSchema } from "@gotsaeng/core";

import { OUTPUT_ARTIFACTS } from "./artifacts";
import { HIDDEN_OUTPUT_FOLDER, VISIBLE_OUTPUT_FOLDER, normalizeOutputFolder } from "./settings";
import { isInsidePath } from "./vault-path";

export type OutputCleanupResult = {
  outputFolder: string;
  removedFiles: string[];
  removedDirectories: string[];
};

const MANAGED_OUTPUT_FOLDERS = [HIDDEN_OUTPUT_FOLDER, VISIBLE_OUTPUT_FOLDER] as const;
const MANAGED_OUTPUT_FILE_NAMES = new Set(OUTPUT_ARTIFACTS.map((artifact) => artifact.fileName));

// The two built-in folders are always candidates for cleanup, but a *custom*
// output folder is not one of them: leaving one would orphan its generated
// files forever, because no later cleanup pass ever looks at that path again.
// Callers that know which folder is being vacated pass it as
// `previousOutputFolder` so it is swept too.
export function getStaleManagedOutputFolders(
  currentOutputFolder: string,
  previousOutputFolder?: string,
): string[] {
  const normalizedCurrent = normalizeOutputFolder(currentOutputFolder);
  const candidates: string[] = [...MANAGED_OUTPUT_FOLDERS];

  if (previousOutputFolder !== undefined) {
    const normalizedPrevious = normalizeOutputFolder(previousOutputFolder);
    if (!candidates.includes(normalizedPrevious)) {
      candidates.push(normalizedPrevious);
    }
  }

  return candidates.filter((folder) => folder !== normalizedCurrent);
}

// Non-destructive dry run for cleanupStaleManagedOutputFolders: counts how many
// GotSaeng-managed files a cleanup would remove, without removing anything. Lets
// callers show an honest confirmation ("this deletes N files") before acting.
export async function countStaleManagedOutputFiles(
  vaultRoot: string,
  currentOutputFolder: string,
  previousOutputFolder?: string,
): Promise<number> {
  let total = 0;

  for (const outputFolder of await resolveSweepableOutputFolders(
    vaultRoot,
    currentOutputFolder,
    previousOutputFolder,
  )) {
    const outputDir = path.resolve(vaultRoot, outputFolder);
    for (const fileName of MANAGED_OUTPUT_FILE_NAMES) {
      if (await pathExists(path.join(outputDir, fileName))) {
        total += 1;
      }
    }
  }

  return total;
}

export async function cleanupStaleManagedOutputFolders(
  vaultRoot: string,
  currentOutputFolder: string,
  previousOutputFolder?: string,
): Promise<OutputCleanupResult[]> {
  const results: OutputCleanupResult[] = [];

  for (const outputFolder of await resolveSweepableOutputFolders(
    vaultRoot,
    currentOutputFolder,
    previousOutputFolder,
  )) {
    const outputDir = path.resolve(vaultRoot, outputFolder);
    const removedFiles = await removeManagedOutputFiles(outputDir);
    const removedDirectories = await removeEmptyOutputDirectories(vaultRoot, outputDir);

    if (removedFiles.length > 0 || removedDirectories.length > 0) {
      results.push({ outputFolder, removedFiles, removedDirectories });
    }
  }

  return results;
}

// The two built-in folders (`.gotsaeng/context-pack`, `Gotsaeng/Context Pack`) are
// exclusively plugin-owned by convention, so they are always safe to sweep. A
// *custom* folder is arbitrary user input — it can be "." (the vault root) or any
// other path that already holds the user's own notes — so filename matching alone
// ("a file named DECISION_LOG.md exists here") is not proof GotSaeng wrote it.
// Require a parseable COMPILE_REPORT.json (the compiler's own report, written on
// every compile) as a real ownership marker before a custom folder is swept.
async function resolveSweepableOutputFolders(
  vaultRoot: string,
  currentOutputFolder: string,
  previousOutputFolder: string | undefined,
): Promise<string[]> {
  const candidates = getStaleManagedOutputFolders(currentOutputFolder, previousOutputFolder);
  const sweepable: string[] = [];

  for (const folder of candidates) {
    if (isBuiltInManagedOutputFolder(folder) || (await hasManagedOutputMarker(vaultRoot, folder))) {
      sweepable.push(folder);
    }
  }

  return sweepable;
}

function isBuiltInManagedOutputFolder(folder: string): boolean {
  return (MANAGED_OUTPUT_FOLDERS as readonly string[]).includes(folder);
}

async function hasManagedOutputMarker(vaultRoot: string, outputFolder: string): Promise<boolean> {
  const reportPath = path.resolve(vaultRoot, outputFolder, "COMPILE_REPORT.json");
  try {
    const raw = await fs.readFile(reportPath, "utf8");
    return CompileReportSchema.safeParse(JSON.parse(raw)).success;
  } catch {
    return false;
  }
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
