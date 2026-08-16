import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { App, PluginManifest, SettingDefinition, SettingDefinitionGroup } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import GotSaengObsidianPlugin from "../src/main";
import { GOTSAENG_REPORT_VIEW_TYPE } from "../src/view";
import { REPORT_HUB_FILE } from "../src/reports";
import {
  DEFAULT_SETTINGS,
  HIDDEN_OUTPUT_FOLDER,
  VISIBLE_OUTPUT_FOLDER,
  validateStaleDaysInput,
  type GotSaengPluginSettings,
} from "../src/settings";
import { createFakeApp } from "./mocks/fake-app";
import {
  PluginSettingTab,
  Setting,
  TFile,
  createdModals,
  createdSettings,
  recordedNotices,
  resetObsidianMocks,
  type FakeElement,
} from "./mocks/obsidian";

const FAKE_MANIFEST = {} as unknown as PluginManifest;

// The real (ambient, type-only) `Plugin` class main.ts extends does not
// declare `settingTab` or the `savedData` test hook — those only exist on
// the runtime mock in ./mocks/obsidian.ts (aliased in for "obsidian" at
// test time; see root vitest.config.ts). This view lets tests reach them
// without `any`, while `GotSaengObsidianPlugin`'s own declared surface
// (settings, the *Command methods, etc.) stays fully type-checked as-is.
type TestablePlugin = GotSaengObsidianPlugin & {
  settingTab: PluginSettingTab | null;
  savedData: unknown;
};

function asTestable(plugin: GotSaengObsidianPlugin): TestablePlugin {
  return plugin as unknown as TestablePlugin;
}

function createPlugin(vaultRoot: string, settings: GotSaengPluginSettings) {
  const fakeApp = createFakeApp(vaultRoot);
  const plugin = new GotSaengObsidianPlugin(fakeApp as unknown as App, FAKE_MANIFEST);
  plugin.settings = settings;
  return { plugin, fakeApp };
}

let tempRoot: string;

