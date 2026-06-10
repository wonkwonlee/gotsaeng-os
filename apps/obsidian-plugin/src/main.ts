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
import { Notice, Plugin, PluginSettingTab, Setting, TFile, type App } from "obsidian";

import { cleanupStaleManagedOutputFolders } from "./output-cleanup";
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
  updateSettingsWithStaleDaysInput,
  validateCustomOutputFolderInput,
  validateStaleDaysInput,
  type GotSaengPluginSettings,
  type OutputFolderVisibility,
} from "./settings";
import { resolveOutputPath, toVaultRelativePath, type VaultPathInfo } from "./vault-path";
import { GOTSAENG_REPORT_VIEW_TYPE, GotSaengReportHubView } from "./view";

const VALIDATION_REPORT_FILE = "VALIDATION_REPORT.md";
const WEEKLY_REVIEW_FILE = "WEEKLY_REVIEW_CONTEXT.md";
const LLM_HANDOFF_FILE = "LLM_HANDOFF.md";

export default class GotSaengObsidianPlugin extends Plugin {
  override settings: GotSaengPluginSettings = DEFAULT_SETTINGS;
  selectedOutputFileName: string | null = REPORT_HUB_FILE;

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
    });
    const report = await writeContextPack(pack, pathInfo.outputDir);
    await this.cleanupStaleOutputFolders(pathInfo);

    return { pack, report, pathInfo };
  }

  private async cleanupStaleOutputFolders(pathInfo: VaultPathInfo): Promise<void> {
    const cleanupResults = await cleanupStaleManagedOutputFolders(
      pathInfo.vaultRoot,
      pathInfo.outputFolder,
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
    try {
      new Notice(`GotSaeng OS: ${action} started.`);
      await task();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`GotSaeng OS ${action} failed`, error);
      new Notice(`GotSaeng OS: ${message}`);
    }
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

    containerEl.createEl("h2", { text: "GotSaeng OS" });
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
            this.plugin.settings.outputFolderVisibility = value as OutputFolderVisibility;
            if (value === "hidden") {
              this.plugin.settings.outputFolder = HIDDEN_OUTPUT_FOLDER;
            } else if (value === "visible") {
              this.plugin.settings.outputFolder = VISIBLE_OUTPUT_FOLDER;
            }
            await this.plugin.saveSettings();
            this.display();
          });
      });

    new Setting(containerEl)
      .setName("Output folder path")
      .setDesc(
        "Generated files stay inside the current vault. Switch to Custom path to edit this manually.",
      )
      .addText((text) => {
        text
          .setPlaceholder(DEFAULT_SETTINGS.outputFolder)
          .setValue(this.plugin.settings.outputFolder)
          .onChange(async (value) => {
            const validationMessages = validateCustomOutputFolderInput(value);
            const updatedSettings = updateSettingsWithCustomOutputFolderInput(
              this.plugin.settings,
              value,
            );
            if (!updatedSettings) {
              new Notice(`GotSaeng OS settings: ${validationMessages[0]}`);
              this.display();
              return;
            }

            this.plugin.settings = updatedSettings;
            await this.plugin.saveSettings();
            this.display();
          });
        text.inputEl.disabled = this.plugin.settings.outputFolderVisibility !== "custom";
      });

    new Setting(containerEl)
      .setName("Stale days")
      .setDesc("Open items older than this threshold are reported as stale.")
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = "1";
        text.setValue(String(this.plugin.settings.staleDays)).onChange(async (value) => {
          const validationMessages = validateStaleDaysInput(value);
          const updatedSettings = updateSettingsWithStaleDaysInput(this.plugin.settings, value);
          if (!updatedSettings) {
            new Notice(`GotSaeng OS settings: ${validationMessages[0]}`);
            this.display();
            return;
          }

          this.plugin.settings = updatedSettings;
          await this.plugin.saveSettings();
          this.display();
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
