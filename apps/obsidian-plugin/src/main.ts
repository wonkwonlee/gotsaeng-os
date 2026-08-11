import fs from "node:fs/promises";
import path from "node:path";

import {
  CompileReportSchema,
  compileContextPack,
  parseMarkdownFile,
  renderMarkdownFiles,
  scanMarkdownFiles,
  validateNoteMetadata,
  writeContextPack,
  type CompileReport,
  type ContextPack,
} from "@gotsaeng/core";
import { Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, type App } from "obsidian";

import { OUTPUT_ARTIFACTS } from "./artifacts";
import { cleanupStaleManagedOutputFolders, countStaleManagedOutputFiles } from "./output-cleanup";
import {
  REPORT_HUB_FILE,
  renderLlmHandoff,
  renderReportHub,
  renderValidationReport,
  renderWeeklyReview,
  type ValidationResult,
} from "./reports";
import {
  DEFAULT_SETTINGS,
  HIDDEN_OUTPUT_FOLDER,
  VISIBLE_OUTPUT_FOLDER,
  getSettingsValidationMessages,
  isHiddenOutputFolder,
  normalizeSettings,
  updateSettingsWithCustomOutputFolderInput,
  updateSettingsWithOutputFolderVisibility,
  updateSettingsWithStaleDaysInput,
  validateCustomOutputFolderInput,
  validateStaleDaysInput,
  type GotSaengPluginSettings,
  type OutputFolderVisibility,
} from "./settings";
import {
  buildOutputIgnoreGlobs,
  resolveOutputPath,
  toVaultRelativePath,
  type VaultPathInfo,
} from "./vault-path";
import { GOTSAENG_REPORT_VIEW_TYPE, GotSaengReportHubView } from "./view";

const VALIDATION_REPORT_FILE = "VALIDATION_REPORT.md";
const WEEKLY_REVIEW_FILE = "WEEKLY_REVIEW_CONTEXT.md";
const LLM_HANDOFF_FILE = "LLM_HANDOFF.md";

export default class GotSaengObsidianPlugin extends Plugin {
  override settings: GotSaengPluginSettings = DEFAULT_SETTINGS;
  selectedOutputFileName: string | null = REPORT_HUB_FILE;
  lastError: string | null = null;

