import fs from "node:fs/promises";
import path from "node:path";

import { vi } from "vitest";

import type { TFile } from "./obsidian";

/**
 * Minimal fake for Obsidian's `App`, exposing only the `vault`/`workspace`
 * surface that apps/obsidian-plugin/src/main.ts, view.ts, and
 * obsidian-file-system.ts actually call.
 *
 * The `adapter` methods are real-disk-backed, not in-memory: each one
 * resolves the vault-relative path Obsidian's DataAdapter contract expects
 * against `vaultRoot` on real `node:fs`, mirroring what the real desktop
 * FileSystemAdapter does. This keeps tests free to set up and assert on
 * fixtures with plain `node:fs` calls against `vaultRoot`, exactly as they
 * did before ObsidianFileSystemAdapter existed — only main.ts's own access
 * path changed, not the shape of the on-disk fixtures tests build.
 *
 * Every field is a `vi.fn()` so tests can both assert on calls and swap in
 * `.mockReturnValue()` / `.mockImplementation()` per test. Callers cast the
 * result to the real `App` type (`as unknown as App`) at the point of use —
 * the real interface has many more required members this mock does not
 * (and does not need to) implement.
 */
export function createFakeApp(vaultRoot: string) {
  function resolve(vaultRelativePath: string): string {
    return path.join(vaultRoot, vaultRelativePath);
  }

  return {
    vault: {
      adapter: {
        getBasePath: vi.fn((): string => vaultRoot),

        exists: vi.fn(async (target: string): Promise<boolean> => {
          try {
            await fs.access(resolve(target));
            return true;
          } catch {
            return false;
          }
        }),

        stat: vi.fn(async (target: string) => {
          try {
            const info = await fs.stat(resolve(target));
            return {
              type: info.isDirectory() ? ("folder" as const) : ("file" as const),
              ctime: info.ctimeMs,
              mtime: info.mtimeMs,
              size: info.size,
            };
          } catch {
            return null;
          }
        }),

        list: vi.fn(async (target: string) => {
          const entries = await fs.readdir(resolve(target), { withFileTypes: true });
          const files: string[] = [];
          const folders: string[] = [];
          for (const entry of entries) {
            const relative = target ? `${target}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
              folders.push(relative);
            } else if (entry.isFile()) {
              files.push(relative);
            }
          }
          return { files, folders };
        }),

        read: vi.fn((target: string): Promise<string> => fs.readFile(resolve(target), "utf8")),

        readBinary: vi.fn(async (target: string): Promise<ArrayBuffer> => {
          const buffer = await fs.readFile(resolve(target));
          return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
        }),

        write: vi.fn(async (target: string, data: string): Promise<void> => {
          await fs.writeFile(resolve(target), data, "utf8");
        }),

        mkdir: vi.fn(async (target: string): Promise<void> => {
          await fs.mkdir(resolve(target), { recursive: true });
        }),

        remove: vi.fn(async (target: string): Promise<void> => {
          await fs.rm(resolve(target), { force: true });
        }),

        rmdir: vi.fn(async (target: string): Promise<void> => {
          await fs.rmdir(resolve(target));
        }),
      },
      getAbstractFileByPath: vi.fn((): TFile | null => null),
    },
    workspace: {
      getLeavesOfType: vi.fn((): unknown[] => []),
      getLeaf: vi.fn(() => ({
        openFile: vi.fn(async (): Promise<void> => {}),
        setViewState: vi.fn(async (): Promise<void> => {}),
      })),
      revealLeaf: vi.fn(async (): Promise<void> => {}),
    },
  };
}

export type FakeApp = ReturnType<typeof createFakeApp>;
