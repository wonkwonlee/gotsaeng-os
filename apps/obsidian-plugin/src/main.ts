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
  type FileSystemAdapter,
} from "@gotsaeng/core";
import {
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  type App,
  type SettingDefinitionItem,
} from "obsidian";

import { OUTPUT_ARTIFACTS } from "./artifacts";
import { createObsidianFileSystemAdapter } from "./obsidian-file-system";
import { cleanupStaleManagedOutputFolders, countStaleManagedOutputFiles } from "./output-cleanup";
import {
  REPORT_HUB_FILE,
  renderLlmHandoff,
  renderReportHub,
  renderValidationReport,
  renderWeeklyReview,
  type ValidationResult,
} from "./reports";
import { GOTSAENG_REPORT_VIEW_TYPE, GotSaengReportHubView, type ReportHubLastError } from "./view";
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

const VALIDATION_REPORT_FILE = "VALIDATION_REPORT.md";
const WEEKLY_REVIEW_FILE = "WEEKLY_REVIEW_CONTEXT.md";
const LLM_HANDOFF_FILE = "LLM_HANDOFF.md";

export default class GotSaengObsidianPlugin extends Plugin {
  override settings: GotSaengPluginSettings = DEFAULT_SETTINGS;
  selectedOutputFileName: string | null = REPORT_HUB_FILE;
  lastError: ReportHubLastError | null = null;
  // See applyOutputFolderChange for why output-folder mutations are
  // serialized behind this. Always a never-rejecting promise.
  private pendingFolderChange: Promise<unknown> = Promise.resolve();
  // Bumped by every applyOutputFolderChange call (at call time, not once it
  // reaches the front of the queue) — see applyOutputFolderChangeNow for how
  // this cancels a superseded queued call instead of merely serializing it.
  private folderChangeGeneration = 0;

  // Computed fresh per use (cheap: no I/O), matching how resolveOutputPath(this.app, ...)
  // is already called fresh throughout this class rather than cached at construction.
  private get fsAdapter(): FileSystemAdapter {
    return createObsidianFileSystemAdapter(this.app);
  }

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
    // normalizeSettings already falls back to DEFAULT_SETTINGS field-by-field
    // for anything missing, so the loaded data is passed through as-is
    // instead of pre-spread onto DEFAULT_SETTINGS first.
    this.settings = normalizeSettings(
      ((await this.loadData()) as Partial<GotSaengPluginSettings> | null | undefined) ?? {},
    );
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
  //
  // Calls are serialized behind `pendingFolderChange`: the settings-tab path
  // field commits on blur and the visibility dropdown commits on change, and
  // a fast user gesture can fire both before the first one's confirm modal
  // (or even its dry-run file count, which awaits real fs calls) has
  // resolved. Without serializing, two calls could both read `this.settings`
  // before either had written it back, opening two confirm modals for one
  // logical change and computing the second one's stale-file count and
  // `previousOutputFolder` against state the first call was still in the
  // middle of superseding. Chaining onto the previous call (success or
  // failure) makes the second call simply queue and see the first call's
  // fully-settled result instead.
  //
  // Serializing alone still lets a fast blur-then-dropdown gesture show TWO
  // sequential confirm dialogs for what was really one user action: blur's
  // custom-path commit runs first (possibly prompting), then the dropdown's
  // target runs second and prompts again, now against whatever the first
  // call left behind. `folderChangeGeneration` cancels the superseded call
  // outright instead of just deferring it: every call captures the
  // generation counter when it is *created* (synchronously, before it is
  // queued), and `applyOutputFolderChangeNow` bails as a no-op if a newer
  // call was created before this one got its turn — so only the last of a
  // racing burst ever reaches the confirm-modal/settings-write logic.
  async applyOutputFolderChange(nextSettings: GotSaengPluginSettings): Promise<boolean> {
    const myGeneration = ++this.folderChangeGeneration;
    const scheduled = this.pendingFolderChange.then(
      () => this.applyOutputFolderChangeNow(nextSettings, myGeneration),
      () => this.applyOutputFolderChangeNow(nextSettings, myGeneration),
    );
    // The instance field only ever holds a never-rejecting promise, so a
    // failure in one queued change can't poison every change queued after
    // it; each caller still gets `scheduled`, which carries the real
    // resolution or rejection for that specific call.
    this.pendingFolderChange = scheduled.catch(() => undefined);
    return scheduled;
  }

