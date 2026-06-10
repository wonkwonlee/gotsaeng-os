import type { CompileReport } from "@gotsaeng/core";
import { ItemView, MarkdownRenderer, type WorkspaceLeaf } from "obsidian";

import { DEFAULT_OUTPUT_ARTIFACT, OUTPUT_ARTIFACTS, type OutputArtifact } from "./artifacts";
import type { GotSaengPluginSettings } from "./settings";
import { extractSourceLinks, type SourceLink } from "./source-links";

export const GOTSAENG_REPORT_VIEW_TYPE = "gotsaeng-report-hub";

export type ReportHubController = {
  settings: GotSaengPluginSettings;
  selectedOutputFileName: string | null;
  compileContextPackCommand(): Promise<void>;
  generateWeeklyReviewCommand(): Promise<void>;
  exportLlmHandoffCommand(): Promise<void>;
  validateVaultSchemaCommand(): Promise<void>;
  setSelectedOutputFileName(fileName: string): void;
  readOutputFileByName(fileName: string): Promise<string | null>;
  openOutputFileByName(fileName: string): Promise<void>;
  openSourceFileByPath(sourcePath: string): Promise<void>;
  readCurrentCompileReport(): Promise<CompileReport | null>;
};

export class GotSaengReportHubView extends ItemView {
  override icon = "file-text";
  override navigation = false;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly controller: ReportHubController
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
      cls: "gotsaeng-os-view-note"
    });

    const actions = contentEl.createDiv({ cls: "gotsaeng-os-action-grid" });
    this.addActionButton(actions, "Compile", () => this.controller.compileContextPackCommand());
    this.addActionButton(actions, "Weekly Review", () => this.controller.generateWeeklyReviewCommand());
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
      this.addStat(stats, "Missing updated", String(report.sourceCoverage?.notesMissingUpdated ?? 0));
      this.addStat(stats, "Avg provenance", String(report.provenanceStats?.averageScore ?? 0));
      this.addStat(stats, "Weak provenance", String(report.provenanceStats?.weakItems ?? 0));
      this.addStat(stats, "Avg confidence", String(report.confidenceStats?.averageScore ?? 0));
      this.addStat(stats, "Low confidence", String(report.confidenceStats?.lowItems ?? 0));
      this.addStat(stats, "Contradictions", String(report.contradictionStats?.totalCandidates ?? 0));
    } else {
      stats.createEl("p", {
        text: "No compile report found yet. Run Compile to create one.",
        cls: "gotsaeng-os-view-note"
      });
    }

    contentEl.createEl("h3", { text: "Output" });
    contentEl.createEl("p", {
      text: `${this.controller.settings.outputFolder} (${this.controller.settings.outputFolderVisibility})`,
      cls: "gotsaeng-os-output-path"
    });

    contentEl.createEl("h3", { text: "Context Pack Files" });
    contentEl.createEl("p", {
      text: "Hidden folders stay out of the file explorer, but generated files can still be read here.",
      cls: "gotsaeng-os-view-note"
    });
    const selectedFileName = this.controller.selectedOutputFileName ?? DEFAULT_OUTPUT_ARTIFACT.fileName;
    const files = contentEl.createDiv({ cls: "gotsaeng-os-artifact-grid" });
    for (const artifact of OUTPUT_ARTIFACTS) {
      this.addArtifactButton(files, artifact, selectedFileName);
    }

    await this.renderArtifactPreview(contentEl, selectedFileName);
  }

  private addActionButton(parent: HTMLElement, label: string, action: () => Promise<void>): void {
    const button = parent.createEl("button", { text: label, cls: "gotsaeng-os-button" });
    button.addEventListener("click", () => {
      void this.runAndRefresh(action);
    });
  }

  private addArtifactButton(parent: HTMLElement, artifact: OutputArtifact, selectedFileName: string): void {
    const button = parent.createEl("button", {
      text: artifact.label,
      cls: "gotsaeng-os-artifact-button"
    });
    if (artifact.fileName === selectedFileName) {
      button.addClass("is-active");
    }
    button.addEventListener("click", () => {
      this.controller.setSelectedOutputFileName(artifact.fileName);
      void this.render();
    });
  }

  private addStat(parent: HTMLElement, label: string, value: string): void {
    const stat = parent.createDiv({ cls: "gotsaeng-os-stat" });
    stat.createEl("span", { text: label, cls: "gotsaeng-os-stat-label" });
    stat.createEl("strong", { text: value });
  }

  private async runAndRefresh(action: () => Promise<void>): Promise<void> {
    await action();
    await this.render();
  }

  private async renderArtifactPreview(parent: HTMLElement, fileName: string): Promise<void> {
    const artifact = OUTPUT_ARTIFACTS.find((item) => item.fileName === fileName) ?? DEFAULT_OUTPUT_ARTIFACT;
    const filePath = `${this.controller.settings.outputFolder}/${artifact.fileName}`;

    parent.createEl("h3", { text: artifact.label });
    parent.createEl("p", {
      text: filePath,
      cls: "gotsaeng-os-output-path"
    });

    const content = await this.controller.readOutputFileByName(artifact.fileName);
    if (content === null) {
      parent.createEl("p", {
        text: `No ${artifact.fileName} file found yet. Run the matching command or Compile first.`,
        cls: "gotsaeng-os-view-note"
      });
      return;
    }

    this.renderSourceLinks(parent, extractSourceLinks(content, { outputFolder: this.controller.settings.outputFolder }));

    const preview = parent.createDiv({ cls: "gotsaeng-os-artifact-preview" });
    if (artifact.format === "json") {
      preview.createEl("pre").createEl("code", { text: formatJson(content) });
      return;
    }

    await MarkdownRenderer.render(this.app, content, preview, filePath, this);
  }

  private renderSourceLinks(parent: HTMLElement, sourceLinks: SourceLink[]): void {
    const panel = parent.createDiv({ cls: "gotsaeng-os-source-panel" });
    panel.createEl("h4", { text: "Source Notes" });

    if (sourceLinks.length === 0) {
      panel.createEl("p", {
        text: "No source-note links found in this preview.",
        cls: "gotsaeng-os-view-note"
      });
      return;
    }

    const grid = panel.createDiv({ cls: "gotsaeng-os-source-grid" });
    for (const sourceLink of sourceLinks) {
      const button = grid.createEl("button", {
        text: formatSourceLinkLabel(sourceLink),
        cls: "gotsaeng-os-source-button"
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
