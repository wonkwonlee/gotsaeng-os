import fs from "node:fs/promises";
import path from "node:path";

import type { FileSystemAdapter } from "@gotsaeng/core";

/**
 * Test-only `node:fs` adapter, used where a test exercises output-cleanup.ts
 * or main.ts against a real temp directory rather than the in-memory
 * mocks/obsidian.ts adapter. Duplicated from the equivalent helpers in
 * packages/core/test and packages/cli/src rather than shared: none of them
 * are meant to be reachable from apps/obsidian-plugin/src, which is the
 * property that keeps node:fs out of the shipped plugin bundle.
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
      // See packages/cli/src/node-file-system.ts for why this is lstat-gated
      // rather than an unconditional remove or an exists()-gated one: lstat
      // catches dangling symlinks (exists() would miss them and let the
      // write below follow the link) while only removing actual symlinks
      // preserves permissions on normal pre-existing files.
      const lstat = await fs.lstat(target).catch(() => null);
      if (lstat?.isSymbolicLink()) {
        await fs.rm(target, { force: true });
      }
      await fs.writeFile(target, data, "utf8");
    },

    async mkdir(target) {
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