  override async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new GotSaengSettingTab(this.app, this));
    this.registerView(GOTSAENG_REPORT_VIEW_TYPE, (leaf) => new GotSaengReportHubView(leaf, this));
    this.addRibbonIcon("file-text", "Open GotSaeng OS Report Hub", () => {
      void this.activateReportHubView();
    });

    this.addCommand({
      id: "compile-context-pack",
      name: "Compile Context Pack",
      callback: () => void this.compileContextPackCommand(),
    });

    this.addCommand({
      id: "generate-weekly-review",
      name: "Generate Weekly Review",
      callback: () => void this.generateWeeklyReviewCommand(),
    });

    this.addCommand({
      id: "export-llm-handoff",
      name: "Export LLM Handoff",
      callback: () => void this.exportLlmHandoffCommand(),
    });

    this.addCommand({
      id: "validate-vault-schema",
      name: "Validate Vault Schema",
      callback: () => void this.validateVaultSchemaCommand(),
    });

    this.addCommand({
      id: "open-report-hub",
      name: "Open Report Hub",
      callback: () => void this.activateReportHubView(),
    });

    this.addCommand({
      id: "switch-output-folder-hidden",
      name: "Switch Output Folder to Hidden",
      callback: () => void this.switchOutputFolderVisibilityCommand("hidden"),
    });

    this.addCommand({
      id: "switch-output-folder-visible",
      name: "Switch Output Folder to Visible",
      callback: () => void this.switchOutputFolderVisibilityCommand("visible"),
    });
  }

  async loadSettings(): Promise<void> {
    this.settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      ...((await this.loadData()) as Partial<GotSaengPluginSettings> | null | undefined),
    });
  }

  async saveSettings(): Promise<void> {
    this.settings = normalizeSettings(this.settings);
    await this.saveData(this.settings);
  }

  async compileContextPackCommand(): Promise<void> {
    await this.runSafely("Compile Context Pack", async () => {
      const result = await this.compileToOutput();
      await this.writeReportHub(result.pack, result.pathInfo);
      new Notice(`GotSaeng OS: compiled ${result.report.generatedFiles.length} files.`);
      await this.refreshReportHubViews();
      await this.openOutputFile(result.pathInfo.outputFolder, REPORT_HUB_FILE);
    });
  }

  async generateWeeklyReviewCommand(): Promise<void> {
    await this.runSafely("Generate Weekly Review", async () => {
      const result = await this.compileToOutput();
      await this.writeOutputReport(
        result.pathInfo.outputDir,
        WEEKLY_REVIEW_FILE,
        renderWeeklyReview(result.pack),
      );
      await this.writeReportHub(result.pack, result.pathInfo);
      new Notice("GotSaeng OS: weekly review context generated.");
      await this.refreshReportHubViews();
      await this.openOutputFile(result.pathInfo.outputFolder, WEEKLY_REVIEW_FILE);
    });
  }

  async exportLlmHandoffCommand(): Promise<void> {
    await this.runSafely("Export LLM Handoff", async () => {
      const result = await this.compileToOutput();
      const markdownFiles = renderMarkdownFiles(result.pack);
      await this.writeOutputReport(
        result.pathInfo.outputDir,
        LLM_HANDOFF_FILE,
        renderLlmHandoff(result.pack, markdownFiles),
      );
      await this.writeReportHub(result.pack, result.pathInfo);
      new Notice("GotSaeng OS: LLM handoff exported.");
      await this.refreshReportHubViews();
      await this.openOutputFile(result.pathInfo.outputFolder, LLM_HANDOFF_FILE);
    });
  }

  async validateVaultSchemaCommand(): Promise<void> {
    await this.runSafely("Validate Vault Schema", async () => {
      const pathInfo = resolveOutputPath(this.app, this.settings.outputFolder);
      const result = await this.validateVault(pathInfo.vaultRoot);
      const report = renderValidationReport({
        generatedAt: new Date().toISOString(),
        projectName: this.settings.projectName,
        sourceRoot: pathInfo.vaultRoot,
        strict: this.settings.strictValidation,
        result,
      });

      await this.writeOutputReport(pathInfo.outputDir, VALIDATION_REPORT_FILE, report);
      await this.cleanupStaleOutputFolders(pathInfo);
      new Notice(
        result.errors.length > 0
          ? `GotSaeng OS: validation found ${result.errors.length} errors.`
          : `GotSaeng OS: validation completed with ${result.warnings.length} warnings.`,
      );
      await this.openOutputFile(pathInfo.outputFolder, VALIDATION_REPORT_FILE);
    });
  }

  async switchOutputFolderVisibilityCommand(visibility: "hidden" | "visible"): Promise<void> {
    const label = visibility === "hidden" ? "Hidden" : "Visible";
    await this.runSafely(`Switch Output Folder to ${label}`, async () => {
      await this.switchOutputFolderVisibility(visibility);
    });
  }

  // The single gated path for every output-folder change. The command-palette
  // switch commands, all three settings-tab visibility options (including
  // "Custom path"), and the custom-path text field all route through here, so
  // no entry point can move the output folder without the same
  // confirm-before-delete check. Returns whether the change was applied
  // (false only if the user declined the confirmation).
  async applyOutputFolderChange(nextSettings: GotSaengPluginSettings): Promise<boolean> {
    const previousOutputFolder = this.settings.outputFolder;

    // A visibility-only change (e.g. picking "Custom path" while keeping the
    // same folder) moves no files, so it skips the prompt entirely.
    if (nextSettings.outputFolder === previousOutputFolder) {
      this.settings = nextSettings;
      await this.saveSettings();
      await this.refreshReportHubViews();
      return true;
    }

    const pathInfo = resolveOutputPath(this.app, nextSettings.outputFolder);
    // Pass the folder being vacated explicitly: it may be a custom path, which
    // is not one of the two built-in managed folders and would otherwise be
    // both uncounted here and never cleaned up later.
    const staleFileCount = await countStaleManagedOutputFiles(
      pathInfo.vaultRoot,
      pathInfo.outputFolder,
      previousOutputFolder,
    );

    if (staleFileCount > 0) {
      const confirmed = await new ConfirmModal(
        this.app,
        `Move generated output to ${nextSettings.outputFolder}?`,
        `This deletes ${staleFileCount} GotSaeng-generated file${staleFileCount === 1 ? "" : "s"} ` +
          "from the output folder you are leaving. Files you created there are left untouched.",
      ).confirm();

      if (!confirmed) {
        new Notice("GotSaeng OS: output folder switch cancelled.");
        return false;
      }
    }

    this.settings = nextSettings;
    await this.saveSettings();
    await this.cleanupStaleOutputFolders(pathInfo, previousOutputFolder);

    new Notice(`GotSaeng OS: output folder switched to ${this.settings.outputFolder}.`);
    await this.refreshReportHubViews();
    return true;
  }

  async switchOutputFolderVisibility(visibility: "hidden" | "visible"): Promise<boolean> {
    if (this.settings.outputFolderVisibility === visibility) {
      new Notice(`GotSaeng OS: output folder is already ${visibility}.`);
      return false;
    }

    return this.applyOutputFolderChange(
      updateSettingsWithOutputFolderVisibility(this.settings, visibility),
    );
  }

  // Commits a user-typed custom output folder. Returns false without touching
  // settings when the path is invalid, so the caller can restore the field.
  async applyCustomOutputFolder(value: string): Promise<boolean> {
    const nextSettings = updateSettingsWithCustomOutputFolderInput(this.settings, value);
    if (!nextSettings) {
      return false;
    }

    return this.applyOutputFolderChange(nextSettings);
  }

  async openOutputFileByName(fileName: string): Promise<void> {
    const pathInfo = resolveOutputPath(this.app, this.settings.outputFolder);
    this.setSelectedOutputFileName(fileName);

    if (isHiddenOutputFolder(pathInfo.outputFolder)) {
      await this.activateReportHubView();
      await this.refreshReportHubViews();
      return;
    }

    const filePath = toVaultRelativePath(pathInfo.outputFolder, fileName);
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
      new Notice(`GotSaeng OS: output file not found: ${filePath}`);
      await this.activateReportHubView();
      await this.refreshReportHubViews();
      return;
    }

    await this.app.workspace.getLeaf(false).openFile(file);
  }

  async openSourceFileByPath(sourcePath: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(sourcePath);
    if (!(file instanceof TFile)) {
      new Notice(`GotSaeng OS: source note not found: ${sourcePath}`);
      return;
    }

    await this.app.workspace.getLeaf(false).openFile(file);
  }

  setSelectedOutputFileName(fileName: string): void {
    this.selectedOutputFileName = fileName;
  }

  async readOutputFileByName(fileName: string): Promise<string | null> {
    const pathInfo = resolveOutputPath(this.app, this.settings.outputFolder);
    try {
      return await fs.readFile(path.join(pathInfo.outputDir, fileName), "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async readAllOutputFiles(): Promise<Partial<Record<string, string>>> {
    const files: Partial<Record<string, string>> = {};
    for (const artifact of OUTPUT_ARTIFACTS) {
      if (artifact.format !== "markdown") {
        continue;
      }

      const content = await this.readOutputFileByName(artifact.fileName);
      if (content !== null) {
        files[artifact.fileName] = content;
      }
    }

    return files;
  }

  async readCurrentCompileReport(): Promise<CompileReport | null> {
    const pathInfo = resolveOutputPath(this.app, this.settings.outputFolder);
    try {
      const raw = await fs.readFile(path.join(pathInfo.outputDir, "COMPILE_REPORT.json"), "utf8");
      return CompileReportSchema.parse(JSON.parse(raw));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async activateReportHubView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(GOTSAENG_REPORT_VIEW_TYPE)[0];
    const leaf = existing ?? this.app.workspace.getLeaf(false);
    await leaf.setViewState({ type: GOTSAENG_REPORT_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  private async compileToOutput(): Promise<{
    pack: ContextPack;
    report: CompileReport;
    pathInfo: VaultPathInfo;
  }> {
    const pathInfo = resolveOutputPath(this.app, this.settings.outputFolder);
    const pack = await compileContextPack({
      sourceRoot: pathInfo.vaultRoot,
      projectName: this.settings.projectName,
      staleDays: this.settings.staleDays,
      ignoreGlobs: buildOutputIgnoreGlobs(pathInfo.outputFolder),
    });
    const report = await writeContextPack(pack, pathInfo.outputDir);
    await this.cleanupStaleOutputFolders(pathInfo);

    return { pack, report, pathInfo };
  }

  private async cleanupStaleOutputFolders(
    pathInfo: VaultPathInfo,
    previousOutputFolder?: string,
  ): Promise<void> {
    const cleanupResults = await cleanupStaleManagedOutputFolders(
      pathInfo.vaultRoot,
      pathInfo.outputFolder,
      previousOutputFolder,
    );

    if (cleanupResults.length > 0) {
      const removedFiles = cleanupResults.reduce(
        (total, result) => total + result.removedFiles.length,
        0,
      );
      new Notice(
        `GotSaeng OS: cleaned ${removedFiles} stale generated files from previous output folder.`,
      );
    }
  }

  private async validateVault(vaultRoot: string): Promise<ValidationResult> {
    const files = await scanMarkdownFiles(vaultRoot);
    const warnings: string[] = [];
    const errors: string[] = [];

    for (const filePath of files) {
      try {
        const note = await parseMarkdownFile(filePath, vaultRoot);
        for (const issue of validateNoteMetadata(note, {
          strict: this.settings.strictValidation,
        })) {
          const rendered = `${issue.path}: ${issue.message}`;
          if (issue.severity === "error") {
            errors.push(rendered);
          } else {
            warnings.push(rendered);
          }
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    return {
      filesChecked: files.length,
      warnings: warnings.sort(),
      errors: errors.sort(),
    };
  }

  private async writeOutputReport(
    outputDir: string,
    fileName: string,
    content: string,
  ): Promise<void> {
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(path.join(outputDir, fileName), content, "utf8");
  }

  private async writeReportHub(pack: ContextPack, pathInfo: VaultPathInfo): Promise<void> {
    await this.writeOutputReport(
      pathInfo.outputDir,
      REPORT_HUB_FILE,
      renderReportHub(pack, {
        outputFolder: pathInfo.outputFolder,
      }),
    );
  }

  private async openOutputFile(outputFolder: string, fileName: string): Promise<void> {
    this.setSelectedOutputFileName(fileName);

    if (!this.settings.openAfterCompile) {
      return;
    }

    if (isHiddenOutputFolder(outputFolder)) {
      await this.activateReportHubView();
      await this.refreshReportHubViews();
      return;
    }

    await this.openOutputFileByName(fileName);
  }

  private async refreshReportHubViews(): Promise<void> {
    await Promise.all(
      this.app.workspace
        .getLeavesOfType(GOTSAENG_REPORT_VIEW_TYPE)
        .map((leaf) =>
          leaf.view instanceof GotSaengReportHubView ? leaf.view.render() : Promise.resolve(),
        ),
    );
  }

  private async runSafely(action: string, task: () => Promise<void>): Promise<void> {
    // Clear the previous run's error banner up front, before `task` runs. Every
    // command already refreshes the Report Hub view somewhere in its own success
    // path; clearing `lastError` only *after* `task()` resolves meant that
    // in-task refresh re-rendered the stale banner moments before this line
    // ever ran, so it never actually disappeared until some later, unrelated
    // refresh happened to fire.
    this.lastError = null;
    try {
      new Notice(`GotSaeng OS: ${action} started.`);
      await task();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`GotSaeng OS ${action} failed`, error);
      new Notice(`GotSaeng OS: ${message}`);
      this.lastError = `${action} failed: ${message}`;
    } finally {
      // A refresh failure (e.g. a malformed COMPILE_REPORT.json making the view
      // unrenderable) must not escape runSafely: it would turn a contained
      // command failure into an unhandled rejection for callers that discard
      // the command's promise, defeating the guarantee this method exists for.
      try {
        await this.refreshReportHubViews();
      } catch (refreshError) {
        console.error(`GotSaeng OS ${action}: failed to refresh Report Hub view`, refreshError);
      }
    }
  }
}

// Simple Yes/No confirmation dialog. `confirm()` opens the modal and resolves
// once the user picks an option (or dismisses the modal, which counts as "No").
class ConfirmModal extends Modal {
  private resolveConfirm: ((confirmed: boolean) => void) | null = null;

  constructor(
    app: App,
    private readonly heading: string,
    private readonly detail: string,
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("p", { text: this.heading });
    contentEl.createEl("p", { text: this.detail, cls: "gotsaeng-os-view-note" });

    const buttons = contentEl.createDiv({ cls: "gotsaeng-os-modal-buttons" });
    const cancelButton = buttons.createEl("button", { text: "Cancel" });
    cancelButton.addEventListener("click", () => {
      this.finish(false);
      this.close();
    });

    const confirmButton = buttons.createEl("button", {
      text: "Delete and switch",
      cls: "mod-warning",
    });
    confirmButton.addEventListener("click", () => {
      this.finish(true);
      this.close();
    });
  }

  override onClose(): void {
    this.contentEl.empty();
    this.finish(false);
  }

  confirm(): Promise<boolean> {
    return new Promise((resolve) => {
      this.resolveConfirm = resolve;
      this.open();
    });
  }

  private finish(confirmed: boolean): void {
    const resolve = this.resolveConfirm;
    this.resolveConfirm = null;
    resolve?.(confirmed);
  }
}

class GotSaengSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: GotSaengObsidianPlugin,
  ) {
    super(app, plugin);
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("p", {
      text: "Desktop-only local context compiler. v0.10 does not call AI services or sync data.",
      cls: "gotsaeng-os-setting-note",
    });

    const validationMessages = getSettingsValidationMessages(this.plugin.settings);
    if (validationMessages.length > 0) {
      const warning = containerEl.createEl("div", { cls: "gotsaeng-os-setting-warning" });
      warning.createEl("strong", { text: "Settings need attention" });
      const list = warning.createEl("ul");
      for (const message of validationMessages) {
        list.createEl("li", { text: message });
      }
    }

    new Setting(containerEl)
      .setName("Project name")
      .setDesc("Used in generated context pack headings.")
      .addText((text) => {
        text
          .setPlaceholder(DEFAULT_SETTINGS.projectName)
          .setValue(this.plugin.settings.projectName)
          .onChange(async (value) => {
            this.plugin.settings.projectName = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Output folder visibility")
      .setDesc(
        "Hidden keeps generated files out of the file explorer. Visible makes output browsable as normal notes.",
      )
      .addDropdown((dropdown) => {
        dropdown
          .addOption("hidden", `Hidden system folder (${HIDDEN_OUTPUT_FOLDER})`)
          .addOption("visible", `Visible vault folder (${VISIBLE_OUTPUT_FOLDER})`)
          .addOption("custom", "Custom path")
          .setValue(this.plugin.settings.outputFolderVisibility)
          .onChange(async (value) => {
            const visibility = value as OutputFolderVisibility;
            // Every branch routes through applyOutputFolderChange, so all three
            // options share the command-palette commands' confirm-before-delete
            // gate. "Custom path" keeps the current folder and only unlocks the
            // text field; committing an actual path happens on blur below.
            if (visibility === "hidden" || visibility === "visible") {
              await this.plugin.switchOutputFolderVisibility(visibility);
            } else {
              await this.plugin.applyOutputFolderChange({
                ...this.plugin.settings,
                outputFolderVisibility: visibility,
              });
            }
            this.display();
          });
      });

    const isCustomVisibility = this.plugin.settings.outputFolderVisibility === "custom";
    new Setting(containerEl)
      .setName("Output folder path")
      .setDesc(
        isCustomVisibility
          ? "Enter a vault-relative folder path (for example: Notes/Context Pack)."
          : "Generated files stay inside the current vault. Switch to Custom path to edit this manually.",
      )
      .addText((text) => {
        text
          .setPlaceholder(DEFAULT_SETTINGS.outputFolder)
          .setValue(this.plugin.settings.outputFolder);
        text.inputEl.disabled = !isCustomVisibility;
        // Commit on blur, not per keystroke: a half-typed path is not a folder
        // the user meant to move output into, and committing each keystroke
        // would fire applyOutputFolderChange's confirmation once per character.
        text.inputEl.addEventListener("blur", () => {
          void (async () => {
            const validationMessages = validateCustomOutputFolderInput(text.inputEl.value);
            if (validationMessages.length > 0) {
              new Notice(`GotSaeng OS settings: ${validationMessages[0]}`);
              text.setValue(this.plugin.settings.outputFolder);
              return;
            }

            await this.plugin.applyCustomOutputFolder(text.inputEl.value);
            // Re-sync the field with what actually persisted — unchanged when
            // the user declined the confirmation.
            text.setValue(this.plugin.settings.outputFolder);
          })();
        });
        if (isCustomVisibility) {
          text.inputEl.focus();
        }
      });

    new Setting(containerEl)
      .setName("Stale days")
      .setDesc("Open items older than this threshold are reported as stale.")
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = "1";
        text.setValue(String(this.plugin.settings.staleDays)).onChange(async (value) => {
          const updatedSettings = updateSettingsWithStaleDaysInput(this.plugin.settings, value);
          if (!updatedSettings) {
            return;
          }

          this.plugin.settings = updatedSettings;
          await this.plugin.saveSettings();
        });
        text.inputEl.addEventListener("blur", () => {
          const validationMessages = validateStaleDaysInput(text.inputEl.value);
          if (validationMessages.length > 0) {
            new Notice(`GotSaeng OS settings: ${validationMessages[0]}`);
            text.setValue(String(this.plugin.settings.staleDays));
          }
        });
      });

    new Setting(containerEl)
      .setName("Strict validation")
      .setDesc("Treat unsupported note types and unrecognized dates as errors.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.strictValidation).onChange(async (value) => {
          this.plugin.settings.strictValidation = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Open generated file")
      .setDesc("Open the primary generated report after each command.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.openAfterCompile).onChange(async (value) => {
          this.plugin.settings.openAfterCompile = value;
          await this.plugin.saveSettings();
        });
      });
  }
}
