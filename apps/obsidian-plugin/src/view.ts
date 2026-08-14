import type { CompileReport } from "@gotsaeng/core";
import { ItemView, MarkdownRenderer, type WorkspaceLeaf } from "obsidian";

import { DEFAULT_OUTPUT_ARTIFACT, groupOutputArtifacts, type OutputArtifact } from "./artifacts";
import type { GotSaengPluginSettings } from "./settings";
import {
  buildBacklinkIndex,
  extractSourceLinks,
  type NoteBacklinks,
  type SourceLink,
} from "./source-links";

export const GOTSAENG_REPORT_VIEW_TYPE = "gotsaeng-report-hub";

const BACKLINK_NOTE_LIMIT = 20;
const BACKLINK_REPORT_LIMIT = 6;
const ARTIFACT_GROUPS = groupOutputArtifacts();

// A command failure recorded by `runSafely` (main.ts). Carries enough to
// distinguish "the run that just happened" from a stale failure from 40
// minutes ago (see the error-banner dismiss/timestamp fix), instead of a bare
// pre-formatted string.
export type ReportHubLastError = {
  action: string;
  message: string;
  timestamp: number;
};

export type ReportHubController = {
  settings: GotSaengPluginSettings;
  selectedOutputFileName: string | null;
  lastError: ReportHubLastError | null;
  compileContextPackCommand(): Promise<void>;
  generateWeeklyReviewCommand(): Promise<void>;
  exportLlmHandoffCommand(): Promise<void>;
  validateVaultSchemaCommand(): Promise<void>;
  setSelectedOutputFileName(fileName: string): void;
  readOutputFileByName(fileName: string): Promise<string | null>;
  readAllOutputFiles(): Promise<Partial<Record<string, string>>>;
  openOutputFileByName(fileName: string): Promise<void>;
  openSourceFileByPath(sourcePath: string): Promise<void>;
  readCurrentCompileReport(): Promise<CompileReport | null>;
  dismissLastError(): void;
  refreshReportHubViews(): Promise<void>;
};

/** Exported for tests: formats a `ReportHubLastError.timestamp` for display. */
export function formatErrorTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString();
}

export class GotSaengReportHubView extends ItemView {
  override icon = "file-text";
  override navigation = false;

  // Preserved across renders so re-opening the view (or a re-render triggered
  // by an unrelated action) does not silently reset an in-progress filter.
  private artifactFilterQuery = "";

