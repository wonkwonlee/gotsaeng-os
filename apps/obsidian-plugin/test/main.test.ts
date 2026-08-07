import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { App, PluginManifest } from "obsidian";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
  TFile,
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

describe("GotSaengObsidianPlugin output folder visibility command", () => {
  it("switches from hidden to visible, persists settings, and cleans up the stale hidden folder", async () => {
    const staleDir = path.join(tempRoot, HIDDEN_OUTPUT_FOLDER);
    await fs.mkdir(staleDir, { recursive: true });
    await fs.writeFile(path.join(staleDir, "REPORT_HUB.md"), "stale", "utf8");

    const { plugin } = createPlugin(tempRoot, { ...DEFAULT_SETTINGS });

    await plugin.switchOutputFolderVisibilityCommand("visible");

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

  it("flags an invalid stale-days input instead of updating settings", async () => {
    const { plugin } = await renderSettingsTab();

    const staleDaysSetting = createdSettings.find((setting) => setting.name === "Stale days");
    await staleDaysSetting?.textComponents[0]?.emitChange("not-a-number");

    expect(plugin.settings.staleDays).toBe(DEFAULT_SETTINGS.staleDays);
    expect(recordedNotices.some((notice) => notice.message.includes("Stale days must be"))).toBe(
      true,
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
});