beforeEach(async () => {
  resetObsidianMocks();
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gotsaeng-obsidian-main-"));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe("GotSaengObsidianPlugin vault deletion call sites", () => {
  it("removes only managed artifacts from the stale output folder and leaves everything else in the vault untouched", async () => {
    // Sibling / parent content that must never be touched by cleanup.
    await fs.writeFile(path.join(tempRoot, "important-untouched.md"), "keep-root", "utf8");
    await fs.mkdir(path.join(tempRoot, "MyFolder"), { recursive: true });
    await fs.writeFile(path.join(tempRoot, "MyFolder/keep.md"), "keep-nested", "utf8");
    // A folder whose name merely starts with the same prefix as the managed
    // hidden folder — guards against any naive prefix-based delete.
    await fs.mkdir(path.join(tempRoot, ".gotsaeng-extra"), { recursive: true });
    await fs.writeFile(
      path.join(tempRoot, ".gotsaeng-extra/should-survive.md"),
      "keep-lookalike",
      "utf8",
    );

    // Stale managed folder (the plugin used to write here before switching
    // to the visible output folder below): one managed artifact that must be
    // removed, one user-authored file that must survive.
    const staleDir = path.join(tempRoot, HIDDEN_OUTPUT_FOLDER);
    await fs.mkdir(staleDir, { recursive: true });
    await fs.writeFile(path.join(staleDir, "REPORT_HUB.md"), "stale", "utf8");
    await fs.writeFile(path.join(staleDir, "USER_KEEP.md"), "keep-in-stale-dir", "utf8");

    const { plugin } = createPlugin(tempRoot, {
      ...DEFAULT_SETTINGS,
      outputFolderVisibility: "visible",
      outputFolder: VISIBLE_OUTPUT_FOLDER,
      openAfterCompile: false,
    });

    await plugin.compileContextPackCommand();

    const staleDirEntries = await fs.readdir(staleDir);
    expect(staleDirEntries).not.toContain("REPORT_HUB.md");
    expect(staleDirEntries).toContain("USER_KEEP.md");

    await expect(fs.readFile(path.join(tempRoot, "important-untouched.md"), "utf8")).resolves.toBe(
      "keep-root",
    );
    await expect(fs.readFile(path.join(tempRoot, "MyFolder/keep.md"), "utf8")).resolves.toBe(
      "keep-nested",
    );
    await expect(
      fs.readFile(path.join(tempRoot, ".gotsaeng-extra/should-survive.md"), "utf8"),
    ).resolves.toBe("keep-lookalike");

    await expect(
      fs.stat(path.join(tempRoot, VISIBLE_OUTPUT_FOLDER, REPORT_HUB_FILE)),
    ).resolves.toBeDefined();

    const cleanupNotice = recordedNotices.find((notice) => notice.message.includes("cleaned"));
    expect(cleanupNotice?.message).toBe(
      "GotSaeng OS: cleaned 1 stale generated files from previous output folder.",
    );
    expect(recordedNotices.some((notice) => notice.message.includes("compiled"))).toBe(true);
    expect(recordedNotices.some((notice) => notice.message.startsWith("GotSaeng OS: Error"))).toBe(
      false,
    );
  });

  it("does not touch the stale output folder or emit a cleanup notice when nothing managed is left there", async () => {
    const { plugin } = createPlugin(tempRoot, {
      ...DEFAULT_SETTINGS,
      outputFolderVisibility: "visible",
      outputFolder: VISIBLE_OUTPUT_FOLDER,
      openAfterCompile: false,
    });

    await plugin.compileContextPackCommand();

    await expect(fs.stat(path.join(tempRoot, HIDDEN_OUTPUT_FOLDER))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(recordedNotices.some((notice) => notice.message.includes("cleaned"))).toBe(false);
  });

  it("sweeps only folders in the persisted managed set, never the built-in folder names on their own (#9)", async () => {
    // The hidden built-in folder holds files with managed artifact names, but
    // this vault has never used it — `managedOutputFolders` lists only the
    // folder actually in use. Being one of the two built-in folder *names* is
    // not proof of ownership: files can reappear there from a vault sync or a
    // backup restore. This pins the call site, not just the helper: if main.ts
    // passed a hardcoded built-in list (or output-cleanup went back to
    // defaulting to one), these files would be deleted.
    const unmanagedBuiltInDir = path.join(tempRoot, HIDDEN_OUTPUT_FOLDER);
    await fs.mkdir(unmanagedBuiltInDir, { recursive: true });
    await fs.writeFile(path.join(unmanagedBuiltInDir, "REPORT_HUB.md"), "reappeared", "utf8");
    await fs.writeFile(path.join(unmanagedBuiltInDir, "DECISION_LOG.md"), "reappeared", "utf8");

    const { plugin } = createPlugin(tempRoot, {
      ...DEFAULT_SETTINGS,
      outputFolderVisibility: "visible",
      outputFolder: VISIBLE_OUTPUT_FOLDER,
      managedOutputFolders: [VISIBLE_OUTPUT_FOLDER],
      openAfterCompile: false,
    });

    await plugin.compileContextPackCommand();

    await expect(
      fs.readFile(path.join(unmanagedBuiltInDir, "REPORT_HUB.md"), "utf8"),
    ).resolves.toBe("reappeared");
    await expect(
      fs.readFile(path.join(unmanagedBuiltInDir, "DECISION_LOG.md"), "utf8"),
    ).resolves.toBe("reappeared");
    expect(recordedNotices.some((notice) => notice.message.includes("cleaned"))).toBe(false);
  });

  it("never offers to delete files from a built-in folder this vault never managed (#9)", async () => {
    // Same property on the confirm-before-delete path: the dry-run count that
    // the modal quotes must come from the persisted managed set too, or the
    // user is asked to approve deleting files the plugin does not own.
    const unmanagedBuiltInDir = path.join(tempRoot, HIDDEN_OUTPUT_FOLDER);
    await fs.mkdir(unmanagedBuiltInDir, { recursive: true });
    await fs.writeFile(path.join(unmanagedBuiltInDir, "REPORT_HUB.md"), "reappeared", "utf8");

    const { plugin } = createPlugin(tempRoot, {
      ...DEFAULT_SETTINGS,
      outputFolderVisibility: "custom",
      outputFolder: "Reports/GotSaeng",
      managedOutputFolders: ["Reports/GotSaeng"],
    });

    await plugin.switchOutputFolderVisibilityCommand("visible");

    expect(createdModals).toHaveLength(0);
    await expect(
      fs.readFile(path.join(unmanagedBuiltInDir, "REPORT_HUB.md"), "utf8"),
    ).resolves.toBe("reappeared");
  });

  it("also runs stale-folder cleanup from the Validate Vault Schema command", async () => {
    const staleDir = path.join(tempRoot, HIDDEN_OUTPUT_FOLDER);
    await fs.mkdir(staleDir, { recursive: true });
    await fs.writeFile(path.join(staleDir, "VALIDATION_REPORT.md"), "stale", "utf8");

    const { plugin } = createPlugin(tempRoot, {
      ...DEFAULT_SETTINGS,
      outputFolderVisibility: "visible",
      outputFolder: VISIBLE_OUTPUT_FOLDER,
      openAfterCompile: false,
    });

    await plugin.validateVaultSchemaCommand();

    const staleDirEntries = await fs.readdir(staleDir).catch(() => []);
    expect(staleDirEntries).not.toContain("VALIDATION_REPORT.md");
  });
});

describe("GotSaengObsidianPlugin runSafely error funnelling", () => {
  it("catches command failures, reports them as a Notice, and never throws out of the command", async () => {
    const { plugin } = createPlugin(tempRoot, {
      ...DEFAULT_SETTINGS,
      outputFolder: "../outside",
    });

    await expect(plugin.compileContextPackCommand()).resolves.toBeUndefined();

    expect(recordedNotices.map((notice) => notice.message)).toEqual([
      "GotSaeng OS: Compile Context Pack started.",
      "GotSaeng OS: Output folder cannot include '..' path segments.",
    ]);
  });

  it("records a persistent lastError on failure, and clears it on the next successful run", async () => {
    const failingPlugin = createPlugin(tempRoot, {
      ...DEFAULT_SETTINGS,
      outputFolder: "../outside",
    }).plugin;

    await failingPlugin.compileContextPackCommand();

    expect(failingPlugin.lastError).toMatchObject({
      action: "Compile Context Pack",
      message: "Output folder cannot include '..' path segments.",
    });
    expect(typeof failingPlugin.lastError?.timestamp).toBe("number");

    const { plugin } = createPlugin(tempRoot, { ...DEFAULT_SETTINGS, openAfterCompile: false });
    plugin.lastError = { action: "Compile Context Pack", message: "stale", timestamp: 0 };

    await plugin.compileContextPackCommand();

    expect(plugin.lastError).toBeNull();
  });

  it("dismisses the last error on demand without waiting for another command", () => {
    const { plugin } = createPlugin(tempRoot, { ...DEFAULT_SETTINGS });
    plugin.lastError = { action: "Compile Context Pack", message: "disk full", timestamp: 123 };

    plugin.dismissLastError();

    expect(plugin.lastError).toBeNull();
  });
});

describe("ConfirmModal accessibility", () => {
  it("sets an accessible title and moves focus to the Cancel button on open", async () => {
    const staleDir = path.join(tempRoot, HIDDEN_OUTPUT_FOLDER);
    await fs.mkdir(staleDir, { recursive: true });
    await fs.writeFile(path.join(staleDir, "REPORT_HUB.md"), "stale", "utf8");

    const { plugin } = createPlugin(tempRoot, { ...DEFAULT_SETTINGS });

    const switchPromise = plugin.switchOutputFolderVisibilityCommand("visible");
    const modal = await waitForConfirmModal();

    expect(modal.titleEl.text).toBe("Move generated output to Gotsaeng/Context Pack?");

    clickModalButton(modal, "Cancel");
    await switchPromise;
  });
});

describe("GotSaengObsidianPlugin file navigation", () => {
  it("notifies and opens the report hub view when the requested output file does not exist", async () => {
    const { plugin, fakeApp } = createPlugin(tempRoot, {
      ...DEFAULT_SETTINGS,
      outputFolderVisibility: "visible",
      outputFolder: VISIBLE_OUTPUT_FOLDER,
    });
    fakeApp.vault.getAbstractFileByPath.mockReturnValue(null);

    await plugin.openOutputFileByName("MISSING.md");

    expect(
      recordedNotices.some((notice) =>
        notice.message.includes("output file not found: Gotsaeng/Context Pack/MISSING.md"),
      ),
    ).toBe(true);
    expect(fakeApp.workspace.getLeavesOfType).toHaveBeenCalledWith(GOTSAENG_REPORT_VIEW_TYPE);
    expect(fakeApp.workspace.revealLeaf).toHaveBeenCalled();
  });

  it("opens the matching TFile when the requested output file exists", async () => {
    const { plugin, fakeApp } = createPlugin(tempRoot, {
      ...DEFAULT_SETTINGS,
      outputFolderVisibility: "visible",
      outputFolder: VISIBLE_OUTPUT_FOLDER,
    });
    const file = new TFile("Gotsaeng/Context Pack/REPORT_HUB.md");
    fakeApp.vault.getAbstractFileByPath.mockReturnValue(file);

    await plugin.openOutputFileByName(REPORT_HUB_FILE);

    const leaf = fakeApp.workspace.getLeaf.mock.results[0]?.value as {
      openFile: (f: unknown) => Promise<void>;
    };
    expect(leaf.openFile).toHaveBeenCalledWith(file);
  });

  it("notifies when the requested source note cannot be found", async () => {
    const { plugin, fakeApp } = createPlugin(tempRoot, DEFAULT_SETTINGS);
    fakeApp.vault.getAbstractFileByPath.mockReturnValue(null);

    await plugin.openSourceFileByPath("10_Wiki/missing.md");

    expect(
      recordedNotices.some((notice) =>
        notice.message.includes("source note not found: 10_Wiki/missing.md"),
      ),
    ).toBe(true);
  });

  it("opens the matching TFile when the requested source note exists", async () => {
    const { plugin, fakeApp } = createPlugin(tempRoot, DEFAULT_SETTINGS);
    const file = new TFile("10_Wiki/source-note.md");
    fakeApp.vault.getAbstractFileByPath.mockReturnValue(file);

    await plugin.openSourceFileByPath("10_Wiki/source-note.md");

    const leaf = fakeApp.workspace.getLeaf.mock.results[0]?.value as {
      openFile: (f: unknown) => Promise<void>;
    };
    expect(leaf.openFile).toHaveBeenCalledWith(file);
  });
});

// Any output-folder change that would delete GotSaeng-managed files opens a
// ConfirmModal and awaits a click before proceeding. Wait for the modal to
// appear (real fs.stat calls happen first) rather than assuming a fixed number
// of microtask ticks.
async function waitForConfirmModal() {
  await vi.waitFor(() => {
    if (createdModals.length === 0) {
      throw new Error("expected a confirmation modal to open");
    }
  });
  return createdModals[0]!;
}

function clickModalButton(modal: (typeof createdModals)[number], text: string): void {
  const button = modal.contentEl.findAllByTag("button").find((el) => el.text === text);
  button?.dispatch("click");
}

describe("GotSaengObsidianPlugin output folder visibility command", () => {
  it("asks for confirmation, then switches and cleans up the stale folder once confirmed", async () => {
    const staleDir = path.join(tempRoot, HIDDEN_OUTPUT_FOLDER);
    await fs.mkdir(staleDir, { recursive: true });
    await fs.writeFile(path.join(staleDir, "REPORT_HUB.md"), "stale", "utf8");

    const { plugin } = createPlugin(tempRoot, { ...DEFAULT_SETTINGS });

    const switchPromise = plugin.switchOutputFolderVisibilityCommand("visible");
    const modal = await waitForConfirmModal();
    clickModalButton(modal, "Delete and switch");
    await switchPromise;

    expect(plugin.settings.outputFolderVisibility).toBe("visible");
    expect(plugin.settings.outputFolder).toBe(VISIBLE_OUTPUT_FOLDER);

    const staleDirEntries = await fs.readdir(staleDir).catch(() => []);
    expect(staleDirEntries).not.toContain("REPORT_HUB.md");
    expect(
      recordedNotices.some((notice) =>
        notice.message.includes(`output folder switched to ${VISIBLE_OUTPUT_FOLDER}`),
      ),
    ).toBe(true);
  });

  it("cancels the switch and leaves the stale folder untouched when the user declines", async () => {
    const staleDir = path.join(tempRoot, HIDDEN_OUTPUT_FOLDER);
    await fs.mkdir(staleDir, { recursive: true });
    await fs.writeFile(path.join(staleDir, "REPORT_HUB.md"), "stale", "utf8");

    const { plugin } = createPlugin(tempRoot, { ...DEFAULT_SETTINGS });

    const switchPromise = plugin.switchOutputFolderVisibilityCommand("visible");
    const modal = await waitForConfirmModal();
    clickModalButton(modal, "Cancel");
    await switchPromise;

    expect(plugin.settings.outputFolderVisibility).toBe("hidden");
    const staleDirEntries = await fs.readdir(staleDir).catch(() => []);
    expect(staleDirEntries).toContain("REPORT_HUB.md");
    expect(recordedNotices.some((notice) => notice.message.includes("switch cancelled"))).toBe(
      true,
    );
  });

  it("switches immediately without a confirmation modal when there is nothing to delete", async () => {
    const { plugin } = createPlugin(tempRoot, { ...DEFAULT_SETTINGS });

    await plugin.switchOutputFolderVisibilityCommand("visible");

    expect(createdModals).toHaveLength(0);
    expect(plugin.settings.outputFolderVisibility).toBe("visible");
  });

  it("notifies without changing settings when the requested visibility is already active", async () => {
    const { plugin } = createPlugin(tempRoot, {
      ...DEFAULT_SETTINGS,
      outputFolderVisibility: "hidden",
      outputFolder: HIDDEN_OUTPUT_FOLDER,
    });

    await plugin.switchOutputFolderVisibilityCommand("hidden");

    expect(plugin.settings.outputFolder).toBe(HIDDEN_OUTPUT_FOLDER);
    expect(recordedNotices.some((notice) => notice.message.includes("already hidden"))).toBe(true);
  });

  it("counts and cleans a vacated custom folder when switching back to a built-in one", async () => {
    // The custom folder is not one of the two built-in managed folders, so it
    // is only reachable by cleanup because the previous folder is passed
    // explicitly. Without that, the modal would report 0 files and these
    // generated files would be orphaned permanently.
    const customDir = path.join(tempRoot, "Reports/GotSaeng");
    await fs.mkdir(customDir, { recursive: true });
    await fs.writeFile(path.join(customDir, "REPORT_HUB.md"), "stale", "utf8");
    await fs.writeFile(path.join(customDir, "USER_NOTE.md"), "keep", "utf8");
    // Ownership marker: a custom folder is only swept once it is proven to have
    // been written by a real GotSaeng compile (see output-cleanup.ts), not just
    // because it happens to contain a file with a managed artifact's name.
    await fs.writeFile(
      path.join(customDir, "COMPILE_REPORT.json"),
      JSON.stringify({
        filesScanned: 0,
        markdownFilesParsed: 0,
        filesSkipped: 0,
        parseErrors: [],
        warnings: [],
        generatedFiles: [],
      }),
      "utf8",
    );

    const { plugin } = createPlugin(tempRoot, {
      ...DEFAULT_SETTINGS,
      outputFolderVisibility: "custom",
      outputFolder: "Reports/GotSaeng",
    });

    const switchPromise = plugin.switchOutputFolderVisibilityCommand("hidden");
    const modal = await waitForConfirmModal();
    expect(modal.contentEl.findAllByTag("p").some((el) => el.text?.includes("2 GotSaeng"))).toBe(
      true,
    );
    clickModalButton(modal, "Delete and switch");
    await switchPromise;

    expect(plugin.settings.outputFolder).toBe(HIDDEN_OUTPUT_FOLDER);
    const customDirEntries = await fs.readdir(customDir).catch(() => []);
    expect(customDirEntries).not.toContain("REPORT_HUB.md");
    expect(customDirEntries).not.toContain("COMPILE_REPORT.json");
    expect(customDirEntries).toContain("USER_NOTE.md");
  });
});

describe("GotSaengObsidianPlugin readCurrentCompileReport", () => {
  async function writeCompileReport(outputFolder: string, contents: string): Promise<void> {
    const outputDir = path.join(tempRoot, outputFolder);
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(path.join(outputDir, "COMPILE_REPORT.json"), contents, "utf8");
  }

  it("reports a malformed compile report as unreadable instead of throwing before the view can rebuild (#4)", async () => {
    const { plugin } = createPlugin(tempRoot, {
      ...DEFAULT_SETTINGS,
      outputFolderVisibility: "visible",
      outputFolder: VISIBLE_OUTPUT_FOLDER,
    });

    await expect(plugin.readCurrentCompileReport()).resolves.toEqual({ status: "missing" });

    // Not JSON at all, then valid JSON that is not a compile report: both used
    // to throw out of here — before render() had emptied its container — which
    // froze the Report Hub on stale content permanently.
    await writeCompileReport(VISIBLE_OUTPUT_FOLDER, "{not json");
    await expect(plugin.readCurrentCompileReport()).resolves.toEqual({ status: "unreadable" });

    await writeCompileReport(VISIBLE_OUTPUT_FOLDER, JSON.stringify({ nope: true }));
    await expect(plugin.readCurrentCompileReport()).resolves.toEqual({ status: "unreadable" });

    const report = {
      filesScanned: 1,
      markdownFilesParsed: 1,
      filesSkipped: 0,
      parseErrors: [],
      warnings: [],
      generatedFiles: [],
    };
    await writeCompileReport(VISIBLE_OUTPUT_FOLDER, JSON.stringify(report));
    await expect(plugin.readCurrentCompileReport()).resolves.toMatchObject({
      status: "ok",
      report: { filesScanned: 1 },
    });
  });

  it("still reads the compile report when the index read throws outright", async () => {
    const { plugin, fakeApp } = createPlugin(tempRoot, {
      ...DEFAULT_SETTINGS,
      outputFolderVisibility: "visible",
      outputFolder: VISIBLE_OUTPUT_FOLDER,
    });

    await writeCompileReport(
      VISIBLE_OUTPUT_FOLDER,
      JSON.stringify({
        filesScanned: 3,
        markdownFilesParsed: 3,
        filesSkipped: 0,
        parseErrors: [],
        warnings: [],
        generatedFiles: [],
      }),
    );
    await fs.writeFile(
      path.join(tempRoot, VISIBLE_OUTPUT_FOLDER, "ARTIFACT_INDEX.json"),
      JSON.stringify({ projectName: "GotSaeng OS", generatedAt: "x", artifacts: [] }),
      "utf8",
    );

    // readText can reject rather than return null — the file removed between
    // its exists() check and the read, or a permissions error. Bundled into a
    // bare Promise.all, that took the compile-report read down with it and
    // degraded the whole Report Hub to "could not be rendered" over a
    // timestamp that is only ever a display detail.
    const { read } = fakeApp.vault.adapter;
    read.mockImplementation(async (target: string) => {
      if (target.endsWith("ARTIFACT_INDEX.json")) {
        throw new Error("EACCES: permission denied");
      }
      return fs.readFile(path.join(tempRoot, target), "utf8");
    });

    await expect(plugin.readCurrentCompileReport()).resolves.toMatchObject({
      status: "ok",
      report: { filesScanned: 3 },
      generatedAt: null,
    });
  });

  it("carries the compile timestamp from ARTIFACT_INDEX.json, which the report itself has no field for", async () => {
    const { plugin } = createPlugin(tempRoot, {
      ...DEFAULT_SETTINGS,
      outputFolderVisibility: "visible",
      outputFolder: VISIBLE_OUTPUT_FOLDER,
    });

    await writeCompileReport(
      VISIBLE_OUTPUT_FOLDER,
      JSON.stringify({
        filesScanned: 1,
        markdownFilesParsed: 1,
        filesSkipped: 0,
        parseErrors: [],
        warnings: [],
        generatedFiles: [],
      }),
    );

    // No index yet: a report with no timestamp is still a readable report, so
    // this reports null rather than failing the read the whole stats block
    // depends on.
    await expect(plugin.readCurrentCompileReport()).resolves.toMatchObject({
      status: "ok",
      generatedAt: null,
    });

    const indexPath = path.join(tempRoot, VISIBLE_OUTPUT_FOLDER, "ARTIFACT_INDEX.json");
    await fs.writeFile(indexPath, "{not json", "utf8");
    await expect(plugin.readCurrentCompileReport()).resolves.toMatchObject({ generatedAt: null });

    await fs.writeFile(indexPath, JSON.stringify({ nope: true }), "utf8");
    await expect(plugin.readCurrentCompileReport()).resolves.toMatchObject({ generatedAt: null });

    await fs.writeFile(
      indexPath,
      JSON.stringify({
        projectName: "GotSaeng OS",
        generatedAt: "2026-08-15T14:14:00.000Z",
        artifacts: [],
      }),
      "utf8",
    );
    await expect(plugin.readCurrentCompileReport()).resolves.toMatchObject({
      status: "ok",
      generatedAt: "2026-08-15T14:14:00.000Z",
    });
  });
});

describe("GotSaengObsidianPlugin command serialization", () => {
  it("runs overlapping commands one at a time so two runs never write to the output folder at once (#3)", async () => {
    const { plugin } = createPlugin(tempRoot, { ...DEFAULT_SETTINGS, openAfterCompile: false });

    // Both fired before either settles — the command palette and the ribbon
    // icon can do exactly this, and neither goes through the Report Hub's
    // disabled buttons.
    const compile = plugin.compileContextPackCommand();
    const validate = plugin.validateVaultSchemaCommand();
    await Promise.all([compile, validate]);

    const messages = recordedNotices.map((notice) => notice.message);
    const compileStarted = messages.indexOf("GotSaeng OS: Compile Context Pack started.");
    const compileFinished = messages.findIndex((message) => message.includes("compiled"));
    const validateStarted = messages.indexOf("GotSaeng OS: Validate Vault Schema started.");

    expect(compileStarted).toBeGreaterThanOrEqual(0);
    expect(compileStarted).toBeLessThan(compileFinished);
    expect(compileFinished).toBeLessThan(validateStarted);
  });
});

describe("GotSaengObsidianPlugin managed output folder bookkeeping", () => {
  it("prunes managed output folders that no longer exist so the sweep set stays bounded (#10)", async () => {
    await fs.mkdir(path.join(tempRoot, HIDDEN_OUTPUT_FOLDER), { recursive: true });

    const { plugin } = createPlugin(tempRoot, {
      ...DEFAULT_SETTINGS,
      outputFolderVisibility: "visible",
      outputFolder: VISIBLE_OUTPUT_FOLDER,
      managedOutputFolders: [HIDDEN_OUTPUT_FOLDER, "Reports/Gone", VISIBLE_OUTPUT_FOLDER],
    });

    await plugin.saveSettings();

    // "Reports/Gone" is gone from disk, so it can hold nothing worth sweeping.
    // The hidden folder still exists, and the folder in use is kept whether or
    // not it has been created yet.
    expect(plugin.settings.managedOutputFolders).toEqual([
      HIDDEN_OUTPUT_FOLDER,
      VISIBLE_OUTPUT_FOLDER,
    ]);
  });
});

describe("GotSaengObsidianPlugin readAllOutputFiles", () => {
  it("reads every generated Markdown artifact and skips missing files and JSON artifacts", async () => {
    const { plugin } = createPlugin(tempRoot, {
      ...DEFAULT_SETTINGS,
      outputFolderVisibility: "visible",
      outputFolder: VISIBLE_OUTPUT_FOLDER,
    });
    const outputDir = path.join(tempRoot, VISIBLE_OUTPUT_FOLDER);
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(path.join(outputDir, "REPORT_HUB.md"), "hub content", "utf8");
    await fs.writeFile(path.join(outputDir, "COMPILE_REPORT.json"), "{}", "utf8");

    const files = await plugin.readAllOutputFiles();

    expect(files["REPORT_HUB.md"]).toBe("hub content");
    expect(files["COMPILE_REPORT.json"]).toBeUndefined();
    expect(files["ACTION_BACKLOG.md"]).toBeUndefined();
  });
});

describe("GotSaengObsidianPlugin settings tab", () => {
  // `onload()` calls `loadSettings()`, which always runs persisted data
  // through `normalizeSettings()` (see src/settings.ts) — so, like the real
  // plugin, this helper persists settings via `loadData()` rather than
  // poking `plugin.settings` directly, and callers get back whatever
  // normalizeSettings actually produced.
  async function renderSettingsTab(persistedSettings: Partial<GotSaengPluginSettings> = {}) {
    const fakeApp = createFakeApp(tempRoot);
    const plugin = new GotSaengObsidianPlugin(fakeApp as unknown as App, FAKE_MANIFEST);
    const testablePlugin = asTestable(plugin);
    testablePlugin.savedData = persistedSettings;
    await plugin.onload();
    const settingTab = testablePlugin.settingTab;
    if (!(settingTab instanceof PluginSettingTab)) {
      throw new Error("expected onload() to register a settings tab");
    }
    createdSettings.length = 0;
    settingTab.display();
    return { plugin, settingTab, fakeApp };
  }

  it("updates the project name in memory on every keystroke but defers the write to disk", async () => {
    const { plugin } = await renderSettingsTab();

    const projectNameSetting = createdSettings.find((setting) => setting.name === "Project name");
    expect(projectNameSetting).toBeDefined();
    const text = projectNameSetting?.textComponents[0];

    await text?.emitChange("My Vaul");
    await text?.emitChange("My Vault");

    // What the compiler uses is what the field shows, immediately...
    expect(plugin.settings.projectName).toBe("My Vault");
    // ...but a full data.json write (plus normalization and the managed-folder
    // prune) has not run once per character.
    expect(asTestable(plugin).savedData).toEqual({});

    text?.inputEl.dispatch("blur");
    await vi.waitFor(() => {
      expect(asTestable(plugin).savedData).toMatchObject({ projectName: "My Vault" });
    });
  });

  it("flushes a deferred project name write when the settings tab closes", async () => {
    const { plugin, settingTab } = await renderSettingsTab();

    const projectNameSetting = createdSettings.find((setting) => setting.name === "Project name");
    await projectNameSetting?.textComponents[0]?.emitChange("My Vault");
    expect(asTestable(plugin).savedData).toEqual({});

    settingTab.hide();

    await vi.waitFor(() => {
      expect(asTestable(plugin).savedData).toMatchObject({ projectName: "My Vault" });
    });
  });

  it("does not lose a settings edit that lands while an earlier save's folder prune is still checking the filesystem (#Codex P2)", async () => {
    const { plugin, fakeApp } = await renderSettingsTab();

    // Holds the folder-prune's exists() check open until the test releases
    // it, so a second edit can land in the window between saveSettings()
    // taking its pre-prune snapshot and that same save actually persisting.
    let releaseExists: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      releaseExists = resolve;
    });
    const originalExists = fakeApp.vault.adapter.exists.getMockImplementation()!;
    fakeApp.vault.adapter.exists.mockImplementation(async (target: string) => {
      await blocked;
      return originalExists(target);
    });

    plugin.settings.projectName = "First";
    const firstSave = plugin.saveSettings();

    // Wait until the prune has genuinely started (not just scheduled) before
    // editing again — otherwise the second write could land before
    // saveSettings() even takes its pre-prune snapshot, which would prove
    // nothing about the race this test exists to cover.
    await vi.waitFor(() => {
      expect(fakeApp.vault.adapter.exists).toHaveBeenCalled();
    });

    plugin.settings.projectName = "Second";

    releaseExists?.();
    await firstSave;

    expect(plugin.settings.projectName).toBe("Second");
    expect(asTestable(plugin).savedData).toMatchObject({ projectName: "Second" });
  });

  it("switches output folder visibility via the dropdown", async () => {
    const { plugin } = await renderSettingsTab({
      outputFolderVisibility: "hidden",
      outputFolder: HIDDEN_OUTPUT_FOLDER,
    });

    const visibilitySetting = createdSettings.find(
      (setting) => setting.name === "Output folder visibility",
    );

    await visibilitySetting?.dropdownComponents[0]?.emitChange("visible");

    expect(plugin.settings.outputFolderVisibility).toBe("visible");
    expect(plugin.settings.outputFolder).toBe(VISIBLE_OUTPUT_FOLDER);
  });

  it("asks for confirmation from the dropdown too when switching would delete stale files", async () => {
    const staleDir = path.join(tempRoot, HIDDEN_OUTPUT_FOLDER);
    await fs.mkdir(staleDir, { recursive: true });
    await fs.writeFile(path.join(staleDir, "REPORT_HUB.md"), "stale", "utf8");

    const { plugin } = await renderSettingsTab({
      outputFolderVisibility: "hidden",
      outputFolder: HIDDEN_OUTPUT_FOLDER,
    });

    const visibilitySetting = createdSettings.find(
      (setting) => setting.name === "Output folder visibility",
    );

    // dropdownComponents[0].emitChange awaits the onChange handler directly,
    // so it can't be used here — the handler is now blocked on a modal that
    // nothing has clicked yet. Fire the change without awaiting, wait for
    // the modal, click "Cancel", then let the change settle.
    const changePromise = visibilitySetting?.dropdownComponents[0]?.emitChange("visible");
    await vi.waitFor(() => {
      if (createdModals.length === 0) {
        throw new Error("expected a confirmation modal to open");
      }
    });
    const modal = createdModals[0]!;
    const cancelButton = modal.contentEl.findAllByTag("button").find((el) => el.text === "Cancel");
    cancelButton?.dispatch("click");
    await changePromise;

    expect(plugin.settings.outputFolderVisibility).toBe("hidden");
    const staleDirEntries = await fs.readdir(staleDir).catch(() => []);
    expect(staleDirEntries).toContain("REPORT_HUB.md");
  });

  it("rejects an invalid custom output folder on blur without mutating settings", async () => {
    const { plugin } = await renderSettingsTab({
      outputFolderVisibility: "custom",
      outputFolder: "Reports/GotSaeng",
    });

    const pathSetting = createdSettings.find((setting) => setting.name === "Output folder path");
    const inputEl = pathSetting?.textComponents[0]?.inputEl;
    expect(inputEl?.value).toBe("Reports/GotSaeng");

    // Simulate the user typing an absolute path directly into the input,
    // then blurring away without it ever going through onChange/setValue.
    if (inputEl) {
      inputEl.value = "/absolute/path";
    }
    inputEl?.dispatch("blur");

    expect(plugin.settings.outputFolder).toBe("Reports/GotSaeng");
    expect(inputEl?.value).toBe("Reports/GotSaeng");
    expect(
      recordedNotices.some((notice) =>
        notice.message.includes(
          "GotSaeng OS settings: Output folder must be vault-relative; absolute paths are not supported.",
        ),
      ),
    ).toBe(true);

    // The rejection also lands on a persistent, field-associated surface, not
    // only in a Notice that disappears on its own (#1, #7).
    const error = pathSetting?.settingEl.findByClass("gotsaeng-os-setting-error");
    expect(error?.text).toContain("Output folder must be vault-relative");
    expect(inputEl?.getAttr("aria-invalid")).toBe("true");
    expect(inputEl?.getAttr("aria-describedby")).toBe(error?.getAttr("id"));
  });

  it("asks for confirmation before committing a custom output folder that would delete files", async () => {
    const staleDir = path.join(tempRoot, HIDDEN_OUTPUT_FOLDER);
    await fs.mkdir(staleDir, { recursive: true });
    await fs.writeFile(path.join(staleDir, "REPORT_HUB.md"), "stale", "utf8");

    // Custom visibility, not hidden: the field is read-only outside custom
    // mode and the commit path is gated on the same state (it used to be
    // gated on `disabled`, which a test assigning `inputEl.value` directly
    // walked straight past — so this was asserting a gesture the real UI
    // could never produce).
    const { plugin } = await renderSettingsTab({
      outputFolderVisibility: "custom",
      outputFolder: HIDDEN_OUTPUT_FOLDER,
    });

    const pathSetting = createdSettings.find((setting) => setting.name === "Output folder path");
    const inputEl = pathSetting?.textComponents[0]?.inputEl;
    if (inputEl) {
      inputEl.value = "Reports/GotSaeng";
    }
    inputEl?.dispatch("blur");

    const modal = await waitForConfirmModal();
    clickModalButton(modal, "Delete and switch");
    await vi.waitFor(() => {
      if (plugin.settings.outputFolder !== "Reports/GotSaeng") {
        throw new Error("expected the custom output folder to be committed");
      }
    });

    const staleDirEntries = await fs.readdir(staleDir).catch(() => []);
    expect(staleDirEntries).not.toContain("REPORT_HUB.md");
  });

  it("leaves the custom output folder unchanged when the confirmation is declined", async () => {
    const staleDir = path.join(tempRoot, HIDDEN_OUTPUT_FOLDER);
    await fs.mkdir(staleDir, { recursive: true });
    await fs.writeFile(path.join(staleDir, "REPORT_HUB.md"), "stale", "utf8");

    // See the sibling test above for why this starts in custom mode.
    const { plugin } = await renderSettingsTab({
      outputFolderVisibility: "custom",
      outputFolder: HIDDEN_OUTPUT_FOLDER,
    });

    const pathSetting = createdSettings.find((setting) => setting.name === "Output folder path");
    const inputEl = pathSetting?.textComponents[0]?.inputEl;
    if (inputEl) {
      inputEl.value = "Reports/GotSaeng";
    }
    inputEl?.dispatch("blur");

    const modal = await waitForConfirmModal();
    clickModalButton(modal, "Cancel");
    await vi.waitFor(() => {
      if (inputEl?.value !== HIDDEN_OUTPUT_FOLDER) {
        throw new Error("expected the input to revert to the persisted folder");
      }
    });

    expect(plugin.settings.outputFolder).toBe(HIDDEN_OUTPUT_FOLDER);
    const staleDirEntries = await fs.readdir(staleDir).catch(() => []);
    expect(staleDirEntries).toContain("REPORT_HUB.md");
  });

  it("flags an invalid stale-days input on blur instead of re-rendering the whole tab per keystroke", async () => {
    const { plugin } = await renderSettingsTab();

    const staleDaysSetting = createdSettings.find((setting) => setting.name === "Stale days");
    const inputEl = staleDaysSetting?.textComponents[0]?.inputEl;

    // Simulate the user typing an invalid intermediate value directly into
    // the input (like the custom-path field's equivalent test), then
    // blurring away without it ever going through onChange/setValue.
    if (inputEl) {
      inputEl.value = "not-a-number";
    }
    inputEl?.dispatch("blur");

    expect(plugin.settings.staleDays).toBe(DEFAULT_SETTINGS.staleDays);
    expect(inputEl?.value).toBe(String(DEFAULT_SETTINGS.staleDays));
    expect(recordedNotices.some((notice) => notice.message.includes("Stale days must be"))).toBe(
      true,
    );
  });

  it("updates the stale-days setting live as the user types a valid value", async () => {
    const { plugin } = await renderSettingsTab();

    const staleDaysSetting = createdSettings.find((setting) => setting.name === "Stale days");
    await staleDaysSetting?.textComponents[0]?.emitChange("30");

    expect(plugin.settings.staleDays).toBe(30);
    expect(recordedNotices.some((notice) => notice.message.includes("Stale days must be"))).toBe(
      false,
    );
  });

  it("toggles strict validation and open-after-compile settings", async () => {
    const { plugin } = await renderSettingsTab();

    const strictSetting = createdSettings.find((setting) => setting.name === "Strict validation");
    await strictSetting?.toggleComponents[0]?.emitChange(true);
    expect(plugin.settings.strictValidation).toBe(true);

    const openSetting = createdSettings.find((setting) => setting.name === "Open generated file");
    await openSetting?.toggleComponents[0]?.emitChange(false);
    expect(plugin.settings.openAfterCompile).toBe(false);
  });

  it("shows a rejected stale-days input as an inline error tied to the field, not only a transient Notice (#1, #7)", async () => {
    const { settingTab } = await renderSettingsTab();

    const staleDaysSetting = createdSettings.find((setting) => setting.name === "Stale days");
    const inputEl = staleDaysSetting?.textComponents[0]?.inputEl;
    // Created empty on mount, before anything is put in it, or the
    // announcement never fires.
    const errorBefore = staleDaysSetting?.settingEl.findByClass("gotsaeng-os-setting-error");
    expect(errorBefore?.text).toBeUndefined();
    expect(inputEl?.getAttr("aria-invalid")).toBe("false");

    if (inputEl) {
      inputEl.value = "not-a-number";
    }
    inputEl?.dispatch("blur");

    const error = staleDaysSetting?.settingEl.findByClass("gotsaeng-os-setting-error");
    expect(error?.text).toContain("Stale days must be");
    expect(error?.getAttr("role")).toBe("alert");
    expect(error?.getAttr("aria-live")).toBe("assertive");
    expect(inputEl?.getAttr("aria-invalid")).toBe("true");
    expect(inputEl?.getAttr("aria-describedby")).toBe(error?.getAttr("id"));

    // A subsequent valid value clears it again, without a full re-render.
    await staleDaysSetting?.textComponents[0]?.emitChange("30");
    expect(
      staleDaysSetting?.settingEl.findByClass("gotsaeng-os-setting-error")?.text,
    ).toBeUndefined();
    expect(inputEl?.getAttr("aria-invalid")).toBe("false");
    expect(settingTab.containerEl.findByClass("gotsaeng-os-setting-warning")).toBeDefined();
  });

  it("restores focus to the visibility dropdown after picking Hidden or Visible, not only into custom mode (#6)", async () => {
    const { settingTab } = await renderSettingsTab({
      outputFolderVisibility: "hidden",
      outputFolder: HIDDEN_OUTPUT_FOLDER,
    });
    expect(settingTab.containerEl.findByClass("gotsaeng-os-setting-warning")).toBeDefined();

    const visibilitySetting = createdSettings
      .filter((setting) => setting.name === "Output folder visibility")
      .at(-1);
    expect(visibilitySetting?.dropdownComponents[0]?.selectEl.focusCount).toBe(0);

    // No stale files here, so the switch commits without a confirm modal and
    // the tab re-renders immediately.
    await visibilitySetting?.dropdownComponents[0]?.emitChange("visible");

    const rebuiltVisibilitySetting = createdSettings
      .filter((setting) => setting.name === "Output folder visibility")
      .at(-1);
    expect(rebuiltVisibilitySetting).not.toBe(visibilitySetting);
    expect(rebuiltVisibilitySetting?.dropdownComponents[0]?.selectEl.focusCount).toBe(1);
    expect(
      rebuiltVisibilitySetting?.dropdownComponents[0]?.selectEl.getAttr("data-focus-key"),
    ).toBe("setting:outputFolderVisibility");
    // Focus really landed on the rebuilt element, not merely `focus()` called
    // on something detached or disabled.
    expect(document.activeElement).toBe(rebuiltVisibilitySetting?.dropdownComponents[0]?.selectEl);
  });

  it("moves focus to the custom path field when the still-focused dropdown picks Custom path (#25)", async () => {
    const { settingTab } = await renderSettingsTab({
      outputFolderVisibility: "hidden",
      outputFolder: HIDDEN_OUTPUT_FOLDER,
    });

    const visibilitySetting = createdSettings
      .filter((setting) => setting.name === "Output folder visibility")
      .at(-1);
    const selectEl = visibilitySetting?.dropdownComponents[0]?.selectEl;
    // The real gesture: the dropdown the user just operated still has focus,
    // and it carries a focus key of its own. The rebuild that follows captures
    // the focused element first — so unless an explicit focus request outranks
    // that capture, the dropdown's key overwrites the request for the path
    // field and picking "Custom path" focuses nothing (issue #25).
    selectEl?.focus();
    expect(document.activeElement).toBe(selectEl);

    await visibilitySetting?.dropdownComponents[0]?.emitChange("custom");

    const pathInput = createdSettings
      .filter((setting) => setting.name === "Output folder path")
      .at(-1)?.textComponents[0]?.inputEl;
    expect(pathInput).toBeDefined();
    expect(pathInput?.disabled).toBe(false);
    expect(document.activeElement).toBe(pathInput);
    expect(document.activeElement?.getAttribute("data-focus-key")).toBe("setting:outputFolder");
    expect(settingTab.containerEl.contains(pathInput as unknown as Node)).toBe(true);
  });

  it("reports a persisted setting that normalization had to reset, which the banner could otherwise never show", async () => {
    // normalizeSettings coerces an invalid persisted value away before anything
    // ever inspects plugin.settings — safe (outputFolder is resolved against the
    // vault and swept for deletion), but it also meant the validation banner
    // could structurally never fire for real saved data. The issue is now
    // recorded at load time, from the raw persisted object.
    const { plugin, settingTab } = await renderSettingsTab({
      outputFolderVisibility: "custom",
      outputFolder: "../outside",
      staleDays: 0,
    });

    const warning = settingTab.containerEl.findByClass("gotsaeng-os-setting-warning");
    expect((warning?.findAllByTag("li") ?? []).map((el) => el.text)).toEqual([
      "Saved output folder path was reset to the default. Output folder cannot include '..' path segments.",
      `Saved stale days value was reset to ${DEFAULT_SETTINGS.staleDays}. Stale days must be a positive whole number.`,
    ]);

    // The dangerous value itself is still gone — only the report survives.
    expect(plugin.settings.outputFolder).toBe(HIDDEN_OUTPUT_FOLDER);
    expect(plugin.settings.staleDays).toBe(DEFAULT_SETTINGS.staleDays);

    // Once the normalized object is written back, there is nothing left to
    // report and the banner clears.
    await plugin.saveSettings();
    createdSettings.length = 0;
    settingTab.display();
    expect(
      settingTab.containerEl.findByClass("gotsaeng-os-setting-warning")?.children,
    ).toHaveLength(0);
  });

  it("renders a validation warning banner when settings are invalid", async () => {
    // `normalizeSettings()` (src/settings.ts) always sanitizes a persisted
    // custom folder back to the default the moment it's loaded, so this
    // state can't arise through `loadSettings()` — the warning banner is a
    // defensive display()-time check. Reach it the only way it can occur:
    // an in-memory `settings` object that was set outside the normal
    // load/save path (e.g. a bug elsewhere mutating it directly).
    const { settingTab, plugin } = await renderSettingsTab();
    plugin.settings = {
      ...plugin.settings,
      outputFolderVisibility: "custom",
      outputFolder: "../outside",
    };
    createdSettings.length = 0;
    settingTab.display();

    const warning = settingTab.containerEl.findByClass("gotsaeng-os-setting-warning");
    expect(warning).toBeDefined();
    const items = warning?.findAllByTag("li") ?? [];
    expect(items.map((el) => el.text)).toEqual([
      "Output folder cannot include '..' path segments.",
    ]);
  });

  it("does not persist custom visibility until a custom path actually commits, and reverts cleanly on decline (#26)", async () => {
    const staleDir = path.join(tempRoot, HIDDEN_OUTPUT_FOLDER);
    await fs.mkdir(staleDir, { recursive: true });
    await fs.writeFile(path.join(staleDir, "REPORT_HUB.md"), "stale", "utf8");

    const { plugin } = await renderSettingsTab({
      outputFolderVisibility: "hidden",
      outputFolder: HIDDEN_OUTPUT_FOLDER,
    });

    const visibilitySetting = createdSettings.find(
      (setting) => setting.name === "Output folder visibility",
    );
    await visibilitySetting?.dropdownComponents[0]?.emitChange("custom");

    // Selecting "Custom path" alone must not write settings or open a modal
    // — only unlocking the field, so a decline further down has nothing
    // committed to revert.
    expect(plugin.settings.outputFolderVisibility).toBe("hidden");
    expect(createdModals).toHaveLength(0);

    const pathSetting = createdSettings
      .filter((setting) => setting.name === "Output folder path")
      .at(-1);
    const inputEl = pathSetting?.textComponents[0]?.inputEl;
    expect(inputEl?.disabled).toBe(false);
    if (inputEl) {
      inputEl.value = "Reports/GotSaeng";
    }
    inputEl?.dispatch("blur");

    const modal = await waitForConfirmModal();
    clickModalButton(modal, "Cancel");
    await vi.waitFor(() => {
      if (inputEl?.value !== HIDDEN_OUTPUT_FOLDER) {
        throw new Error("expected the input to revert to the persisted folder");
      }
    });

    expect(plugin.settings.outputFolderVisibility).toBe("hidden");
    expect(plugin.settings.outputFolder).toBe(HIDDEN_OUTPUT_FOLDER);
    const staleDirEntries = await fs.readdir(staleDir).catch(() => []);
    expect(staleDirEntries).toContain("REPORT_HUB.md");

    // The dropdown itself must reflect the revert, not linger on "Custom path".
    const finalVisibilitySetting = createdSettings
      .filter((setting) => setting.name === "Output folder visibility")
      .at(-1);
    expect(finalVisibilitySetting?.dropdownComponents[0]?.getValue()).toBe("hidden");
  });

  it("does not commit or open a modal on a no-op blur when the custom path field is unchanged (#22)", async () => {
    const { plugin } = await renderSettingsTab({
      outputFolderVisibility: "custom",
      outputFolder: "Reports/GotSaeng",
    });
    const savedDataBefore = asTestable(plugin).savedData;

    const pathSetting = createdSettings.find((setting) => setting.name === "Output folder path");
    const inputEl = pathSetting?.textComponents[0]?.inputEl;
    expect(inputEl?.value).toBe("Reports/GotSaeng");
    inputEl?.dispatch("blur");

    expect(createdModals).toHaveLength(0);
    expect(plugin.settings.outputFolder).toBe("Reports/GotSaeng");
    expect(asTestable(plugin).savedData).toBe(savedDataBefore);
  });

  it("serializes a blur commit and a dropdown change instead of racing, and never opens two modals at once (#22)", async () => {
    const customDir = path.join(tempRoot, "Reports/GotSaeng");
    await fs.mkdir(customDir, { recursive: true });
    await fs.writeFile(
      path.join(customDir, "COMPILE_REPORT.json"),
      JSON.stringify({
        filesScanned: 0,
        markdownFilesParsed: 0,
        filesSkipped: 0,
        parseErrors: [],
        warnings: [],
        generatedFiles: [],
      }),
      "utf8",
    );
    await fs.writeFile(path.join(customDir, "REPORT_HUB.md"), "stale", "utf8");

    const { plugin } = await renderSettingsTab({
      outputFolderVisibility: "custom",
      outputFolder: "Reports/GotSaeng",
    });

    const pathSetting = createdSettings.find((setting) => setting.name === "Output folder path");
    const inputEl = pathSetting?.textComponents[0]?.inputEl;
    if (inputEl) {
      inputEl.value = "Reports/Other";
    }
    // Starts the blur commit; it is still queued behind pendingFolderChange
    // and has not reached applyOutputFolderChangeNow yet.
    inputEl?.dispatch("blur");

    const visibilitySetting = createdSettings.find(
      (setting) => setting.name === "Output folder visibility",
    );
    // Fire the dropdown change immediately, before the blur commit has had a
    // chance to run — the exact race from issue #22. Don't await directly:
    // emitChange awaits the onChange handler itself, and that handler is now
    // queued behind the blur commit's pendingFolderChange.
    const dropdownChangePromise = visibilitySetting?.dropdownComponents[0]?.emitChange("hidden");

    const modal = await waitForConfirmModal();
    expect(createdModals).toHaveLength(1);
    // The blur commit's own call was superseded (its target was "Reports/
    // Other") and skipped outright rather than running first: the one modal
    // that does open is for the dropdown's actual target, proving the two
    // queued calls were coalesced into one user-facing prompt instead of two
    // sequential ones.
    expect(modal.titleEl.text).toBe(`Move generated output to ${HIDDEN_OUTPUT_FOLDER}?`);
    clickModalButton(modal, "Delete and switch");

    await dropdownChangePromise;

    // The dropdown's queued call never opened a second, concurrent modal.
    expect(createdModals).toHaveLength(1);
    expect(plugin.settings.outputFolderVisibility).toBe("hidden");
    expect(plugin.settings.outputFolder).toBe(HIDDEN_OUTPUT_FOLDER);
    // The superseded blur commit never wrote its own intermediate target.
    expect(recordedNotices.some((notice) => notice.message.includes("Reports/Other"))).toBe(false);
  });

  it("only focuses the custom path field on the transition into custom mode, not on every re-render (#25)", async () => {
    const { plugin, settingTab } = await renderSettingsTab({
      outputFolderVisibility: "custom",
      outputFolder: "Reports/GotSaeng",
    });

    const initialPathSetting = createdSettings
      .filter((setting) => setting.name === "Output folder path")
      .at(-1);
    expect(initialPathSetting?.textComponents[0]?.inputEl.focusCount).toBe(0);

    // Re-rendering the tab (e.g. reopening Settings) while already in custom
    // mode must not (re-)focus the field.
    settingTab.display();
    const reopenedPathSetting = createdSettings
      .filter((setting) => setting.name === "Output folder path")
      .at(-1);
    expect(reopenedPathSetting?.textComponents[0]?.inputEl.focusCount).toBe(0);

    // A genuine transition into custom mode (from hidden, no stale files so
    // no confirm modal) focuses the field exactly once.
    await plugin.switchOutputFolderVisibility("hidden");
    settingTab.display();
    const visibilitySetting = createdSettings
      .filter((setting) => setting.name === "Output folder visibility")
      .at(-1);
    await visibilitySetting?.dropdownComponents[0]?.emitChange("custom");

    const transitionedPathSetting = createdSettings
      .filter((setting) => setting.name === "Output folder path")
      .at(-1);
    expect(transitionedPathSetting?.textComponents[0]?.inputEl.focusCount).toBe(1);
    expect(document.activeElement).toBe(transitionedPathSetting?.textComponents[0]?.inputEl);
  });

  it("re-renders the settings tab automatically after a successful custom-path commit, without requiring the tab to be reopened (#25)", async () => {
    const { plugin } = await renderSettingsTab({
      outputFolderVisibility: "hidden",
      outputFolder: HIDDEN_OUTPUT_FOLDER,
    });

    const visibilitySetting = createdSettings.find(
      (setting) => setting.name === "Output folder visibility",
    );
    await visibilitySetting?.dropdownComponents[0]?.emitChange("custom");

    const pathSetting = createdSettings
      .filter((setting) => setting.name === "Output folder path")
      .at(-1);
    const inputEl = pathSetting?.textComponents[0]?.inputEl;
    if (inputEl) {
      inputEl.value = "Reports/GotSaeng";
    }

    const settingsCountBeforeCommit = createdSettings.length;
    inputEl?.dispatch("blur");

    await vi.waitFor(() => {
      if (plugin.settings.outputFolder !== "Reports/GotSaeng") {
        throw new Error("expected the custom output folder to be committed");
      }
    });

    // A fresh display() ran on its own once the commit settled — this test
    // never called settingTab.display() itself for that to happen, so the
    // validation banner (and everything else display() renders) reflects the
    // committed state without the tab needing to be reopened.
    expect(createdSettings.length).toBeGreaterThan(settingsCountBeforeCommit);
    const latestPathSetting = createdSettings
      .filter((setting) => setting.name === "Output folder path")
      .at(-1);
    expect(latestPathSetting?.textComponents[0]?.inputEl.value).toBe("Reports/GotSaeng");
  });

  // Returns the dispatched event so a caller can ask whether the handler
  // swallowed it (see the read-only Enter test).
  function pressEnter(inputEl: FakeElement): KeyboardEvent {
    const event = new KeyboardEvent("keydown", { key: "Enter", cancelable: true });
    inputEl.dispatchEvent(event);
    return event;
  }

  it("commits the custom output folder on Enter, not only on blur", async () => {
    const { plugin } = await renderSettingsTab({
      outputFolderVisibility: "custom",
      outputFolder: "Reports/GotSaeng",
    });

    const pathSetting = createdSettings.find((setting) => setting.name === "Output folder path");
    const inputEl = pathSetting?.textComponents[0]?.inputEl;
    if (inputEl) {
      inputEl.value = "Reports/Other";
    }

    // Pressing Enter in a text field is what a user expects to commit it, and
    // this field had no keydown handler at all — typing a path and hitting
    // Enter did nothing, with nothing on screen saying why.
    pressEnter(inputEl!);

    await vi.waitFor(() => {
      if (plugin.settings.outputFolder !== "Reports/Other") {
        throw new Error("expected Enter to commit the custom output folder");
      }
    });
    expect(plugin.settings.outputFolderVisibility).toBe("custom");
  });

  // The blur that follows an Enter commit is not the polite one that arrives
  // after everything has settled: opening the confirm modal (or mousing down
  // on one of its buttons) takes focus off the still-focused input while the
  // FIRST commit is mid-flight. These two tests dispatch the blur in exactly
  // that window — before the modal is answered — because that is the ordering
  // that actually happens, and the one the value-comparison no-op guard cannot
  // see: settings have not been written yet, so the field and the settings
  // still disagree.
  async function startEnterCommitWithStaleFiles(): Promise<{
    plugin: GotSaengObsidianPlugin;
    inputEl: FakeElement;
    staleDir: string;
  }> {
    const staleDir = path.join(tempRoot, "Reports/GotSaeng");
    await fs.mkdir(staleDir, { recursive: true });
    // A custom folder is only swept when it carries the compiler's own
    // ownership marker (see resolveSweepableOutputFolders), and only a folder
    // that would be swept produces the confirm dialog this test is about.
    await fs.writeFile(
      path.join(staleDir, "COMPILE_REPORT.json"),
      JSON.stringify({
        filesScanned: 0,
        markdownFilesParsed: 0,
        filesSkipped: 0,
        parseErrors: [],
        warnings: [],
        generatedFiles: [],
      }),
      "utf8",
    );
    await fs.writeFile(path.join(staleDir, "REPORT_HUB.md"), "stale", "utf8");

    const { plugin } = await renderSettingsTab({
      outputFolderVisibility: "custom",
      outputFolder: "Reports/GotSaeng",
    });

    const pathSetting = createdSettings.find((setting) => setting.name === "Output folder path");
    const inputEl = pathSetting?.textComponents[0]?.inputEl;
    if (!inputEl) {
      throw new Error("expected the output folder path field to render a text input");
    }

    inputEl.value = "Reports/Other";
    pressEnter(inputEl);
    return { plugin, inputEl, staleDir };
  }

  // Long enough for a second, wrongly-queued applyOutputFolderChange to have
  // finished its dry-run file count and opened its own modal — the failure
  // this asserts the absence of is asynchronous, so "no second modal yet" has
  // to mean "no second modal after it would have had time to appear".
  async function settleQueuedFolderChanges(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  // NOTE: this is not the test that discriminates the `commitInFlight` guard.
  // Remove the guard and it still passes: by the time the wrongly-queued second
  // commit runs, the first one has already written the new folder, so the
  // second stops at the value-comparison no-op and never opens a dialog. The
  // decline-path test immediately below is the one that fails without the
  // guard — do not delete it believing this one covers the same thing.
  it("opens only one confirm dialog when the modal's own focus steal blurs the Enter-committed field", async () => {
    const { plugin, inputEl } = await startEnterCommitWithStaleFiles();

    const modal = await waitForConfirmModal();
    expect(createdModals).toHaveLength(1);

    // The blur the modal itself caused, while the first commit is still
    // waiting for an answer.
    inputEl.dispatch("blur");
    await Promise.resolve();

    clickModalButton(modal, "Delete and switch");
    await vi.waitFor(() => {
      if (plugin.settings.outputFolder !== "Reports/Other") {
        throw new Error("expected Enter to commit the custom output folder");
      }
    });
    await settleQueuedFolderChanges();

    expect(createdModals).toHaveLength(1);
    expect(
      recordedNotices.filter((notice) => notice.message.includes("output folder switched to")),
    ).toHaveLength(1);
    expect(plugin.settings.outputFolderVisibility).toBe("custom");
  });

  it("keeps a declined switch declined: the mid-modal blur cannot queue a second dialog that deletes the files anyway", async () => {
    const { plugin, inputEl, staleDir } = await startEnterCommitWithStaleFiles();

    const modal = await waitForConfirmModal();
    inputEl.dispatch("blur");
    await Promise.resolve();

    clickModalButton(modal, "Cancel");
    await vi.waitFor(() => {
      if (!recordedNotices.some((notice) => notice.message.includes("switch cancelled"))) {
        throw new Error("expected the declined switch to be announced");
      }
    });
    await settleQueuedFolderChanges();

    // A second dialog here is the whole bug: the user has already said no, and
    // "Delete and switch" on a dialog they never asked for would delete the
    // very files declining the first one protected.
    expect(createdModals).toHaveLength(1);
    expect(plugin.settings.outputFolder).toBe("Reports/GotSaeng");
    expect(await fs.readdir(staleDir)).toContain("REPORT_HUB.md");
    expect(
      recordedNotices.some((notice) => notice.message.includes("output folder switched to")),
    ).toBe(false);
  });

  function latestPathInput(): FakeElement | undefined {
    return createdSettings.filter((setting) => setting.name === "Output folder path").at(-1)
      ?.textComponents[0]?.inputEl;
  }

  // Defensive, not a confirmed bug: the confirm modal's focus handling is
  // Obsidian's own and nothing in this codebase tracks it, so after the modal
  // closes and the tab rebuilds, focus could be left on <body>. The commit now
  // asks FocusRestorer for the path field explicitly, which is a no-op if
  // Obsidian already restored it and a fix if it did not.
  it.each([
    ["accepted", "Delete and switch"],
    ["declined", "Cancel"],
  ])(
    "returns focus to the rebuilt path field after a %s confirm modal closes",
    async (_outcome, buttonText) => {
      const { inputEl } = await startEnterCommitWithStaleFiles();
      expect(inputEl).toBe(latestPathInput());

      const modal = await waitForConfirmModal();
      // The modal has taken focus off the field, which is what makes the
      // rebuild that follows land on nothing in particular.
      expect(document.activeElement).not.toBe(inputEl);

      clickModalButton(modal, buttonText);
      await vi.waitFor(() => {
        if (latestPathInput() === inputEl) {
          throw new Error("expected the settings tab to rebuild after the modal closed");
        }
      });

      // Both answers end the same user gesture, so both put the user back where
      // they were typing.
      expect(document.activeElement).toBe(latestPathInput());
      expect(document.activeElement?.getAttribute("data-focus-key")).toBe("setting:outputFolder");
    },
  );

  it("still commits normally when the blur arrives after the commit has fully settled", async () => {
    const { plugin } = await renderSettingsTab({
      outputFolderVisibility: "custom",
      outputFolder: "Reports/GotSaeng",
    });

    const pathSetting = createdSettings.find((setting) => setting.name === "Output folder path");
    const inputEl = pathSetting?.textComponents[0]?.inputEl;
    if (inputEl) {
      inputEl.value = "Reports/Other";
    }

    pressEnter(inputEl!);
    await vi.waitFor(() => {
      if (plugin.settings.outputFolder !== "Reports/Other") {
        throw new Error("expected Enter to commit the custom output folder");
      }
    });

    // The in-flight flag is cleared by now, so what stops this blur from
    // committing again is the value comparison: field and settings agree.
    inputEl?.dispatch("blur");
    await settleQueuedFolderChanges();

    expect(
      recordedNotices.filter((notice) => notice.message.includes("output folder switched to")),
    ).toHaveLength(1);
  });

  it("keeps the path field readable and focusable outside custom mode instead of disabling it", async () => {
    const { plugin } = await renderSettingsTab({
      outputFolderVisibility: "hidden",
      outputFolder: HIDDEN_OUTPUT_FOLDER,
    });

    const pathSetting = createdSettings.find((setting) => setting.name === "Output folder path");
    const inputEl = pathSetting?.textComponents[0]?.inputEl;

    // Outside custom mode this field's only job is to show which folder is in
    // use. `disabled` took it out of the tab order and made its text
    // unselectable, so the one thing it was there for was unreachable by
    // keyboard; `readonly` keeps it focusable and copyable.
    expect(inputEl?.disabled).toBe(false);
    expect((inputEl as unknown as HTMLInputElement | undefined)?.readOnly).toBe(true);
    expect(inputEl?.getAttr("aria-readonly")).toBe("true");
    inputEl?.focus();
    expect(document.activeElement).toBe(inputEl);

    // What actually prevents an edit is now the visibility check in the commit
    // path, not the browser refusing input.
    if (inputEl) {
      inputEl.value = "Reports/Sneaky";
    }
    pressEnter(inputEl!);
    inputEl?.dispatch("blur");
    await Promise.resolve();

    expect(plugin.settings.outputFolder).toBe(HIDDEN_OUTPUT_FOLDER);
    expect(createdModals).toHaveLength(0);
  });

  it("leaves Enter alone on the read-only field instead of swallowing it for a commit that cannot happen", async () => {
    await renderSettingsTab({
      outputFolderVisibility: "hidden",
      outputFolder: HIDDEN_OUTPUT_FOLDER,
    });

    const inputEl = createdSettings.find((setting) => setting.name === "Output folder path")
      ?.textComponents[0]?.inputEl;

    // The field is focusable outside custom mode (see the test above), so a
    // keyboard user reaches it just by tabbing through the form. Nothing is
    // committed from here, so preventDefault would only take Enter away from
    // Obsidian's own settings-modal handling of it for no reason.
    expect(pressEnter(inputEl!).defaultPrevented).toBe(false);
  });

  it("still swallows Enter in custom mode, where it does commit", async () => {
    await renderSettingsTab({
      outputFolderVisibility: "custom",
      outputFolder: "Reports/GotSaeng",
    });

    const inputEl = createdSettings.find((setting) => setting.name === "Output folder path")
      ?.textComponents[0]?.inputEl;

    // Here Enter opens a confirm-gated folder change, and letting it bubble
    // would dismiss the settings tab out from under that dialog.
    expect(pressEnter(inputEl!).defaultPrevented).toBe(true);
  });

  it("says when the typed path applies and that applying it deletes files", async () => {
    await renderSettingsTab({
      outputFolderVisibility: "custom",
      outputFolder: "Reports/GotSaeng",
    });

    const desc = createdSettings.find((setting) => setting.name === "Output folder path")?.desc;
    expect(desc).toContain("press Enter or leave the field");
    expect(desc).toContain("deletes GotSaeng-generated files from the folder you are leaving");
  });

  it("says the field is read-only, and why, outside custom mode", async () => {
    await renderSettingsTab({
      outputFolderVisibility: "hidden",
      outputFolder: HIDDEN_OUTPUT_FOLDER,
    });

    expect(
      createdSettings.find((setting) => setting.name === "Output folder path")?.desc,
    ).toContain("Read-only unless visibility is Custom path");
  });
});

