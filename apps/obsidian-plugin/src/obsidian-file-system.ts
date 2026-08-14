import path from "node:path";

import type { FileSystemAdapter } from "@gotsaeng/core";
import type { App } from "obsidian";

import { normalizeVaultPath, resolveVaultBasePath } from "./vault-path";

/**
 * `app.vault.adapter`-backed FileSystemAdapter for core. `packages/core`
 * only ever sees real absolute OS paths under the vault root (exactly what
 * it saw before this adapter existed) — this wrapper is the sole place that
 * translates them to/from the vault-relative normalized paths
 * `app.vault.adapter` actually expects, so no other file in this plugin
 * needs to know or care about that distinction. `node:fs` is never imported
 * here; every read/write goes through Obsidian's own storage layer.
 */
export function createObsidianFileSystemAdapter(app: App): FileSystemAdapter {
  const vaultRoot = resolveVaultBasePath(app);
  const adapter = app.vault.adapter;

  function toVaultRelative(absolutePath: string): string {
    return normalizeVaultPath(path.relative(vaultRoot, absolutePath));
  }

  function toAbsolute(vaultRelativePath: string): string {
    return path.join(vaultRoot, vaultRelativePath);
  }

  return {
    async exists(target) {
      return adapter.exists(toVaultRelative(target));
    },

    async isDirectory(target) {
      const stat = await adapter.stat(toVaultRelative(target));
      return stat?.type === "folder";
    },

    async list(target) {
      const { files, folders } = await adapter.list(toVaultRelative(target));
      return {
        files: files.map(toAbsolute),
        folders: folders.map(toAbsolute),
      };
    },

    async readText(target) {
      const relative = toVaultRelative(target);
      if (!(await adapter.exists(relative))) {
        return null;
      }
      return adapter.read(relative);
    },

    async readBinary(target) {
      const relative = toVaultRelative(target);
      if (!(await adapter.exists(relative))) {
        return null;
      }
      return new Uint8Array(await adapter.readBinary(relative));
    },

    async writeText(target, data) {
      const relative = toVaultRelative(target);
      await adapter.mkdir(toVaultRelative(path.dirname(target)));
      // Delete-then-create, matching the Node adapters (see
      // packages/cli/src/node-file-system.ts): on desktop, DataAdapter is a
      // thin wrapper over the real filesystem, so `write()` most likely
      // follows a symlink at this path the same way node:fs does. `remove()`
      // operates on the entry itself, not whatever it points to, so this
      // guarantees the file left at `relative` afterward is one this call
      // created — not, if a vault had a symlink planted at a generated
      // artifact's path, whatever that symlink redirected the write into.
      //
      // Unconditional, not exists()-gated: unlike node:fs's lstat, exists()
      // follows the link to check whether its *target* is there. A dangling
      // symlink (target missing) makes exists() report false, skipping
      // removal and letting the write below follow the same dangling link
      // and create a file wherever it points, outside the vault. try/catch
      // is the only way to attempt-and-ignore here since DataAdapter has no
      // lstat equivalent to check first.
      //
      // Only a confirmed "nothing there" (ENOENT) is swallowed. Desktop's
      // DataAdapter wraps node:fs, so a real removal failure — e.g. an
      // untrusted vault planting a symlink inside a directory this process
      // can't write to, or one pointing at a file it can't delete — surfaces
      // with a non-ENOENT code and must abort here. Falling through to
      // adapter.write() on that error would still follow the symlink it just
      // failed to remove and overwrite whatever it points to outside the
      // vault, the exact bug this whole guard exists to close.
      try {
        await adapter.remove(relative);
      } catch (error) {
        if (!isEnoent(error)) {
          throw error;
        }
      }
      await adapter.write(relative, data);
    },

    async mkdir(target) {
      // No equivalent guard here: DataAdapter's Stat has only 'file' | 'folder'
      // (no 'symlink' variant), meaning stat()-based APIs already resolve a
      // symlink to its target type before we ever see it — there is no way to
      // detect "this path is a symlink" through this interface at all, unlike
      // node:fs's lstat. mkdir() on an already-real folder must stay a no-op
      // regardless (see the Node adapters), so this can only pass through.
      await adapter.mkdir(toVaultRelative(target));
    },

    async remove(target) {
      const relative = toVaultRelative(target);
      if (await adapter.exists(relative)) {
        await adapter.remove(relative);
      }
    },

    async rmdir(target) {
      await adapter.rmdir(toVaultRelative(target), false);
    },
  };
}

function isEnoent(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
