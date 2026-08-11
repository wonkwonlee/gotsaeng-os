import fs from "node:fs/promises";
import path from "node:path";

export type ServerConfig = {
  vaultRoot: string;
  outputRoot: string;
  projectName: string;
  staleDays: number;
};

export async function resolveServerConfig(input: {
  vault: string;
  output: string;
  project: string;
  staleDays?: number;
}): Promise<ServerConfig> {
  const vaultRoot = path.resolve(input.vault);
  const outputRoot = path.resolve(input.output);

  let stats;
  try {
    stats = await fs.stat(vaultRoot);
  } catch {
    throw new Error(`Vault path does not exist: ${vaultRoot}`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`Vault path is not a directory: ${vaultRoot}`);
  }

  // Canonicalize both roots before comparing containment: a lexical-only
  // check on path.resolve() output does not follow symlinks, so an alias
  // directory pointing at the vault (or a symlinked ancestor of the output
  // path) could pass a naive check while physically resolving inside the
  // vault. The vault must exist (checked above), so it can be realpath'd
  // directly; the output usually does not exist yet, so its nearest existing
  // ancestor is realpath'd and the non-existent suffix is rejoined unresolved.
  const canonicalVaultRoot = await fs.realpath(vaultRoot);
  const canonicalOutputRoot = await realpathNearestAncestor(outputRoot);

  if (isInsideOrEqual(canonicalVaultRoot, canonicalOutputRoot)) {
    throw new Error(
      `Output directory must not be the vault root or nested inside it: ${outputRoot} resolves inside ${vaultRoot}.`,
    );
  }
  const staleDays = input.staleDays ?? 90;
  if (!Number.isInteger(staleDays) || staleDays <= 0) {
    throw new Error("staleDays must be a positive integer.");
  }
  if (input.project.trim().length === 0) {
    throw new Error("Project name must not be empty.");
  }

  return {
    vaultRoot: canonicalVaultRoot,
    outputRoot: canonicalOutputRoot,
    projectName: input.project,
    staleDays,
  };
}

// True when `child` is `parent` itself or a path nested inside it. Used to
// reject an --output directory that lives inside the vault: writing generated
// reports there would feed compiled content back into the next compile's
// scanMarkdownFiles, and it violates the server's read-only vault boundary.
function isInsideOrEqual(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

// Resolves symlinks in the nearest existing ancestor of `candidate`, then
// rejoins the non-existent trailing path segments unresolved (they can't
// contain symlinks — they don't exist yet). Falls back to the original
// (lexically resolved) candidate if no ancestor up to the filesystem root
// exists, which should not happen in practice.
async function realpathNearestAncestor(candidate: string): Promise<string> {
  const trailing: string[] = [];
  let current = candidate;

  while (true) {
    try {
      const real = await fs.realpath(current);
      return trailing.length > 0 ? path.join(real, ...trailing.reverse()) : real;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        throw error;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        return candidate;
      }
      trailing.push(path.basename(current));
      current = parent;
    }
  }
}

// Single chokepoint for turning a tool-supplied artifact name into a path.
// Names are bare file names inside outputRoot — never nested, never absolute.
export function resolveArtifactPath(outputRoot: string, name: string): string {
  if (
    name.length === 0 ||
    name.includes("/") ||
    name.includes("\\") ||
    name === ".." ||
    path.isAbsolute(name)
  ) {
    throw new Error(`Invalid artifact name: ${JSON.stringify(name)}`);
  }
  const resolved = path.resolve(outputRoot, name);
  if (path.dirname(resolved) !== path.resolve(outputRoot)) {
    throw new Error(`Invalid artifact name: ${JSON.stringify(name)}`);
  }
  return resolved;
}