// Coverage for the declarative settings API (Obsidian >=1.13.0): the object
// getSettingDefinitions() returns, and getControlValue/setControlValue,
// which real Obsidian calls instead of display() on those hosts (see
// GotSaengSettingTab's class-level comment in src/main.ts). display() itself
// stays covered by the describe block above, which is the fallback path for
// hosts older than 1.13.0.
// The mock PluginSettingTab (./mocks/obsidian) intentionally only declares
// display()/hide()/containerEl — the surface main.ts's imperative fallback
// path needs. GotSaengSettingTab's real, ambient-obsidian-typed
// getSettingDefinitions/getControlValue/setControlValue exist on the actual
// runtime instance regardless (it's the same object), just not on that
// narrower mock type, so tests exercising them need this wider view.
type DeclarativeSettingTab = InstanceType<typeof PluginSettingTab> & {
  // GotSaengSettingTab returns a mix of bare settings (the status row, project
  // name) and `type: "group"` wrappers carrying a heading plus their own
  // settings — never a list or a page — so this narrows the ambient
  // SettingDefinitionItem[] return type to just those two shapes.
  getSettingDefinitions(): (SettingDefinition | SettingDefinitionGroup)[];
  getControlValue(key: string): unknown;
  setControlValue(key: string, value: unknown): Promise<void>;
};

