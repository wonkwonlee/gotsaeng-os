import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { App, PluginManifest, SettingDefinition } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import GotSaengObsidianPlugin from "../src/main";
import { GOTSAENG_REPORT_VIEW_TYPE } from "../src/view";
import { REPORT_HUB_FILE } from "../src/reports";
import {
  DEFAULT_SETTINGS,
  HIDDEN_OUTPUT_FOLDER,
  VISIBLE_OUTPUT_FOLDER,
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

  it("updates the project name setting and persists it", async () => {
    const { plugin } = await renderSettingsTab();

    const projectNameSetting = createdSettings.find((setting) => setting.name === "Project name");
    expect(projectNameSetting).toBeDefined();

    await projectNameSetting?.textComponents[0]?.emitChange("My Vault");

    expect(plugin.settings.projectName).toBe("My Vault");
    expect(asTestable(plugin).savedData).toMatchObject({ projectName: "My Vault" });
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
  });

  it("asks for confirmation before committing a custom output folder that would delete files", async () => {
    const staleDir = path.join(tempRoot, HIDDEN_OUTPUT_FOLDER);
    await fs.mkdir(staleDir, { recursive: true });
    await fs.writeFile(path.join(staleDir, "REPORT_HUB.md"), "stale", "utf8");

    const { plugin } = await renderSettingsTab({
      outputFolderVisibility: "hidden",
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

    const { plugin } = await renderSettingsTab({
      outputFolderVisibility: "hidden",
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
  // GotSaengSettingTab only ever returns flat control/render definitions —
  // never a group/list/page — so this narrows the ambient
  // SettingDefinitionItem[] return type to just SettingDefinition[], which
  // is what every definition below actually is.
  getSettingDefinitions(): SettingDefinition[];
  getControlValue(key: string): unknown;
  setControlValue(key: string, value: unknown): Promise<void>;
};

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

  it("declares all six settings, matching display()'s names and order", async () => {
    const { settingTab } = await createSettingTab();

    const defs = settingTab.getSettingDefinitions();

    expect(defs.map((def) => def.name)).toEqual([
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
    const defs = settingTab.getSettingDefinitions();
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

  it("the output-folder-visibility render() shares the confirm-gated switch with display()", async () => {
    const staleDir = path.join(tempRoot, HIDDEN_OUTPUT_FOLDER);
    await fs.mkdir(staleDir, { recursive: true });
    await fs.writeFile(path.join(staleDir, "REPORT_HUB.md"), "stale", "utf8");

    const { plugin, settingTab } = await createSettingTab({
      outputFolderVisibility: "hidden",
      outputFolder: HIDDEN_OUTPUT_FOLDER,
    });
    const defs = settingTab.getSettingDefinitions();
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
    const defs = settingTab.getSettingDefinitions();
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
