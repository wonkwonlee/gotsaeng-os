import path from "node:path";

import { CompileReportSchema, type FileSystemAdapter } from "@gotsaeng/core";

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

// Candidates come from the caller's persisted `managedOutputFolders` (folders
// this plugin instance has actually written to with consent — see
// GotSaengPluginSettings.managedOutputFolders), not from the two built-in
// folder *names* unconditionally. A folder merely being named
// `.gotsaeng/context-pack` or `Gotsaeng/Context Pack` is not proof this vault
// ever used it: sweeping it anyway would silently delete files that
// reappeared there from a vault sync, backup restore, or coincidence, even
// though the plugin is not (and may never have been) managing that folder in
// this vault. Callers that know which folder is being vacated right now pass
// it as `previousOutputFolder` so it is swept too, even if the caller hasn't
// re-saved settings yet with it included in `managedOutputFolders`.
//
// `managedOutputFolders` is required, with no default: defaulting it to both
// built-ins made "forgot to pass the persisted set" silently equivalent to
// "sweep both built-in folders unconditionally" — exactly the permissive
// behavior this parameter exists to end. Omitting it is now a compile error
// instead.
export function getStaleManagedOutputFolders(
  currentOutputFolder: string,
  previousOutputFolder: string | undefined,
  managedOutputFolders: readonly string[],
): string[] {
  const normalizedCurrent = normalizeOutputFolder(currentOutputFolder);
  const candidates = new Set<string>();

  for (const folder of managedOutputFolders) {
    candidates.add(normalizeOutputFolder(folder));
  }

  if (previousOutputFolder !== undefined) {
    candidates.add(normalizeOutputFolder(previousOutputFolder));
  }

  candidates.delete(normalizedCurrent);
  return [...candidates];
}

// Non-destructive dry run for cleanupStaleManagedOutputFolders: counts how many
// GotSaeng-managed files a cleanup would remove, without removing anything. Lets
// callers show an honest confirmation ("this deletes N files") before acting.
export async function countStaleManagedOutputFiles(
  fsAdapter: FileSystemAdapter,
  vaultRoot: string,
  currentOutputFolder: string,
  previousOutputFolder: string | undefined,
  managedOutputFolders: readonly string[],
): Promise<number> {
  let total = 0;

  for (const outputFolder of await resolveSweepableOutputFolders(
    fsAdapter,
    vaultRoot,
    currentOutputFolder,
    previousOutputFolder,
    managedOutputFolders,
  )) {
    const outputDir = path.resolve(vaultRoot, outputFolder);
    for (const fileName of MANAGED_OUTPUT_FILE_NAMES) {
      if (await fsAdapter.exists(path.join(outputDir, fileName))) {
        total += 1;
      }
    }
  }

  return total;
}

export async function cleanupStaleManagedOutputFolders(
  fsAdapter: FileSystemAdapter,
  vaultRoot: string,
  currentOutputFolder: string,
  previousOutputFolder: string | undefined,
  managedOutputFolders: readonly string[],
): Promise<OutputCleanupResult[]> {
  const results: OutputCleanupResult[] = [];

  for (const outputFolder of await resolveSweepableOutputFolders(
    fsAdapter,
    vaultRoot,
    currentOutputFolder,
    previousOutputFolder,
    managedOutputFolders,
  )) {
    const outputDir = path.resolve(vaultRoot, outputFolder);
    const removedFiles = await removeManagedOutputFiles(fsAdapter, outputDir);
    const removedDirectories = await removeEmptyOutputDirectories(fsAdapter, vaultRoot, outputDir);

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
  fsAdapter: FileSystemAdapter,
  vaultRoot: string,
  currentOutputFolder: string,
  previousOutputFolder: string | undefined,
  managedOutputFolders: readonly string[],
): Promise<string[]> {
  const candidates = getStaleManagedOutputFolders(
    currentOutputFolder,
    previousOutputFolder,
    managedOutputFolders,
  );
  const sweepable: string[] = [];

  for (const folder of candidates) {
    if (
      isBuiltInManagedOutputFolder(folder) ||
      (await hasManagedOutputMarker(fsAdapter, vaultRoot, folder))
    ) {
      sweepable.push(folder);
    }
  }

  return sweepable;
}

function isBuiltInManagedOutputFolder(folder: string): boolean {
  return (MANAGED_OUTPUT_FOLDERS as readonly string[]).includes(folder);
}

async function hasManagedOutputMarker(
  fsAdapter: FileSystemAdapter,
  vaultRoot: string,
  outputFolder: string,
): Promise<boolean> {
  const reportPath = path.resolve(vaultRoot, outputFolder, "COMPILE_REPORT.json");
  const raw = await fsAdapter.readText(reportPath);
  if (raw === null) {
    return false;
  }
  try {
    return CompileReportSchema.safeParse(JSON.parse(raw)).success;
  } catch {
    return false;
  }
}

async function removeManagedOutputFiles(
  fsAdapter: FileSystemAdapter,
  outputDir: string,
): Promise<string[]> {
  const removedFiles: string[] = [];

  for (const fileName of MANAGED_OUTPUT_FILE_NAMES) {
    const filePath = path.join(outputDir, fileName);
    if (!(await fsAdapter.exists(filePath))) {
      continue;
    }

    await fsAdapter.remove(filePath);
    removedFiles.push(fileName);
  }

  return removedFiles;
}

// Removes outputDir itself if it is empty — nothing more. This intentionally
// does NOT walk further upward toward vaultRoot: outputDir's ancestors (e.g.
// "Reports" in a custom folder "Reports/GotSaeng") are not directories this
// plugin created, even for a built-in folder's own container ("Gotsaeng" in
// "Gotsaeng/Context Pack") — only the exact managed leaf folder is ever safe
// to remove. Returns an array (0 or 1 entries) rather than a plain boolean to
// keep OutputCleanupResult.removedDirectories's shape unchanged for callers.
async function removeEmptyOutputDirectories(
  fsAdapter: FileSystemAdapter,
  vaultRoot: string,
  outputDir: string,
): Promise<string[]> {
  const resolvedVaultRoot = path.resolve(vaultRoot);
  const resolvedOutputDir = path.resolve(outputDir);

  if (
    resolvedOutputDir === resolvedVaultRoot ||
    !isInsidePath(resolvedVaultRoot, resolvedOutputDir)
  ) {
    return [];
  }

  if (!(await fsAdapter.exists(resolvedOutputDir))) {
    return [];
  }

  const { files, folders } = await fsAdapter.list(resolvedOutputDir);
  if (files.length > 0 || folders.length > 0) {
    return [];
  }

  await fsAdapter.rmdir(resolvedOutputDir);
  return [path.relative(resolvedVaultRoot, resolvedOutputDir)];
}
