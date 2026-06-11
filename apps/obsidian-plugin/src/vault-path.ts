import path from "node:path";

import type { App } from "obsidian";

import { assertValidOutputFolderPath } from "./settings";

export type VaultPathInfo = {
  vaultRoot: string;
  outputFolder: string;
  outputDir: string;
};

type FileSystemLikeAdapter = {
  getBasePath?: () => string;
};

export function resolveVaultBasePath(app: App): string {
  const adapter = app.vault.adapter as FileSystemLikeAdapter;
  const basePath = adapter.getBasePath?.();
  if (!basePath) {
    throw new Error("GotSaeng OS requires Obsidian desktop with a file-system vault adapter.");
  }

  return basePath;
}

export function resolveOutputPath(app: App, outputFolder: string): VaultPathInfo {
  const vaultRoot = resolveVaultBasePath(app);
  assertValidOutputFolderPath(outputFolder);
  const normalizedFolder = normalizeVaultPath(outputFolder).replace(/^\/+/, "").replace(/\/+$/, "");
  const outputDir = path.resolve(vaultRoot, normalizedFolder);

  if (!isInsidePath(vaultRoot, outputDir)) {
    throw new Error(`Output folder must stay inside the current vault: ${outputFolder}`);
  }

  return {
    vaultRoot,
    outputFolder: normalizedFolder,
    outputDir,
  };
}

export function toVaultRelativePath(outputFolder: string, fileName: string): string {
  return normalizeVaultPath(`${outputFolder}/${fileName}`);
}

// fast-glob/picomatch metacharacters. A literal output folder containing any of
// these (e.g. "Reports [v2]") would otherwise be parsed as glob syntax and fail
// to ignore the real folder, silently re-introducing the issue #6 self-scan.
const GLOB_METACHARS = /[\\*?[\]{}()!+@|]/g;

// Build the scanner ignore globs for the plugin's own output folder, matching the
// folder literally. Path separators ("/") are preserved; only metacharacters are
// escaped. outputFolder is expected already vault-relative and slash-normalized.
export function buildOutputIgnoreGlobs(outputFolder: string): string[] {
  const escaped = outputFolder.replace(GLOB_METACHARS, "\\$&");
  return [`${escaped}/**`];
}

function normalizeVaultPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+/g, "/");
}

function isInsidePath(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
