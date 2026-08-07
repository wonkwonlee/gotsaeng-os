import { vi } from "vitest";

import type { TFile } from "./obsidian";

/**
 * Minimal fake for Obsidian's `App`, exposing only the `vault`/`workspace`
 * surface that apps/obsidian-plugin/src/main.ts and view.ts actually call:
 * `vault.adapter.getBasePath()`, `vault.getAbstractFileByPath()`,
 * `workspace.getLeavesOfType()`, `workspace.getLeaf().openFile()`, and
 * `workspace.revealLeaf()`.
 *
 * Every field is a `vi.fn()` so tests can both assert on calls and swap in
 * `.mockReturnValue()` / `.mockImplementation()` per test. Callers cast the
 * result to the real `App` type (`as unknown as App`) at the point of use —
 * the real interface has many more required members this mock does not
 * (and does not need to) implement.
 */
export function createFakeApp(vaultRoot: string) {
  return {
    vault: {
      adapter: {
        getBasePath: vi.fn((): string => vaultRoot),
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