/** The settings themselves, with the group wrappers flattened away — what the
 * assertions about individual definitions are actually about. Group membership
 * and heading text are asserted separately, by the test below that owns them. */
function settingDefinitionsOf(settingTab: DeclarativeSettingTab): SettingDefinition[] {
  return settingTab
    .getSettingDefinitions()
    .flatMap((item) => ("type" in item ? ((item.items ?? []) as SettingDefinition[]) : [item]));
}

function controlTypeOf(def: SettingDefinition | undefined): string | undefined {
  return def && "control" in def && def.control ? def.control.type : undefined;
}

describe("GotSaengObsidianPlugin declarative settings (getSettingDefinitions)", () => {
  async function createSettingTab(persistedSettings: Partial<GotSaengPluginSettings> = {}) {
    const fakeApp = createFakeApp(tempRoot);
    const plugin = new GotSaengObsidianPlugin(fakeApp as unknown as App, FAKE_MANIFEST);
    const testablePlugin = asTestable(plugin);
    testablePlugin.savedData = persistedSettings;
    await plugin.onload();
    const settingTab = testablePlugin.settingTab;
    if (!(settingTab instanceof PluginSettingTab)) {
      throw new Error("expected onload() to register a settings tab");
    }
    return { plugin, settingTab: settingTab as unknown as DeclarativeSettingTab };
  }

  it("groups the six settings under the same headings display() renders", async () => {
    const { settingTab } = await createSettingTab();

    // Six ungrouped rows spanning identity, output location and compile
    // behavior read as one undifferentiated list. The status row and the
    // project name stay above the first heading — the project name belongs to
    // no section below it.
    expect(
      settingTab.getSettingDefinitions().map((item) => {
        if ("type" in item) {
          return { heading: item.heading, items: (item.items ?? []).map((def) => def.name) };
        }
        return item.name;
      }),
    ).toEqual([
      "",
      "Project name",
      {
        heading: "Output location",
        items: ["Output folder visibility", "Output folder path"],
      },
      {
        heading: "Compile behavior",
        items: ["Stale days", "Strict validation", "Open generated file"],
      },
    ]);

    // The imperative fallback renders the same two headings, in the same
    // order, from the same constant — the drift SETTING_COPY exists to
    // prevent applies to section headings too.
    createdSettings.length = 0;
    settingTab.display();
    expect(
      createdSettings.filter((setting) => setting.isHeading).map((setting) => setting.name),
    ).toEqual(["Output location", "Compile behavior"]);
  });

  it("declares all six settings, matching display()'s names and order", async () => {
    const { settingTab } = await createSettingTab();

    const defs = settingDefinitionsOf(settingTab);

    expect(defs.map((def) => def.name)).toEqual([
      // The nameless status row carrying the privacy note and the aggregate
      // validation alert — display() is never called on a host that has
      // getSettingDefinitions(), so both have to render here too.
      "",
      "Project name",
      "Output folder visibility",
      "Output folder path",
      "Stale days",
      "Strict validation",
      "Open generated file",
    ]);
    // The two settings a plain `control` type can't express (see the
    // class-level comment on getSettingDefinitions() in src/main.ts) fall
    // back to the `render` escape hatch; the rest are native controls.
    const byName = Object.fromEntries(defs.map((def) => [def.name, def]));
    expect("control" in byName["Output folder visibility"]!).toBe(false);
    expect("control" in byName["Output folder path"]!).toBe(false);
    expect(controlTypeOf(byName["Project name"])).toBe("text");
    expect(controlTypeOf(byName["Stale days"])).toBe("number");
  });

  it("round-trips the four control-type settings through getControlValue/setControlValue", async () => {
    const { plugin, settingTab } = await createSettingTab();

    expect(settingTab.getControlValue("projectName")).toBe(DEFAULT_SETTINGS.projectName);
    await settingTab.setControlValue("projectName", "My Vault");
    expect(plugin.settings.projectName).toBe("My Vault");
    expect(settingTab.getControlValue("projectName")).toBe("My Vault");
    // Typed text is persisted on a debounce rather than per keystroke, so this
    // one only reaches disk once something flushes it (blur, tab close,
    // unload, or the timer).
    expect(asTestable(plugin).savedData).toEqual({});
    await plugin.flushPendingSettingsWrite();
    expect(asTestable(plugin).savedData).toMatchObject({ projectName: "My Vault" });

    await settingTab.setControlValue("staleDays", 30);
    expect(plugin.settings.staleDays).toBe(30);
    expect(settingTab.getControlValue("staleDays")).toBe(30);

    await settingTab.setControlValue("strictValidation", true);
    expect(plugin.settings.strictValidation).toBe(true);
    expect(settingTab.getControlValue("strictValidation")).toBe(true);

    await settingTab.setControlValue("openAfterCompile", false);
    expect(plugin.settings.openAfterCompile).toBe(false);
    expect(settingTab.getControlValue("openAfterCompile")).toBe(false);
  });

  it("rejects an invalid stale-days value via validate() without persisting", async () => {
    const { plugin, settingTab } = await createSettingTab();
    const defs = settingDefinitionsOf(settingTab);
    const staleDaysDef = defs.find((def) => def.name === "Stale days");
    const control = staleDaysDef && "control" in staleDaysDef ? staleDaysDef.control : undefined;
    if (!control || control.type !== "number") {
      throw new Error("expected Stale days to declare a number control");
    }

    expect(await control.validate?.(0)).toMatch(/positive whole number/);
    expect(await control.validate?.(30)).toBeUndefined();

    // validate() rejecting is the framework's cue not to call setControlValue
    // at all — confirm this class's own setControlValue is equally a no-op
    // for the same input, so nothing here depends on the framework enforcing
    // the rejection on its own.
    await settingTab.setControlValue("staleDays", 0);
    expect(plugin.settings.staleDays).toBe(DEFAULT_SETTINGS.staleDays);
  });

  it("throws for an unrecognized control key", async () => {
    const { settingTab } = await createSettingTab();

    await expect(settingTab.setControlValue("notARealKey", "x")).rejects.toThrow(
      "Unknown setting key",
    );
  });

  it("renders the privacy note and the validation alert on the declarative path, not only in display() (#1)", async () => {
    const { plugin, settingTab } = await createSettingTab();
    // Same unreachable-through-loadSettings state the display() banner test
    // uses: an in-memory settings object that bypassed normalizeSettings.
    plugin.settings = {
      ...plugin.settings,
      outputFolderVisibility: "custom",
      outputFolder: "../outside",
    };

    const statusDef = settingTab.getSettingDefinitions()[0];
    if (!statusDef || !("render" in statusDef) || !statusDef.render) {
      throw new Error("expected a leading status row with a render() definition");
    }

    createdSettings.length = 0;
    const setting = new Setting(settingTab.containerEl);
    statusDef.render(setting as never, {} as never);

    const note = setting.settingEl.children.find((el) =>
      el.text?.includes("Does not call AI services or sync data"),
    );
    expect(note).toBeDefined();
    // De-versioned: the sentence used to name "v0.10" and went stale on the
    // next release.
    expect(note?.text).not.toContain("v0.10");

    const warning = setting.settingEl.findByClass("gotsaeng-os-setting-warning");
    expect(warning?.getAttr("role")).toBe("alert");
    expect(warning?.getAttr("aria-live")).toBe("assertive");
    expect((warning?.findAllByTag("li") ?? []).map((el) => el.text)).toEqual([
      "Output folder cannot include '..' path segments.",
    ]);
  });

  it("surfaces the same stale-days rejection message the imperative path shows inline (#7)", async () => {
    const { settingTab } = await createSettingTab();
    const staleDaysDef = settingDefinitionsOf(settingTab).find((def) => def.name === "Stale days");
    const control = staleDaysDef && "control" in staleDaysDef ? staleDaysDef.control : undefined;
    if (!control || control.type !== "number") {
      throw new Error("expected Stale days to declare a number control");
    }

    expect(await control.validate?.(0)).toBe(validateStaleDaysInput("0")[0]);
  });

  it("rejects a value whose type does not match the key it is being written to (#8)", async () => {
    const { plugin, settingTab } = await createSettingTab();

    await expect(settingTab.setControlValue("projectName", 42)).rejects.toThrow(
      "Expected a string value",
    );
    await expect(settingTab.setControlValue("staleDays", "30")).rejects.toThrow(
      "Expected a number value",
    );
    await expect(settingTab.setControlValue("strictValidation", "yes")).rejects.toThrow(
      "Expected a boolean value",
    );
    expect(plugin.settings.projectName).toBe(DEFAULT_SETTINGS.projectName);
    expect(plugin.settings.staleDays).toBe(DEFAULT_SETTINGS.staleDays);
    expect(plugin.settings.strictValidation).toBe(DEFAULT_SETTINGS.strictValidation);
  });

  it("throws for an unrecognized control key on read as well as on write (#8)", async () => {
    const { settingTab } = await createSettingTab();

    expect(() => settingTab.getControlValue("notARealKey")).toThrow("Unknown setting key");
  });

  it("the output-folder-visibility render() shares the confirm-gated switch with display()", async () => {
    const staleDir = path.join(tempRoot, HIDDEN_OUTPUT_FOLDER);
    await fs.mkdir(staleDir, { recursive: true });
    await fs.writeFile(path.join(staleDir, "REPORT_HUB.md"), "stale", "utf8");

    const { plugin, settingTab } = await createSettingTab({
      outputFolderVisibility: "hidden",
      outputFolder: HIDDEN_OUTPUT_FOLDER,
    });
    const defs = settingDefinitionsOf(settingTab);
    const visibilityDef = defs.find((def) => def.name === "Output folder visibility");
    if (!visibilityDef || !("render" in visibilityDef) || !visibilityDef.render) {
      throw new Error("expected Output folder visibility to declare a render() definition");
    }

    // Simulates what the real host does with a `render`-type definition:
    // hand it a freshly constructed Setting and let it build the row.
    createdSettings.length = 0;
    visibilityDef.render(new Setting(settingTab.containerEl) as never, {} as never);
    const visibilitySetting = createdSettings.find(
      (setting) => setting.name === "Output folder visibility",
    );

    const changePromise = visibilitySetting?.dropdownComponents[0]?.emitChange("visible");
    await vi.waitFor(() => {
      if (createdModals.length === 0) {
        throw new Error("expected a confirmation modal to open");
      }
    });
    const modal = createdModals[0]!;
    const cancelButton = modal.contentEl.findAllByTag("button").find((el) => el.text === "Cancel");
    cancelButton?.dispatch("click");
    await changePromise;

    expect(plugin.settings.outputFolderVisibility).toBe("hidden");
    const staleDirEntries = await fs.readdir(staleDir).catch(() => []);
    expect(staleDirEntries).toContain("REPORT_HUB.md");
  });

  it("the output-folder-path render() shares the blur-commit logic with display()", async () => {
    const { plugin, settingTab } = await createSettingTab({
      outputFolderVisibility: "custom",
      outputFolder: "Reports/GotSaeng",
    });
    const defs = settingDefinitionsOf(settingTab);
    const pathDef = defs.find((def) => def.name === "Output folder path");
    if (!pathDef || !("render" in pathDef) || !pathDef.render) {
      throw new Error("expected Output folder path to declare a render() definition");
    }

    createdSettings.length = 0;
    pathDef.render(new Setting(settingTab.containerEl) as never, {} as never);
    const pathSetting = createdSettings.find((setting) => setting.name === "Output folder path");
    const inputEl = pathSetting?.textComponents[0]?.inputEl;
    expect(inputEl?.value).toBe("Reports/GotSaeng");

    if (inputEl) {
      inputEl.value = "/absolute/path";
    }
    inputEl?.dispatch("blur");

    expect(plugin.settings.outputFolder).toBe("Reports/GotSaeng");
    expect(
      recordedNotices.some((notice) =>
        notice.message.includes(
          "GotSaeng OS settings: Output folder must be vault-relative; absolute paths are not supported.",
        ),
      ),
    ).toBe(true);
  });
});
