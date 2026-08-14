import fs from "node:fs/promises";
import path from "node:path";

import type { FileSystemAdapter } from "@gotsaeng/core";

/**
 * `node:fs`-backed FileSystemAdapter for the CLI. Kept out of packages/core
 * (which never imports node:fs itself) so the same abstraction can be
 * injected with an app.vault.adapter-backed implementation in the Obsidian
 * plugin instead — see apps/obsidian-plugin/src/obsidian-file-system.ts.
 */
export function createNodeFileSystemAdapter(): FileSystemAdapter {
  return {
    async exists(target) {
      try {
        await fs.access(target);
        return true;
      } catch {
        return false;
      }
    },

    async isDirectory(target) {
      try {
        const stat = await fs.stat(target);
        return stat.isDirectory();
      } catch {
        return false;
      }
    },

    async list(target) {
      const entries = await fs.readdir(target, { withFileTypes: true });
      const files: string[] = [];
      const folders: string[] = [];
      for (const entry of entries) {
        const full = path.join(target, entry.name);
        if (entry.isFile()) {
          files.push(full);
          continue;
        }
        if (entry.isDirectory()) {
          folders.push(full);
          continue;
        }
        if (!entry.isSymbolicLink()) {
          continue;
        }
        // Dirent.isDirectory()/isFile() are false for a symlink (they
        // reflect the link itself, not its target) — packages/core's
        // scanner follows symlinks, matching the fast-glob scanner it
        // replaced, so stat() (which follows them) classifies anything
        // readdir couldn't. A broken symlink stat()s to neither and is
        // skipped, same as it contributing nothing to a scan either way.
        const kind = await statKind(full);
        if (kind === "file") {
          files.push(full);
        } else if (kind === "directory") {
          folders.push(full);
        }
      }
      return { files, folders };
    },

    async readText(target) {
      try {
        return await fs.readFile(target, "utf8");
      } catch (error) {
        if (isEnoent(error)) {
          return null;
        }
        throw error;
      }
    },

    async readBinary(target) {
      try {
        return await fs.readFile(target);
      } catch (error) {
        if (isEnoent(error)) {
          return null;
        }
        throw error;
      }
    },

    async writeText(target, data) {
      await fs.mkdir(path.dirname(target), { recursive: true });
      // fs.writeFile opens `target` following a symlink at the final path
      // segment, so if a vault (or output directory) already has a symlink
      // planted at this exact generated-artifact path, a plain write would
      // silently truncate and overwrite whatever that symlink points to
      // instead of replacing the symlink itself. Removing it first closes
      // that off — fs.rm never follows the final segment, so this guarantees
      // the file left at `target` is one this call actually created.
      //
      // Gated on lstat (not a plain existence check, and not an
      // unconditional remove): lstat reports the link itself rather than
      // following it, so it correctly flags a *dangling* symlink (one whose
      // target doesn't exist) too, unlike an exists()-style check, which
      // would follow the link, find nothing, and skip removal — letting the
      // write below follow the same dangling link and create a file at
      // wherever it points instead. And only removing when it's actually a
      // symlink — not on every write — means a normal pre-existing generated
      // file (the common case: recompiling into the same output directory)
      // gets truncated in place rather than recreated, preserving whatever
      // mode/permissions the user set on it. (This does not protect against
      // a symlinked *ancestor* directory somewhere in `target`'s path —
      // closing that fully would need validating every path segment, a
      // separate, larger hardening pass.)
      const lstat = await fs.lstat(target).catch(() => null);
      if (lstat?.isSymbolicLink()) {
        await fs.rm(target, { force: true });
      }
      await fs.writeFile(target, data, "utf8");
    },

    async mkdir(target) {
      // Same reasoning as writeText above: a directory-shaped path a vault
      // pre-populates as a symlink should not be silently treated as "the
      // real output directory" — replace it with a real one. Unlike
      // writeText, only act when it's specifically a symlink: mkdir on an
      // already-real directory must stay a no-op, or every compile would
      // wipe out files an earlier compile wrote there instead of reusing
      // the directory.
      const lstat = await fs.lstat(target).catch(() => null);
      if (lstat?.isSymbolicLink()) {
        await fs.rm(target, { force: true });
      }
      await fs.mkdir(target, { recursive: true });
    },

    async remove(target) {
      await fs.rm(target, { force: true });
    },

    async rmdir(target) {
      await fs.rmdir(target);
    },
  };
}

async function statKind(target: string): Promise<"file" | "directory" | null> {
  try {
    const stat = await fs.stat(target);
    if (stat.isFile()) {
      return "file";
    }
    return stat.isDirectory() ? "directory" : null;
  } catch {
    return null;
  }
}

function isEnoent(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