  // Label of the action currently in flight, if any. Every command action
  // (Compile, Weekly Review, LLM Handoff) calls the plugin's
  // refreshReportHubViews() partway through its own work (see main.ts),
  // which re-renders this leaf — including the button runAndRefresh is still
  // awaiting — before the outer action() promise settles. Without this field
  // surviving that render(), the rebuilt button would come back enabled with
  // its normal label, making the in-progress indicator disappear early and
  // letting the user fire a second overlapping command. render() consults
  // this field on every button it creates, so the running state survives any
  // render() call regardless of what triggered it.
  private runningActionLabel: string | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly controller: ReportHubController,
  ) {
    super(leaf);
  }

  override getViewType(): string {
    return GOTSAENG_REPORT_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return "GotSaeng OS";
  }

  override async onOpen(): Promise<void> {
    await this.render();
  }

  async render(): Promise<void> {
    const report = await this.controller.readCurrentCompileReport();
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("gotsaeng-os-report-view");

    contentEl.createEl("h2", { text: "GotSaeng OS" });
    contentEl.createEl("p", {
      text: "Local context compiler for the current vault.",
      cls: "gotsaeng-os-view-note",
    });

    if (this.controller.lastError) {
      this.renderErrorBanner(contentEl, this.controller.lastError);
    }

    const actions = contentEl.createDiv({ cls: "gotsaeng-os-action-grid" });
    this.addActionButton(actions, "Compile", () => this.controller.compileContextPackCommand());
    this.addActionButton(actions, "Weekly Review", () =>
      this.controller.generateWeeklyReviewCommand(),
    );
    this.addActionButton(actions, "LLM Handoff", () => this.controller.exportLlmHandoffCommand());
    this.addActionButton(actions, "Validate", () => this.controller.validateVaultSchemaCommand());

    contentEl.createEl("h3", { text: "Latest Compile" });
    const stats = contentEl.createDiv({ cls: "gotsaeng-os-stats" });
    if (report) {
      this.addStat(stats, "Files", String(report.filesScanned));
      this.addStat(stats, "Markdown", String(report.markdownFilesParsed));
      this.addStat(stats, "Items", String(report.extractionStats?.totalItems ?? 0));
      this.addStat(stats, "Warnings", String(report.warnings.length));
      this.addStat(stats, "Parse errors", String(report.parseErrors.length));
      this.addStat(
        stats,
        "Missing updated",
        String(report.sourceCoverage?.notesMissingUpdated ?? 0),
      );
      this.addStat(stats, "Avg provenance", String(report.provenanceStats?.averageScore ?? 0));
      this.addStat(stats, "Weak provenance", String(report.provenanceStats?.weakItems ?? 0));
      this.addStat(stats, "Avg confidence", String(report.confidenceStats?.averageScore ?? 0));
      this.addStat(stats, "Low confidence", String(report.confidenceStats?.lowItems ?? 0));
      this.addStat(
        stats,
        "Contradictions",
        String(report.contradictionStats?.totalCandidates ?? 0),
      );
    } else {
      stats.createEl("p", {
        text: "No compile report found yet. Run Compile to create one.",
        cls: "gotsaeng-os-view-note",
      });
    }

    contentEl.createEl("h3", { text: "Output" });
    contentEl.createEl("p", {
      text: `${this.controller.settings.outputFolder} (${this.controller.settings.outputFolderVisibility})`,
      cls: "gotsaeng-os-output-path",
    });

    contentEl.createEl("h3", { text: "Context Pack Files" });
    contentEl.createEl("p", {
      text: "Hidden folders stay out of the file explorer, but generated files can still be read here.",
      cls: "gotsaeng-os-view-note",
    });
    const selectedFileName =
      this.controller.selectedOutputFileName ?? DEFAULT_OUTPUT_ARTIFACT.fileName;
    this.renderArtifactFiles(contentEl, selectedFileName);

    await this.renderArtifactPreview(contentEl, selectedFileName);
    await this.renderBacklinks(contentEl);
  }

  private addActionButton(parent: HTMLElement, label: string, action: () => Promise<void>): void {
    const button = parent.createEl("button", { text: label, cls: "gotsaeng-os-button" });
    if (this.runningActionLabel === label) {
      this.applyRunningState(button, label);
    }
    button.addEventListener("click", () => {
      void this.runAndRefresh(button, label, action);
    });
  }

  private applyRunningState(button: HTMLElement & { disabled: boolean }, label: string): void {
    button.disabled = true;
    button.addClass("is-running");
    button.setAttr("aria-busy", "true");
    button.setText(`${label}…`);
  }

  private renderErrorBanner(parent: HTMLElement, lastError: ReportHubLastError): void {
    const banner = parent.createDiv({ cls: "gotsaeng-os-error-banner" });
    banner.createEl("span", {
      text: `${lastError.action} · ${formatErrorTimestamp(lastError.timestamp)}`,
      cls: "gotsaeng-os-error-banner-meta",
    });
    banner.createEl("span", {
      text: lastError.message,
      cls: "gotsaeng-os-error-banner-message",
    });

    const dismissButton = banner.createEl("button", {
      text: "×",
      cls: "gotsaeng-os-error-banner-dismiss",
      attr: { "aria-label": "Dismiss error", type: "button" },
    });
    // Clears independently of running another command — the banner previously
    // stuck around until the *next successful run of any command*, which a
    // user just browsing other reports (which never fail) had no way to
    // trigger while still reading the error. `lastError` is shared plugin
    // state, not per-leaf, so a workspace with multiple Report Hub leaves
    // open needs every leaf refreshed, not just the one the click happened
    // in — otherwise the other leaves keep showing a banner for an error
    // that has already been dismissed.
    dismissButton.addEventListener("click", () => {
      this.controller.dismissLastError();
      void this.controller.refreshReportHubViews();
    });
  }

  // Renders the "Context Pack Files" artifact grid: a filter input above
  // grouped buttons. Filtering toggles button/heading visibility in place
  // (via HTMLElement.toggle) rather than going through a full `render()`, so
  // the input keeps DOM identity (and focus) across keystrokes.
  private renderArtifactFiles(parent: HTMLElement, selectedFileName: string): void {
    const filterInput = parent.createEl("input", {
      cls: "gotsaeng-os-artifact-filter",
      attr: {
        type: "search",
        placeholder: "Filter files by name…",
        "aria-label": "Filter context pack files",
      },
    });
    filterInput.value = this.artifactFilterQuery;

    const sections: {
      heading: HTMLElement;
      grid: HTMLElement;
      entries: { button: HTMLElement; label: string }[];
    }[] = [];

    for (const section of ARTIFACT_GROUPS) {
      const headingId = `gotsaeng-os-artifact-group-${section.group}`;
      const heading = parent.createEl("h4", {
        text: section.label,
        cls: "gotsaeng-os-artifact-group-heading",
        attr: { id: headingId },
      });
      const grid = parent.createDiv({
        cls: "gotsaeng-os-artifact-grid",
        attr: { role: "group", "aria-labelledby": headingId },
      });
      const entries = section.artifacts.map((artifact) => ({
        button: this.addArtifactButton(grid, artifact, selectedFileName),
        label: artifact.label,
      }));
      sections.push({ heading, grid, entries });
    }

    const applyArtifactFilter = (query: string): void => {
      this.artifactFilterQuery = query;
      const needle = query.trim().toLowerCase();
      for (const { heading, grid, entries } of sections) {
        let visibleCount = 0;
        for (const { button, label } of entries) {
          const matches = needle === "" || label.toLowerCase().includes(needle);
          button.toggle(matches);
          if (matches) {
            visibleCount += 1;
          }
        }
        heading.toggle(visibleCount > 0);
        grid.toggle(visibleCount > 0);
      }
    };

    filterInput.addEventListener("input", () => applyArtifactFilter(filterInput.value));
    applyArtifactFilter(this.artifactFilterQuery);
  }

  private addArtifactButton(
    parent: HTMLElement,
    artifact: OutputArtifact,
    selectedFileName: string,
  ): HTMLElement {
    const isActive = artifact.fileName === selectedFileName;
    const button = parent.createEl("button", {
      text: artifact.label,
      cls: "gotsaeng-os-artifact-button",
      attr: { "aria-pressed": String(isActive) },
    });
    if (isActive) {
      button.addClass("is-active");
    }
    button.addEventListener("click", () => {
      this.controller.setSelectedOutputFileName(artifact.fileName);
      void this.render();
    });
    return button;
  }

  private addStat(parent: HTMLElement, label: string, value: string): void {
    const stat = parent.createDiv({ cls: "gotsaeng-os-stat" });
    stat.createEl("span", { text: label, cls: "gotsaeng-os-stat-label" });
    stat.createEl("strong", { text: value });
  }

  // Disables the clicked button for the duration of the async command so a
  // user can't fire overlapping compiles by clicking repeatedly, and swaps
  // its label/aria-busy so a slow command reads as "running", not just
  // "disabled and maybe broken". `runningActionLabel` is set for the whole
  // duration of action(), not just this call's disabled flag, because
  // action() itself triggers a mid-flight refreshReportHubViews() render()
  // that rebuilds this button — addActionButton re-applies the running state
  // to the new element as long as runningActionLabel still matches. Clearing
  // the field and calling render() once more after action() settles restores
  // the normal label/enabled state without any other explicit teardown.
  private async runAndRefresh(
    button: HTMLElement & { disabled: boolean },
    label: string,
    action: () => Promise<void>,
  ): Promise<void> {
    if (button.disabled) {
      return;
    }

    this.runningActionLabel = label;
    this.applyRunningState(button, label);
    await action();
    this.runningActionLabel = null;
    await this.render();
  }

  private async renderArtifactPreview(parent: HTMLElement, fileName: string): Promise<void> {
    const artifact =
      ARTIFACT_GROUPS.flatMap((section) => section.artifacts).find(
        (item) => item.fileName === fileName,
      ) ?? DEFAULT_OUTPUT_ARTIFACT;
    const filePath = `${this.controller.settings.outputFolder}/${artifact.fileName}`;

    parent.createEl("h3", { text: artifact.label });
    parent.createEl("p", {
      text: filePath,
      cls: "gotsaeng-os-output-path",
    });

    const content = await this.controller.readOutputFileByName(artifact.fileName);
    if (content === null) {
      parent.createEl("p", {
        text: `No ${artifact.fileName} file found yet. Run the matching command or Compile first.`,
        cls: "gotsaeng-os-view-note",
      });
      return;
    }

    this.renderSourceLinks(
      parent,
      extractSourceLinks(content, { outputFolder: this.controller.settings.outputFolder }),
    );

    const preview = parent.createDiv({ cls: "gotsaeng-os-artifact-preview" });
    if (artifact.format === "json") {
      preview.createEl("pre").createEl("code", { text: formatJson(content) });
      return;
    }

    await MarkdownRenderer.render(this.app, content, preview, filePath, this);
  }

  private async renderBacklinks(parent: HTMLElement): Promise<void> {
    parent.createEl("h3", { text: "Backlinks" });
    parent.createEl("p", {
      text: "Source notes referenced across every generated report, most-referenced first.",
      cls: "gotsaeng-os-view-note",
    });

    const files = await this.controller.readAllOutputFiles();
    const backlinks = buildBacklinkIndex(files, {
      outputFolder: this.controller.settings.outputFolder,
    }).slice(0, BACKLINK_NOTE_LIMIT);

    if (backlinks.length === 0) {
      parent.createEl("p", {
        text: "No source-note backlinks found yet. Run Compile first.",
        cls: "gotsaeng-os-view-note",
      });
      return;
    }

    const list = parent.createDiv({ cls: "gotsaeng-os-backlink-list" });
    for (const note of backlinks) {
      this.addBacklinkEntry(list, note);
    }
  }

  private addBacklinkEntry(parent: HTMLElement, note: NoteBacklinks): void {
    const entry = parent.createDiv({ cls: "gotsaeng-os-backlink-entry" });
    const button = entry.createEl("button", {
      text: `${note.label} (${note.totalCount})`,
      cls: "gotsaeng-os-backlink-note-button",
    });
    button.title = note.path;
    button.addEventListener("click", () => {
      void this.controller.openSourceFileByPath(note.path);
    });

    entry.createEl("p", {
      text: note.reports
        .slice(0, BACKLINK_REPORT_LIMIT)
        .map((report) => (report.count > 1 ? `${report.label} (${report.count})` : report.label))
        .join(", "),
      cls: "gotsaeng-os-backlink-reports",
    });
  }

  private renderSourceLinks(parent: HTMLElement, sourceLinks: SourceLink[]): void {
    const panel = parent.createDiv({ cls: "gotsaeng-os-source-panel" });
    panel.createEl("h4", { text: "Source Notes" });

    if (sourceLinks.length === 0) {
      panel.createEl("p", {
        text: "No source-note links found in this preview.",
        cls: "gotsaeng-os-view-note",
      });
      return;
    }

    const grid = panel.createDiv({ cls: "gotsaeng-os-source-grid" });
    for (const sourceLink of sourceLinks) {
      const button = grid.createEl("button", {
        text: formatSourceLinkLabel(sourceLink),
        cls: "gotsaeng-os-source-button",
      });
      button.title = sourceLink.path;
      button.addEventListener("click", () => {
        void this.controller.openSourceFileByPath(sourceLink.path);
      });
    }
  }
}

function formatJson(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}

function formatSourceLinkLabel(sourceLink: SourceLink): string {
  return sourceLink.count > 1 ? `${sourceLink.label} (${sourceLink.count})` : sourceLink.label;
}
