/**
 * Storage boundary between the compiler and whatever it is reading/writing
 * from. `packages/core` never imports `node:fs` itself — every caller injects
 * an implementation: `packages/cli` and `packages/mcp` use a `node:fs`-backed
 * one, `apps/obsidian-plugin` uses one backed by `app.vault.adapter`. Paths
 * are opaque strings scoped to whatever a given implementation considers its
 * root; core only ever joins/compares them with `node:path`-style string
 * operations, never touches the filesystem directly.
 *
 * `readText`/`readBinary` return `null` for a missing path instead of
 * throwing, since Obsidian's `DataAdapter` does not guarantee a Node-shaped
 * `ENOENT` error to distinguish "missing" from other failures.
 */
export type FileSystemAdapter = {
  exists(path: string): Promise<boolean>;
  isDirectory(path: string): Promise<boolean>;
  /** Non-recursive: direct children only, as full paths (not bare names). */
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  readText(path: string): Promise<string | null>;
  readBinary(path: string): Promise<Uint8Array | null>;
  /** Creates parent directories as needed. */
  writeText(path: string, data: string): Promise<void>;
  /** Recursive; a no-op if the directory already exists. */
  mkdir(path: string): Promise<void>;
  /** Deletes a file. A no-op if it does not exist. */
  remove(path: string): Promise<void>;
  /** Removes an empty directory. Throws if it does not exist or is not empty. */
  rmdir(path: string): Promise<void>;
};