  private async applyOutputFolderChangeNow(
    nextSettings: GotSaengPluginSettings,
    myGeneration: number,
  ): Promise<boolean> {
    // A newer applyOutputFolderChange call was created while this one was
    // still queued: this call is superseded by that later, more-current
    // intent (e.g. the dropdown selection that followed a blur commit within
    // the same gesture) and must not write settings or prompt at all.
    if (myGeneration !== this.folderChangeGeneration) {
      return false;
    }

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
      this.fsAdapter,
      pathInfo.vaultRoot,
      pathInfo.outputFolder,
      previousOutputFolder,
      this.settings.managedOutputFolders,
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

  // Lets the Report Hub banner clear independently of running another
  // command — see the class-level comment on runSafely for why the banner
  // used to only clear on the *next successful run*.
  dismissLastError(): void {
    this.lastError = null;
  }

  async readOutputFileByName(fileName: string): Promise<string | null> {
    const pathInfo = resolveOutputPath(this.app, this.settings.outputFolder);
    return this.fsAdapter.readText(path.join(pathInfo.outputDir, fileName));
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
    const raw = await this.fsAdapter.readText(path.join(pathInfo.outputDir, "COMPILE_REPORT.json"));
    return raw === null ? null : CompileReportSchema.parse(JSON.parse(raw));
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
    const pack = await compileContextPack(this.fsAdapter, {
      sourceRoot: pathInfo.vaultRoot,
      projectName: this.settings.projectName,
      staleDays: this.settings.staleDays,
      ignoreGlobs: buildOutputIgnoreGlobs(pathInfo.outputFolder),
    });
    const report = await writeContextPack(this.fsAdapter, pack, pathInfo.outputDir);
    await this.cleanupStaleOutputFolders(pathInfo);

    return { pack, report, pathInfo };
  }

  private async cleanupStaleOutputFolders(
    pathInfo: VaultPathInfo,
    previousOutputFolder?: string,
  ): Promise<void> {
    const cleanupResults = await cleanupStaleManagedOutputFolders(
      this.fsAdapter,
      pathInfo.vaultRoot,
      pathInfo.outputFolder,
      previousOutputFolder,
      this.settings.managedOutputFolders,
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
    const files = await scanMarkdownFiles(this.fsAdapter, vaultRoot);
    const warnings: string[] = [];
    const errors: string[] = [];

    for (const filePath of files) {
      try {
        const note = await parseMarkdownFile(this.fsAdapter, filePath, vaultRoot);
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
    await this.fsAdapter.mkdir(outputDir);
    await this.fsAdapter.writeText(path.join(outputDir, fileName), content);
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

  // Not private: GotSaengReportHubView's dismiss-error control calls this
  // directly (via the ReportHubController interface) so dismissing the
  // shared `lastError` clears the banner in every mounted Report Hub leaf,
  // not just the one the dismiss button was clicked in.
  async refreshReportHubViews(): Promise<void> {
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
      this.lastError = { action, message, timestamp: Date.now() };
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
    // A destructive confirmation dialog needs an accessible name (screen
    // readers otherwise announce it as an unlabeled dialog) and focus moved
    // into it on open — without either, a keyboard/AT user has no signal a
    // modal even appeared.
    this.setTitle(this.heading);
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

    // Focus the safer default (Cancel), not the destructive action, so a
    // stray Enter/Space keypress right after the modal opens can't confirm
    // a deletion the user hasn't actually read yet.
    cancelButton.focus();
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
  // Transient UI-only state, never persisted: true from the moment the
  // visibility dropdown is switched to "Custom path" until the resulting
  // blur commit resolves (accepted or declined). Lets the path field unlock
  // and the dropdown show "Custom path" immediately, without writing
  // `outputFolderVisibility: "custom"` to plugin.settings before an actual
  // custom folder is committed — see buildOutputFolderVisibilitySetting for
  // why an eager settings write here was the root cause of issue #26.
  private isEditingCustomPath = false;
  // One-shot flag consumed by buildOutputFolderPathSetting: set only at the
  // moment the dropdown transitions into "Custom path", so the path field is
  // focused only on that transition — not on every re-render while already
  // in custom mode (issue #25).
  private shouldFocusCustomPath = false;

  constructor(
    app: App,
    private readonly plugin: GotSaengObsidianPlugin,
  ) {
    super(app, plugin);
  }

  private get effectiveOutputFolderVisibility(): OutputFolderVisibility {
    return this.isEditingCustomPath ? "custom" : this.plugin.settings.outputFolderVisibility;
  }

  // Declarative settings API (Obsidian >=1.13.0): surfaces these settings in
  // the app's global settings search. display() below stays as the fallback
  // for hosts older than that — this plugin's manifest.json minAppVersion is
  // 1.5.0, and getSettingDefinitions() is simply never called on a host that
  // doesn't know about it, so both can coexist without a version check here.
  //
  // Two of the six settings (output folder visibility, output folder path)
  // use the `render` escape hatch instead of a native `control` type: the
  // visibility change is confirm-gated (deleting generated files from the
  // folder being vacated), and the path field commits only on blur, not on
  // every keystroke — no `control` type here exposes either behavior, and
  // reproducing them with `control` + `setControlValue` would mean firing
  // the delete-confirmation dialog once per character typed, exactly the bug
  // 0.12.0 shipped a fix for. Both share their actual logic with display()
  // via buildOutputFolderVisibilitySetting/buildOutputFolderPathSetting
  // below, so nothing here duplicates that behavior — only its embedding
  // differs.
  override getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: "Project name",
        desc: "Used in generated context pack headings.",
        control: {
          type: "text",
          key: "projectName",
          defaultValue: DEFAULT_SETTINGS.projectName,
        },
      },
      {
        name: "Output folder visibility",
        desc: "Hidden keeps generated files out of the file explorer. Visible makes output browsable as normal notes.",
        render: (setting) => {
          this.buildOutputFolderVisibilitySetting(setting, () => this.update());
        },
      },
      {
        name: "Output folder path",
        desc:
          this.effectiveOutputFolderVisibility === "custom"
            ? "Enter a vault-relative folder path (for example: Notes/Context Pack)."
            : "Generated files stay inside the current vault. Switch to Custom path to edit this manually.",
        render: (setting) => {
          this.buildOutputFolderPathSetting(setting, () => this.update());
        },
      },
      {
        name: "Stale days",
        desc: "Open items older than this threshold are reported as stale.",
        control: {
          type: "number",
          key: "staleDays",
          defaultValue: DEFAULT_SETTINGS.staleDays,
          min: 1,
          validate: (value) => {
            const messages = validateStaleDaysInput(String(value));
            return messages[0];
          },
        },
      },
      {
        name: "Strict validation",
        desc: "Treat unsupported note types and unrecognized dates as errors.",
        control: {
          type: "toggle",
          key: "strictValidation",
          defaultValue: DEFAULT_SETTINGS.strictValidation,
        },
      },
      {
        name: "Open generated file",
        desc: "Open the primary generated report after each command.",
        control: {
          type: "toggle",
          key: "openAfterCompile",
          defaultValue: DEFAULT_SETTINGS.openAfterCompile,
        },
      },
    ];
  }

  // The base SettingTab default reads/writes app.vault.getConfig/setConfig —
  // the app's own settings store, not this plugin's data.json. Override to
  // route through the same this.plugin.settings + saveSettings() every other
  // write path in this file already uses.
  override getControlValue(key: string): unknown {
    switch (key) {
      case "projectName":
        return this.plugin.settings.projectName;
      case "staleDays":
        return this.plugin.settings.staleDays;
      case "strictValidation":
        return this.plugin.settings.strictValidation;
      case "openAfterCompile":
        return this.plugin.settings.openAfterCompile;
      default:
        return undefined;
    }
  }

  override async setControlValue(key: string, value: unknown): Promise<void> {
    switch (key) {
      case "projectName":
        this.plugin.settings.projectName = value as string;
        await this.plugin.saveSettings();
        return;
      case "staleDays": {
        const updated = updateSettingsWithStaleDaysInput(this.plugin.settings, String(value));
        if (updated) {
          this.plugin.settings = updated;
          await this.plugin.saveSettings();
        }
        return;
      }
      case "strictValidation":
        this.plugin.settings.strictValidation = value as boolean;
        await this.plugin.saveSettings();
        return;
      case "openAfterCompile":
        this.plugin.settings.openAfterCompile = value as boolean;
        await this.plugin.saveSettings();
        return;
      default:
        throw new Error(`Unknown setting key: ${key}`);
    }
  }

  // Fallback for Obsidian <1.13.0, where getSettingDefinitions() does not
  // exist and this is the only way settings render at all.
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

    this.buildOutputFolderVisibilitySetting(new Setting(containerEl), () => this.display());
    this.buildOutputFolderPathSetting(new Setting(containerEl), () => this.display());

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

  // Shared by display() (imperative, pre-1.13.0 fallback) and
  // getSettingDefinitions()'s "Output folder visibility" render() escape
  // hatch, so the confirm-before-delete gate has exactly one implementation.
  // `refresh` is display() re-render on the imperative path and
  // SettingTab.update() on the declarative path — see the class-level
  // comment on getSettingDefinitions() for why they need to differ.
  private buildOutputFolderVisibilitySetting(setting: Setting, refresh: () => void): void {
    setting
      .setName("Output folder visibility")
      .setDesc(
        "Hidden keeps generated files out of the file explorer. Visible makes output browsable as normal notes.",
      )
      .addDropdown((dropdown) => {
        dropdown
          .addOption("hidden", `Hidden system folder (${HIDDEN_OUTPUT_FOLDER})`)
          .addOption("visible", `Visible vault folder (${VISIBLE_OUTPUT_FOLDER})`)
          .addOption("custom", "Custom path")
          .setValue(this.effectiveOutputFolderVisibility)
          .onChange(async (value) => {
            const visibility = value as OutputFolderVisibility;
            // Hidden/Visible route through applyOutputFolderChange immediately,
            // sharing the command-palette commands' confirm-before-delete gate.
            // "Custom path" does NOT write to plugin.settings here — it only
            // flips transient UI state to unlock and focus the text field below.
            // Persisting `outputFolderVisibility: "custom"` before an actual
            // custom folder is committed left a window (including a declined
            // blur commit) where settings said "custom" while outputFolder
            // still pointed at a built-in folder (issue #26).
            if (visibility === "hidden" || visibility === "visible") {
              this.isEditingCustomPath = false;
              await this.plugin.switchOutputFolderVisibility(visibility);
            } else {
              this.isEditingCustomPath = true;
              this.shouldFocusCustomPath = true;
            }
            refresh();
          });
      });
  }

  // Shared by display() and getSettingDefinitions()'s "Output folder path"
  // render() escape hatch — see buildOutputFolderVisibilitySetting above for
  // why this can't be a native `control` definition. `refresh` re-renders the
  // validation banner after a blur commit settles (issue #25) — display() on
  // the imperative path, SettingTab.update() on the declarative path, same as
  // buildOutputFolderVisibilitySetting's `refresh`.
  private buildOutputFolderPathSetting(setting: Setting, refresh: () => void): void {
    const isCustomVisibility = this.effectiveOutputFolderVisibility === "custom";
    setting
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
            // No-op guard: a plain focus-then-blur with no edit (e.g. just
            // tabbing through the form, or the auto-focus below) must not
            // enter the async commit path at all (issue #22).
            if (text.inputEl.value === this.plugin.settings.outputFolder) {
              return;
            }

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
            // The commit settled (accepted or declined either way): the
            // transient "entering custom mode" state is no longer needed —
            // plugin.settings.outputFolderVisibility now reflects reality on
            // its own (either genuinely "custom", or reverted to whatever it
            // was before, matching the folder actually in use — issue #26).
            this.isEditingCustomPath = false;
            refresh();
          })();
        });
        if (this.shouldFocusCustomPath) {
          this.shouldFocusCustomPath = false;
          text.inputEl.focus();
        }
      });
  }
}
