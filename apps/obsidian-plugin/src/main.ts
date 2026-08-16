import path from "node:path";

import {
  ARTIFACT_INDEX_FILE,
  ArtifactIndexSchema,
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

import { FocusRestorer, createLiveRegion } from "./a11y";
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
import {
  GOTSAENG_REPORT_VIEW_TYPE,
  GotSaengReportHubView,
  type CompileReportRead,
  type ReportHubLastError,
} from "./view";
import {
  DEFAULT_SETTINGS,
  HIDDEN_OUTPUT_FOLDER,
  VISIBLE_OUTPUT_FOLDER,
  getPersistedSettingsIssues,
  getSettingsValidationMessages,
  isHiddenOutputFolder,
  normalizeSettings,
  pruneManagedOutputFolders,
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

// How long a typed settings value waits before it is written to disk. Long
// enough that ordinary typing produces one write instead of one per character,
// short enough that a user who types and immediately closes Obsidian without
// blurring the field has almost certainly already been saved (and the unload
// flush covers the rest).
const SETTINGS_WRITE_DEBOUNCE_MS = 400;

const VALIDATION_REPORT_FILE = "VALIDATION_REPORT.md";
const WEEKLY_REVIEW_FILE = "WEEKLY_REVIEW_CONTEXT.md";
const LLM_HANDOFF_FILE = "LLM_HANDOFF.md";

export default class GotSaengObsidianPlugin extends Plugin {
  override settings: GotSaengPluginSettings = DEFAULT_SETTINGS;
  selectedOutputFileName: string | null = REPORT_HUB_FILE;
  lastError: ReportHubLastError | null = null;
  // What was wrong with the *persisted* settings the last load read, before
  // normalizeSettings coerced it away. The settings tab surfaces these, so a
  // reset the user never asked for is reported instead of silent. See
  // getPersistedSettingsIssues in settings.ts.
  settingsIssues: string[] = [];
  // See applyOutputFolderChange for why output-folder mutations are
  // serialized behind this. Always a never-rejecting promise.
  private pendingFolderChange: Promise<unknown> = Promise.resolve();
  // See runSafely: every command writes into the same output directory, so
  // they run one at a time. Always a never-rejecting promise, same as
  // pendingFolderChange.
  private pendingCommand: Promise<unknown> = Promise.resolve();
  // Bumped by every applyOutputFolderChange call (at call time, not once it
  // reaches the front of the queue) — see applyOutputFolderChangeNow for how
  // this cancels a superseded queued call instead of merely serializing it.
  private folderChangeGeneration = 0;
  // Timer behind saveSettingsDebounced(); null when no write is waiting.
  private pendingSettingsWrite: ReturnType<typeof setTimeout> | null = null;

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
      runDetached("failed to open the Report Hub", () => this.activateReportHubView());
    });

    this.addCommand({
      id: "compile-context-pack",
      name: "Compile Context Pack",
      callback: () =>
        runDetached("Compile Context Pack failed", () => this.compileContextPackCommand()),
    });

    this.addCommand({
      id: "generate-weekly-review",
      name: "Generate Weekly Review",
      callback: () =>
        runDetached("Generate Weekly Review failed", () => this.generateWeeklyReviewCommand()),
    });

    this.addCommand({
      id: "export-llm-handoff",
      name: "Export LLM Handoff",
      callback: () =>
        runDetached("Export LLM Handoff failed", () => this.exportLlmHandoffCommand()),
    });

    this.addCommand({
      id: "validate-vault-schema",
      name: "Validate Vault Schema",
      callback: () =>
        runDetached("Validate Vault Schema failed", () => this.validateVaultSchemaCommand()),
    });

    this.addCommand({
      id: "open-report-hub",
      name: "Open Report Hub",
      callback: () =>
        runDetached("failed to open the Report Hub", () => this.activateReportHubView()),
    });

    this.addCommand({
      id: "switch-output-folder-hidden",
      name: "Switch Output Folder to Hidden",
      callback: () =>
        runDetached("Switch Output Folder to Hidden failed", () =>
          this.switchOutputFolderVisibilityCommand("hidden"),
        ),
    });

    this.addCommand({
      id: "switch-output-folder-visible",
      name: "Switch Output Folder to Visible",
      callback: () =>
        runDetached("Switch Output Folder to Visible failed", () =>
          this.switchOutputFolderVisibilityCommand("visible"),
        ),
    });
  }

  // A debounced write still waiting when the plugin is disabled (or Obsidian
  // quits) would otherwise be dropped along with its timer, losing the last
  // few characters the user typed.
  override onunload(): void {
    runDetached("failed to flush a pending settings write", () => this.flushPendingSettingsWrite());
  }

  async loadSettings(): Promise<void> {
    // normalizeSettings already falls back to DEFAULT_SETTINGS field-by-field
    // for anything missing, so the loaded data is passed through as-is
    // instead of pre-spread onto DEFAULT_SETTINGS first.
    const persisted =
      ((await this.loadData()) as Partial<GotSaengPluginSettings> | null | undefined) ?? {};
    // Recorded before normalization, which is the only moment the invalid
    // value still exists.
    this.settingsIssues = getPersistedSettingsIssues(persisted);
    this.settings = normalizeSettings(persisted);
  }

  async saveSettings(): Promise<void> {
    // A pending debounced write would otherwise fire after this one and
    // re-persist the same object for no reason.
    this.cancelPendingSettingsWrite();
    const beforePrune = normalizeSettings(this.settings);
    // pruneSettings awaits filesystem checks (one exists() per managed
    // folder), and `this.settings` is mutated in place per keystroke by the
    // fields that debounce through here (see saveSettingsDebounced) — so a
    // keystroke can land while this is still in flight. Assigning its result
    // straight to `this.settings` would silently revert that keystroke: the
    // next debounce timer would then read and persist the reverted value,
    // permanently losing what the user typed during the prune. Only
    // `managedOutputFolders` is something this await actually determined —
    // everything else re-reads `this.settings` again after the await so a
    // mid-prune edit survives.
    const pruned = await this.pruneSettings(beforePrune);
    const afterPrune = normalizeSettings(this.settings);
    const stillMissing = new Set(
      beforePrune.managedOutputFolders.filter(
        (folder) => !pruned.managedOutputFolders.includes(folder),
      ),
    );
    this.settings = {
      ...afterPrune,
      managedOutputFolders: afterPrune.managedOutputFolders.filter(
        (folder) => !stillMissing.has(folder),
      ),
    };
    await this.saveData(this.settings);
    // What is on disk is now the normalized (valid) object, so whatever the
    // load-time issues described no longer exists to report.
    this.settingsIssues = [];
  }

  // For settings the user *types*: `settings` is updated by the caller on every
  // keystroke (so the value the field shows is always the value in use), but
  // the write behind it is a full data.json save plus normalization and a
  // managed-folder prune that stats the vault — far too much to run once per
  // character. Text fields that own their own input element commit on blur
  // instead (see buildOutputFolderPathSetting); this exists for the ones
  // rendered by the declarative settings API, where the host owns the element
  // and there is no blur to hook.
  saveSettingsDebounced(): void {
    this.cancelPendingSettingsWrite();
    this.pendingSettingsWrite = setTimeout(() => {
      this.pendingSettingsWrite = null;
      runDetached("failed to save settings", () => this.saveSettings());
    }, SETTINGS_WRITE_DEBOUNCE_MS);
  }

  /** Writes a debounced save out now, if one is still waiting. */
  async flushPendingSettingsWrite(): Promise<void> {
    if (this.pendingSettingsWrite === null) {
      return;
    }

    // saveSettings() cancels the timer itself; going through it here keeps the
    // "who clears the timer" rule in one place.
    await this.saveSettings();
  }

  private cancelPendingSettingsWrite(): void {
    if (this.pendingSettingsWrite !== null) {
      clearTimeout(this.pendingSettingsWrite);
      this.pendingSettingsWrite = null;
    }
  }

  // `managedOutputFolders` is append-only on its own — normalizeSettings folds
  // the folder currently in use into it on every save — so a vault that has
  // moved its output folder repeatedly keeps every folder it ever used in the
  // sweep set forever. A folder that no longer exists can hold nothing worth
  // sweeping, so it is dropped here; the folder in use is always kept, even
  // before it has been created on disk.
  private async pruneSettings(settings: GotSaengPluginSettings): Promise<GotSaengPluginSettings> {
    try {
      const { vaultRoot } = resolveOutputPath(this.app, settings.outputFolder);
      const existingFolders: string[] = [];
      for (const folder of settings.managedOutputFolders) {
        if (await this.fsAdapter.exists(path.resolve(vaultRoot, folder))) {
          existingFolders.push(folder);
        }
      }

      return {
        ...settings,
        managedOutputFolders: pruneManagedOutputFolders(
          settings.managedOutputFolders,
          settings.outputFolder,
          existingFolders,
        ),
      };
    } catch (error) {
      // Pruning is housekeeping, not part of the write the caller asked for:
      // an unreadable vault must not turn "save this setting" into a failure.
      console.error("GotSaeng OS: failed to prune managed output folders", error);
      return settings;
    }
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

  // The Report Hub asks for this on every render that rebuilds its backlink
  // index, so the reads run concurrently rather than one after another: they
  // are 17 independent files, and awaiting each in turn made the whole sweep
  // as slow as the sum of every read on a cold vault.
  async readAllOutputFiles(): Promise<Partial<Record<string, string>>> {
    const markdownArtifacts = OUTPUT_ARTIFACTS.filter((artifact) => artifact.format === "markdown");
    const contents = await Promise.all(
      markdownArtifacts.map(async (artifact) => this.readOutputFileByName(artifact.fileName)),
    );

    const files: Partial<Record<string, string>> = {};
    for (const [index, artifact] of markdownArtifacts.entries()) {
      const content = contents[index];
      if (content !== null && content !== undefined) {
        files[artifact.fileName] = content;
      }
    }

    return files;
  }

  // Never throws on a malformed report. `CompileReportSchema.parse` did, and
  // the throw happened before the view's render() had emptied its container —
  // so a single corrupt COMPILE_REPORT.json froze the Report Hub on stale
  // content permanently, with the cause visible only in the developer console.
  // output-cleanup.ts already read the same file with `safeParse`; this now
  // matches it, and reports the failure as a state the view can render.
  async readCurrentCompileReport(): Promise<CompileReportRead> {
    const pathInfo = resolveOutputPath(this.app, this.settings.outputFolder);
    // CompileReport carries no timestamp of its own, so the Report Hub's
    // "Latest Compile" block had no way to say whether it described the vault
    // as it is now or as it was weeks ago. ARTIFACT_INDEX.json is written by
    // the same writeContextPack() call from the same `pack.generatedAt`, and
    // is a fixed ~20-entry file rather than the item-level manifest, so it is
    // the cheap place to read that timestamp back from. Read alongside the
    // report rather than after it: this runs on every render.
    const [raw, indexRaw] = await Promise.all([
      this.fsAdapter.readText(path.join(pathInfo.outputDir, "COMPILE_REPORT.json")),
      // Isolated from the read that actually matters. `readText` can *throw*
      // rather than return null — the file removed between its exists() check
      // and the read itself, or a permissions error — and inside a bare
      // Promise.all that rejection would take the compile-report read down
      // with it, degrading the whole Report Hub to "could not be rendered"
      // over a timestamp that is only ever a display detail (see
      // parseArtifactIndexGeneratedAt). A failed read now degrades to a null
      // `generatedAt`, exactly like a malformed or missing one already does.
      this.fsAdapter.readText(path.join(pathInfo.outputDir, ARTIFACT_INDEX_FILE)).catch(() => null),
    ]);
    if (raw === null) {
      return { status: "missing" };
    }

    const report = parseCompileReport(raw);
    return report === null
      ? { status: "unreadable" }
      : { status: "ok", report, generatedAt: parseArtifactIndexGeneratedAt(indexRaw) };
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

  // Commands are serialized: every one of them compiles into (and cleans up)
  // the same output directory, so two overlapping runs interleave their writes
  // there. The Report Hub disables all four action buttons while one is in
  // flight, but the command palette and the ribbon icon can still fire a
  // second command directly — chaining here (the same pattern
  // applyOutputFolderChange uses for `pendingFolderChange`) covers every entry
  // point instead of only the buttons.
  private async runSafely(action: string, task: () => Promise<void>): Promise<void> {
    const scheduled = this.pendingCommand.then(
      () => this.runSafelyNow(action, task),
      () => this.runSafelyNow(action, task),
    );
    // The instance field only ever holds a never-rejecting promise so one
    // failed command cannot poison every command queued after it.
    this.pendingCommand = scheduled.catch(() => undefined);
    return scheduled;
  }

  private async runSafelyNow(action: string, task: () => Promise<void>): Promise<void> {
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

function logPluginError(context: string, error: unknown): void {
  console.error(`GotSaeng OS: ${context}`, error);
}

// Obsidian never awaits a command callback, a ribbon-icon handler, or a DOM
// event listener, so a promise started inside one is discarded: anything that
// rejects in it surfaces as an unhandled rejection rather than as something
// the developer console (or the user) can act on. Every fire-and-forget call
// routes through here, mirroring view.ts's safeRender().
function runDetached(context: string, task: () => Promise<unknown>): void {
  void task().catch((error: unknown) => {
    logPluginError(context, error);
  });
}

/** Exported for tests: parses COMPILE_REPORT.json, returning null when the
 * file is not a valid compile report (bad JSON or a failing schema check). */
export function parseCompileReport(raw: string): CompileReport | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const result = CompileReportSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

/** Exported for tests: pulls the compile timestamp out of ARTIFACT_INDEX.json,
 * returning null when the file is absent or is not a valid artifact index. A
 * missing timestamp is a display detail, never a reason to fail the read that
 * the Report Hub's whole stats block depends on. */
export function parseArtifactIndexGeneratedAt(raw: string | null): string | null {
  if (raw === null) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const result = ArtifactIndexSchema.safeParse(parsed);
  return result.success ? result.data.generatedAt : null;
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

// Deliberately version-free: this sentence used to name "v0.10" and went
// stale the moment the next release shipped. What it promises is a property of
// the plugin, not of one version of it.
const PRIVACY_NOTE = "Desktop-only local context compiler. Does not call AI services or sync data.";

// The user-facing name and description of every setting, in one place. Each of
// the six is rendered twice — once by getSettingDefinitions() for Obsidian
// >=1.13.0, once by display() for older hosts — and the two copies had drifted
// apart before. Kept as plain constant strings, not computed per render: the
// declarative path's `desc` is what Obsidian indexes for its global settings
// search, so a value that varies by state would make a setting findable only
// while the tab happens to be in that state. The one exception is the output
// folder path's description, which genuinely differs between editable and
// read-only mode; both of its variants are literals here for the same reason.
const SETTING_COPY = {
  projectName: {
    name: "Project name",
    desc: "Used in generated context pack headings.",
  },
  outputFolderVisibility: {
    name: "Output folder visibility",
    desc: "Hidden keeps generated files out of the file explorer. Visible makes output browsable as normal notes.",
  },
  outputFolderPath: {
    name: "Output folder path",
    // Says both of the things this field's behavior is surprising without:
    // that typing alone changes nothing, and that what happens when it does
    // commit is destructive.
    custom:
      "Enter a vault-relative folder path (for example: Notes/Context Pack). The new path applies when you press Enter or leave the field, and applying it deletes GotSaeng-generated files from the folder you are leaving.",
    readOnly:
      "Read-only unless visibility is Custom path. Generated files stay inside the current vault; switch to Custom path to edit this manually.",
  },
  staleDays: {
    name: "Stale days",
    desc: "Open items older than this threshold are reported as stale.",
  },
  strictValidation: {
    name: "Strict validation",
    desc: "Treat unsupported note types and unrecognized dates as errors.",
  },
  openAfterCompile: {
    name: "Open generated file",
    desc: "Open the primary generated report after each command.",
  },
} as const;

// The settings tab's section headings, shared by both render paths for the
// same reason SETTING_COPY is: six ungrouped rows spanning identity, output
// location and compile behavior read as one undifferentiated list, and a
// heading that says one thing on the declarative path and another on the
// imperative one is the drift SETTING_COPY exists to prevent. "Project name"
// stays above the first heading deliberately — it names the vault's context
// pack and belongs to no section below.
const SETTING_HEADINGS = {
  outputLocation: "Output location",
  compileBehavior: "Compile behavior",
} as const;

function outputFolderPathDesc(isCustomVisibility: boolean): string {
  return isCustomVisibility
    ? SETTING_COPY.outputFolderPath.custom
    : SETTING_COPY.outputFolderPath.readOnly;
}

// Stable identities for focus restoration across a wholesale rebuild of the
// tab (see FocusRestorer in a11y.ts).
const FOCUS_KEY_PROJECT_NAME = "setting:projectName";
const FOCUS_KEY_OUTPUT_FOLDER_VISIBILITY = "setting:outputFolderVisibility";
const FOCUS_KEY_OUTPUT_FOLDER_PATH = "setting:outputFolder";
const FOCUS_KEY_STALE_DAYS = "setting:staleDays";
const FOCUS_KEY_STRICT_VALIDATION = "setting:strictValidation";
const FOCUS_KEY_OPEN_AFTER_COMPILE = "setting:openAfterCompile";

const OUTPUT_FOLDER_PATH_ERROR_ID = "gotsaeng-os-output-folder-error";
const STALE_DAYS_ERROR_ID = "gotsaeng-os-stale-days-error";

class GotSaengSettingTab extends PluginSettingTab {
  // Transient UI-only state, never persisted: true from the moment the
  // visibility dropdown is switched to "Custom path" until the resulting
  // blur commit resolves (accepted or declined). Lets the path field unlock
  // and the dropdown show "Custom path" immediately, without writing
  // `outputFolderVisibility: "custom"` to plugin.settings before an actual
  // custom folder is committed — see buildOutputFolderVisibilitySetting for
  // why an eager settings write here was the root cause of issue #26.
  private isEditingCustomPath = false;
  // True from the moment a custom-path commit starts until it has fully
  // settled, confirm-modal round trip included. See `commit` in
  // buildOutputFolderPathSetting for what re-enters it and why comparing the
  // field against the persisted settings cannot stand in for this.
  private commitInFlight = false;
  // Both render paths rebuild the whole tab, which drops keyboard focus to
  // <body>. This restores it to whatever the user was on — the field they
  // just edited, or the control the rebuild was triggered from. It replaces
  // the old one-shot `shouldFocusCustomPath` flag, which covered only the
  // transition into custom-path mode (picking Hidden or Visible lost focus
  // outright) and cleared itself before confirming focus had actually landed.
  private readonly focus = new FocusRestorer();

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
  //
  // Only those two rows register focus keys here, and that is deliberate: a
  // `control` definition hands the host a value contract, not an element, so
  // there is nothing for FocusRestorer to tag. It is also not needed — the
  // only thing that tears this tab down is refreshDeclarative(), which only
  // these two render() rows ever call, so a native control is never the
  // control focus was lost from. Converting the other four to render() purely
  // to tag them would trade away the native controls (and the
  // getControlValue/setControlValue contract, and app-level settings search
  // integration) for restoration of focus they never lose.
  override getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        // Nameless status row: the privacy assurance and the aggregate
        // validation alert. Both used to live only in display(), which
        // Obsidian >=1.13.0 never calls once getSettingDefinitions() returns
        // items — so on every current host they rendered nowhere at all.
        name: "",
        searchable: false,
        render: (setting) => {
          setting.settingEl.addClass("gotsaeng-os-setting-status");
          this.buildSettingsStatus(setting.settingEl);
        },
      },
      {
        ...SETTING_COPY.projectName,
        control: {
          type: "text",
          key: "projectName",
          defaultValue: DEFAULT_SETTINGS.projectName,
        },
      },
      {
        type: "group",
        heading: SETTING_HEADINGS.outputLocation,
        items: [
          {
            ...SETTING_COPY.outputFolderVisibility,
            render: (setting) => {
              this.buildOutputFolderVisibilitySetting(setting, () => this.refreshDeclarative());
            },
          },
          {
            name: SETTING_COPY.outputFolderPath.name,
            desc: outputFolderPathDesc(this.effectiveOutputFolderVisibility === "custom"),
            render: (setting) => {
              this.buildOutputFolderPathSetting(setting, () => this.refreshDeclarative());
            },
          },
        ],
      },
      {
        type: "group",
        heading: SETTING_HEADINGS.compileBehavior,
        items: [
          {
            ...SETTING_COPY.staleDays,
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
            ...SETTING_COPY.strictValidation,
            control: {
              type: "toggle",
              key: "strictValidation",
              defaultValue: DEFAULT_SETTINGS.strictValidation,
            },
          },
          {
            ...SETTING_COPY.openAfterCompile,
            control: {
              type: "toggle",
              key: "openAfterCompile",
              defaultValue: DEFAULT_SETTINGS.openAfterCompile,
            },
          },
        ],
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
        // Symmetric with setControlValue below: an unrecognized key is a bug
        // in this file's own definitions, not a value to paper over by
        // silently handing the host `undefined` to render a control from.
        throw new Error(`Unknown setting key: ${key}`);
    }
  }

  override async setControlValue(key: string, value: unknown): Promise<void> {
    switch (key) {
      case "projectName":
        // In memory immediately (so the value in use is always what the field
        // shows), on disk once typing settles — the host calls this per
        // keystroke, and each write normalizes, prunes and re-serializes the
        // whole settings object. hide() below flushes whatever is still
        // pending when the tab closes.
        this.plugin.settings.projectName = expectString(key, value);
        this.plugin.saveSettingsDebounced();
        return;
      case "staleDays": {
        const updated = updateSettingsWithStaleDaysInput(
          this.plugin.settings,
          String(expectNumber(key, value)),
        );
        if (updated) {
          this.plugin.settings = updated;
          await this.plugin.saveSettings();
        }
        return;
      }
      case "strictValidation":
        this.plugin.settings.strictValidation = expectBoolean(key, value);
        await this.plugin.saveSettings();
        return;
      case "openAfterCompile":
        this.plugin.settings.openAfterCompile = expectBoolean(key, value);
        await this.plugin.saveSettings();
        return;
      default:
        throw new Error(`Unknown setting key: ${key}`);
    }
  }

  // display() and the declarative path's update() are each other's
  // counterparts (see the class-level comment on getSettingDefinitions), and
  // both tear the tab down wholesale — so both have to record where focus was
  // first. display() does it itself; update() is the framework's method, so
  // the capture is wrapped around it here.
  private refreshDeclarative(): void {
    this.focus.capture();
    this.update();
  }

  // The privacy assurance plus the aggregate validation alert, rendered by
  // display() and by the declarative status row alike so neither host version
  // is missing one of them.
  //
  // Unlike the Report Hub's regions (see ReportHubShell in view.ts) this alert
  // cannot outlive its render: Obsidian owns the settings-tab lifecycle and
  // rebuilds the row wholesale, so there is no element to keep. It is a
  // load-time report rather than something that changes while the tab is open,
  // which is what the region is for — the surfaces that *do* change in place
  // are the per-field error regions built by buildFieldError, and those are
  // created empty and written into later, on blur.
  private buildSettingsStatus(container: HTMLElement): void {
    container.createEl("p", { text: PRIVACY_NOTE, cls: "gotsaeng-os-setting-note" });

    const alert = createLiveRegion(container, "gotsaeng-os-setting-warning", "assertive");
    // Two sources, because they can only ever fire in different situations:
    // `settingsIssues` reports what the persisted data got coerced out of at
    // load time (the only way real, saved data can be invalid — see
    // getPersistedSettingsIssues), while getSettingsValidationMessages is the
    // defensive check against a live `settings` object that reached this point
    // without going through normalizeSettings.
    const validationMessages = [
      ...this.plugin.settingsIssues,
      ...getSettingsValidationMessages(this.plugin.settings),
    ];
    if (validationMessages.length === 0) {
      return;
    }

    alert.createEl("strong", { text: "Settings need attention" });
    const list = alert.createEl("ul");
    for (const message of validationMessages) {
      list.createEl("li", { text: message });
    }
  }

  // Per-field error surface for the two settings that can't use the
  // declarative API's native `validate` (they are `render` escape hatches —
  // see getSettingDefinitions). Returns a setter so the caller reports a
  // message, or clears one, without rebuilding anything. The region is created
  // empty on every build so an announcement actually fires when a message
  // lands in it later, and it is tied to its input via
  // aria-invalid/aria-describedby so the error is associated with the field it
  // belongs to instead of floating loose in the tab.
  private buildFieldError(
    setting: Setting,
    errorId: string,
    input: HTMLElement,
  ): (message: string | null) => void {
    const error = createLiveRegion(setting.settingEl, "gotsaeng-os-setting-error", "assertive");
    error.setAttr("id", errorId);

    return (message: string | null) => {
      error.empty();
      if (message === null) {
        input.setAttr("aria-invalid", "false");
        input.removeAttribute("aria-describedby");
        return;
      }

      error.setText(message);
      input.setAttr("aria-invalid", "true");
      input.setAttr("aria-describedby", errorId);
    };
  }

  // Closing the settings tab is the last moment a value typed into it can
  // still be committed: the elements go away, so a deferred write with no
  // flush here would be waiting on a timer nothing is left to trigger early.
  override hide(): void {
    runDetached("failed to flush a pending settings write", () =>
      this.plugin.flushPendingSettingsWrite(),
    );
  }

  // Fallback for Obsidian <1.13.0, where getSettingDefinitions() does not
  // exist and this is the only way settings render at all.
  override display(): void {
    const { containerEl } = this;
    this.focus.capture();
    containerEl.empty();

    this.buildSettingsStatus(containerEl);

    new Setting(containerEl)
      .setName(SETTING_COPY.projectName.name)
      .setDesc(SETTING_COPY.projectName.desc)
      .addText((text) => {
        text
          .setPlaceholder(DEFAULT_SETTINGS.projectName)
          .setValue(this.plugin.settings.projectName)
          // Same deferred write as the declarative path's projectName case
          // (see setControlValue), so both hosts behave identically.
          .onChange((value) => {
            this.plugin.settings.projectName = value;
            this.plugin.saveSettingsDebounced();
          });
        // Leaving the field is a commit point: no reason to keep the user's
        // last keystrokes waiting on a timer once they have moved on.
        text.inputEl.addEventListener("blur", () => {
          runDetached("failed to save the project name", () =>
            this.plugin.flushPendingSettingsWrite(),
          );
        });
        this.focus.register(FOCUS_KEY_PROJECT_NAME, text.inputEl);
      });

    // The imperative equivalent of the declarative path's `type: "group"`
    // wrappers: Obsidian's own heading rows, same headings, same order.
    new Setting(containerEl).setName(SETTING_HEADINGS.outputLocation).setHeading();
    this.buildOutputFolderVisibilitySetting(new Setting(containerEl), () => this.display());
    this.buildOutputFolderPathSetting(new Setting(containerEl), () => this.display());

    new Setting(containerEl).setName(SETTING_HEADINGS.compileBehavior).setHeading();
    this.buildStaleDaysSetting(new Setting(containerEl));

    new Setting(containerEl)
      .setName(SETTING_COPY.strictValidation.name)
      .setDesc(SETTING_COPY.strictValidation.desc)
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.strictValidation).onChange(async (value) => {
          this.plugin.settings.strictValidation = value;
          await this.plugin.saveSettings();
        });
        this.focus.register(FOCUS_KEY_STRICT_VALIDATION, toggle.toggleEl);
      });

    new Setting(containerEl)
      .setName(SETTING_COPY.openAfterCompile.name)
      .setDesc(SETTING_COPY.openAfterCompile.desc)
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.openAfterCompile).onChange(async (value) => {
          this.plugin.settings.openAfterCompile = value;
          await this.plugin.saveSettings();
        });
        this.focus.register(FOCUS_KEY_OPEN_AFTER_COMPILE, toggle.toggleEl);
      });
  }

  // display()-only: the declarative path expresses this as a native `number`
  // control whose `validate` callback surfaces the same message inline (and
  // re-checks the seeded value on mount). This is the imperative equivalent —
  // an inline, field-associated error rather than the transient Notice and
  // silent revert it used to be, which left no persistent surface at all for a
  // rejected value.
  private buildStaleDaysSetting(setting: Setting): void {
    setting
      .setName(SETTING_COPY.staleDays.name)
      .setDesc(SETTING_COPY.staleDays.desc)
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = "1";
        const setError = this.buildFieldError(setting, STALE_DAYS_ERROR_ID, text.inputEl);
        // The framework's `validate` runs once on mount against the seeded
        // value; match that on this path too, so a settings object that is
        // already invalid says so before the user touches anything.
        setError(validateStaleDaysInput(String(this.plugin.settings.staleDays))[0] ?? null);

        text.setValue(String(this.plugin.settings.staleDays)).onChange(async (value) => {
          const updatedSettings = updateSettingsWithStaleDaysInput(this.plugin.settings, value);
          if (!updatedSettings) {
            return;
          }

          setError(null);
          this.plugin.settings = updatedSettings;
          await this.plugin.saveSettings();
        });
        text.inputEl.addEventListener("blur", () => {
          const validationMessages = validateStaleDaysInput(text.inputEl.value);
          if (validationMessages.length === 0) {
            setError(null);
            return;
          }

          setError(validationMessages[0] ?? null);
          new Notice(`GotSaeng OS settings: ${validationMessages[0]}`);
          text.setValue(String(this.plugin.settings.staleDays));
        });
        this.focus.register(FOCUS_KEY_STALE_DAYS, text.inputEl);
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
      .setName(SETTING_COPY.outputFolderVisibility.name)
      .setDesc(SETTING_COPY.outputFolderVisibility.desc)
      .addDropdown((dropdown) => {
        dropdown
          .addOption("hidden", `Hidden system folder (${HIDDEN_OUTPUT_FOLDER})`)
          .addOption("visible", `Visible vault folder (${VISIBLE_OUTPUT_FOLDER})`)
          .addOption("custom", "Custom path")
          .setValue(this.effectiveOutputFolderVisibility)
          .onChange(async (value) => {
            // Obsidian discards the promise this async handler returns, so a
            // rejection inside it would be an unhandled rejection rather than
            // a logged failure — the whole body is guarded (see runDetached).
            try {
              await this.applyVisibilitySelection(value as OutputFolderVisibility, refresh);
            } catch (error) {
              logPluginError("failed to change the output folder visibility", error);
            }
          });
        this.focus.register(FOCUS_KEY_OUTPUT_FOLDER_VISIBILITY, dropdown.selectEl);
      });
  }

  private async applyVisibilitySelection(
    visibility: OutputFolderVisibility,
    refresh: () => void,
  ): Promise<void> {
    // Hidden/Visible route through applyOutputFolderChange immediately,
    // sharing the command-palette commands' confirm-before-delete gate.
    // "Custom path" does NOT write to plugin.settings here — it only flips
    // transient UI state to unlock and focus the text field. Persisting
    // `outputFolderVisibility: "custom"` before an actual custom folder is
    // committed left a window (including a declined blur commit) where
    // settings said "custom" while outputFolder still pointed at a built-in
    // folder (issue #26).
    if (visibility === "hidden" || visibility === "visible") {
      this.isEditingCustomPath = false;
      // Focus follows the control the user actually operated. Only the
      // transition into custom mode used to restore focus at all, so picking
      // Hidden or Visible dropped focus to <body> when the rebuild landed.
      this.focus.request(FOCUS_KEY_OUTPUT_FOLDER_VISIBILITY);
      await this.plugin.switchOutputFolderVisibility(visibility);
    } else {
      this.isEditingCustomPath = true;
      // Requested *before* refresh() so the rebuild honors it. FocusRestorer
      // gives an explicit request priority over what capture() finds, which
      // here is the still-focused dropdown carrying a focus key of its own —
      // without that priority the request was clobbered and "Custom path"
      // never focused the field (issue #25).
      this.focus.request(FOCUS_KEY_OUTPUT_FOLDER_PATH);
    }
    refresh();
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
      .setName(SETTING_COPY.outputFolderPath.name)
      .setDesc(outputFolderPathDesc(isCustomVisibility))
      .addText((text) => {
        text
          .setPlaceholder(DEFAULT_SETTINGS.outputFolder)
          .setValue(this.plugin.settings.outputFolder);
        // `readonly`, not `disabled`. Outside custom mode this field is the
        // only place the output folder actually in use is written down, and a
        // disabled input is removed from the tab order and cannot have its
        // text selected or copied — so the one thing it is there for was
        // unreachable by keyboard and awkward with a mouse. Read-only keeps it
        // focusable and selectable; what stops an edit from committing is the
        // visibility check in commitCustomOutputFolder below, which is where
        // that rule belongs anyway.
        text.inputEl.readOnly = !isCustomVisibility;
        text.inputEl.setAttr("aria-readonly", String(!isCustomVisibility));
        const setError = this.buildFieldError(setting, OUTPUT_FOLDER_PATH_ERROR_ID, text.inputEl);
        // Same mount-time check the declarative API's native `validate` does
        // for the control-type settings: a persisted value that is already
        // invalid says so before the user touches the field.
        setError(
          isCustomVisibility
            ? (validateCustomOutputFolderInput(this.plugin.settings.outputFolder)[0] ?? null)
            : null,
        );
        const commit = (): void => {
          // Re-entrancy guard, and it has to be synchronous and separate from
          // the value comparison below. Enter and blur share this function,
          // and a commit that opens the confirm modal takes focus away from
          // the still-focused input — so the modal's own appearance (or a
          // mousedown on one of its buttons) fires `blur`, re-entering
          // commit() while the first call is still awaiting the user's
          // answer. At that instant the settings comparison is still false —
          // the first commit has not written anything yet — so the second
          // call would queue another applyOutputFolderChange behind the
          // first. Neither call supersedes the other, so folderChangeGeneration
          // does not cancel it: declining the first dialog would be followed
          // by a second dialog for the same change, whose "Delete and switch"
          // deletes exactly the files the user just declined to delete.
          if (this.commitInFlight) {
            return;
          }

          this.commitInFlight = true;
          runDetached("failed to commit the custom output folder", async () => {
            try {
              // No-op guards: a plain focus-then-blur with no edit (e.g. just
              // tabbing through the form, or the auto-focus below) must not
              // enter the async commit path at all (issue #22) — and neither
              // must anything typed while the field is read-only, which is what
              // replaces `disabled` as the thing preventing an edit here.
              if (!isCustomVisibility || text.inputEl.value === this.plugin.settings.outputFolder) {
                return;
              }

              const validationMessages = validateCustomOutputFolderInput(text.inputEl.value);
              if (validationMessages.length > 0) {
                setError(validationMessages[0] ?? null);
                new Notice(`GotSaeng OS settings: ${validationMessages[0]}`);
                text.setValue(this.plugin.settings.outputFolder);
                return;
              }

              setError(null);
              await this.plugin.applyCustomOutputFolder(text.inputEl.value);
              // Re-sync the field with what actually persisted — unchanged when
              // the user declined the confirmation.
              text.setValue(this.plugin.settings.outputFolder);
              // Belt and suspenders for the confirm-modal round trip: the modal
              // takes focus off this field and closes it again, and its focus
              // handling is Obsidian's, not something FocusRestorer tracks — so
              // the refresh() below could rebuild the tab with focus sitting on
              // <body>. Requested for both outcomes, because accepting and
              // declining are both the end of the same gesture, and requested
              // *before* refresh() so the rebuild honors it (see
              // applyVisibilitySelection). A no-op when focus is already right.
              this.focus.request(FOCUS_KEY_OUTPUT_FOLDER_PATH);
              // The commit settled (accepted or declined either way): the
              // transient "entering custom mode" state is no longer needed —
              // plugin.settings.outputFolderVisibility now reflects reality on
              // its own (either genuinely "custom", or reverted to whatever it
              // was before, matching the folder actually in use — issue #26).
              this.isEditingCustomPath = false;
              refresh();
            } finally {
              // Cleared only once the whole commit has settled, the confirm
              // modal included — an early clear would reopen the very window
              // the flag exists to close.
              this.commitInFlight = false;
            }
          });
        };

        // Commit on blur, not per keystroke: a half-typed path is not a folder
        // the user meant to move output into, and committing each keystroke
        // would fire applyOutputFolderChange's confirmation once per character.
        text.inputEl.addEventListener("blur", commit);
        // Enter is what a text field in a form is expected to commit on, and
        // this one had no handler for it at all — a user who typed a path and
        // pressed Enter saw nothing happen and no reason why. Routed through
        // the same `commit` as blur so the generation-counter serialization
        // and focus restoration behave identically either way; the blur that
        // follows re-enters commit() and stops at one of its two guards —
        // the in-flight flag while the commit is still running (the confirm
        // modal is what blurs the field in the first place), and the value
        // comparison once it has settled and field and settings agree.
        text.inputEl.addEventListener("keydown", (event: KeyboardEvent) => {
          // The visibility check comes first, before preventDefault. Outside
          // custom mode this field is read-only but still focusable and still
          // in the tab order (see the `readOnly` note above), so a keyboard
          // user lands on it while moving through the form. There is no commit
          // to protect there, and swallowing their Enter would suppress
          // Obsidian's own settings-modal handling of it for no reason.
          if (event.key !== "Enter" || !isCustomVisibility) {
            return;
          }

          // Obsidian's settings modal treats Enter as "close"; committing a
          // folder change and dismissing the tab out from under the
          // confirmation dialog are not the same gesture.
          event.preventDefault();
          commit();
        });
        this.focus.register(FOCUS_KEY_OUTPUT_FOLDER_PATH, text.inputEl);
      });
  }
}

// The declarative settings API hands values back as `unknown`, so each key
// checks the type it actually stores instead of asserting one with `as`. A
// mismatch is rejected exactly the way an unknown key already is, rather than
// being written into settings and only failing somewhere further downstream.
function expectString(key: string, value: unknown): string {
  if (typeof value !== "string") {
    throw new Error(`Expected a string value for setting key: ${key}`);
  }

  return value;
}

function expectNumber(key: string, value: unknown): number {
  if (typeof value !== "number") {
    throw new Error(`Expected a number value for setting key: ${key}`);
  }

  return value;
}

function expectBoolean(key: string, value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Expected a boolean value for setting key: ${key}`);
  }

  return value;
}
