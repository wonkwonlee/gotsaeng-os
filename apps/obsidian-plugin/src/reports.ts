import path from "node:path";

import {
  createWarningTriage,
  groupItemsBySource,
  inferCurrentObjective,
  selectHighSignalItems,
  type CompileReport,
  type ContextPack,
  type ExtractedItem,
  type ValidationIssue
} from "@gotsaeng/core";

export type ValidationResult = {
  filesChecked: number;
  warnings: string[];
  errors: string[];
};

export const REPORT_HUB_FILE = "REPORT_HUB.md";

export type ReportHubOptions = {
  outputFolder: string;
  generatedAt?: string;
};

const HUB_ITEM_LIMIT = 12;
const WEEKLY_ITEM_LIMIT = 10;

export function renderReportHub(pack: ContextPack, options: ReportHubOptions): string {
  const generatedAt = options.generatedAt ?? pack.generatedAt;
  const activeActions = pack.actions.filter((item) => item.status === "open" || item.status === "active");
  const objective = inferCurrentObjective(pack);

  return [
    `# GotSaeng OS Report Hub: ${pack.projectName}`,
    "",
    `Generated: ${generatedAt}`,
    `Source root: ${pack.sourceRoot}`,
    "",
    "## Snapshot",
    "",
    `- Files scanned: ${pack.report.filesScanned}`,
    `- Markdown parsed: ${pack.report.markdownFilesParsed}`,
    `- Extracted items: ${pack.report.extractionStats?.totalItems ?? countExtractedItems(pack)}`,
    `- Active actions: ${activeActions.length}`,
    `- Open questions: ${pack.questions.length}`,
    `- Risks: ${pack.risks.length}`,
    `- Notes missing updated dates: ${pack.report.sourceCoverage?.notesMissingUpdated ?? 0}`,
    `- Average provenance score: ${pack.report.provenanceStats?.averageScore ?? 0}`,
    `- Weak provenance items: ${pack.report.provenanceStats?.weakItems ?? 0}`,
    `- Average confidence score: ${pack.report.confidenceStats?.averageScore ?? 0}`,
    `- Low confidence items: ${pack.report.confidenceStats?.lowItems ?? 0}`,
    `- Contradiction candidates: ${pack.report.contradictionStats?.totalCandidates ?? 0}`,
    `- Current objective: ${objective.text}`,
    "",
    "## Core Reports",
    "",
    renderCoreReportLinks(options.outputFolder, pack.report.generatedFiles),
    "",
    "## Plugin Reports",
    "",
    renderPluginReportLinks(options.outputFolder),
    "",
    "## Active Actions",
    "",
    renderHubItemList(selectHighSignalItems(activeActions, HUB_ITEM_LIMIT), HUB_ITEM_LIMIT),
    "",
    "## Open Questions",
    "",
    renderHubItemList(selectHighSignalItems(pack.questions, HUB_ITEM_LIMIT), HUB_ITEM_LIMIT),
    "",
    "## Risks",
    "",
    renderHubItemList(selectHighSignalItems(pack.risks, HUB_ITEM_LIMIT), HUB_ITEM_LIMIT),
    "",
    "## Source Coverage",
    "",
    renderSourceCoverage(pack.report),
    "",
    "## Source Provenance",
    "",
    renderSourceProvenance(pack.report),
    "",
    "## Confidence Metadata",
    "",
    renderConfidenceMetadata(pack.report),
    "",
    "## Contradiction Candidates",
    "",
    renderContradictionCandidates(pack.report),
    "",
    "## Notes Needing Metadata",
    "",
    renderMissingUpdatedNotes(pack, HUB_ITEM_LIMIT),
    ""
  ].join("\n");
}

export function renderValidationReport(input: {
  generatedAt: string;
  projectName: string;
  sourceRoot: string;
  strict: boolean;
  result: ValidationResult;
}): string {
  const status = input.result.errors.length > 0 ? "invalid" : "valid";

  return [
    `# Vault Validation: ${input.projectName}`,
    "",
    `Generated: ${input.generatedAt}`,
    `Source: ${input.sourceRoot}`,
    `Mode: ${input.strict ? "strict" : "compatibility"}`,
    `Status: ${status}`,
    "",
    "## Summary",
    "",
    `- Markdown files checked: ${input.result.filesChecked}`,
    `- Warnings: ${input.result.warnings.length}`,
    `- Errors: ${input.result.errors.length}`,
    "",
    "## Warnings",
    "",
    renderStringList(input.result.warnings),
    "",
    "## Errors",
    "",
    renderStringList(input.result.errors),
    ""
  ].join("\n");
}

export function renderWeeklyReview(pack: ContextPack): string {
  const activeActions = pack.actions.filter((item) => item.status === "open" || item.status === "active");
  const objective = inferCurrentObjective(pack);
  const questions = selectHighSignalItems(pack.questions, WEEKLY_ITEM_LIMIT);
  const risks = selectHighSignalItems(pack.risks, WEEKLY_ITEM_LIMIT);

  return [
    `# Weekly Review Context: ${pack.projectName}`,
    "",
    `Generated: ${pack.generatedAt}`,
    "",
    "## Current Objective",
    "",
    `${objective.text} (${objective.confidence}; source: ${objective.sourcePath ?? "none"})`,
    "",
    "## This Week's Focus",
    "",
    renderItemList(selectHighSignalItems(activeActions, WEEKLY_ITEM_LIMIT), WEEKLY_ITEM_LIMIT),
    "",
    "## Active Actions",
    "",
    renderGroupedHubItems(selectHighSignalItems(activeActions, 30), 5),
    "",
    "## Top Open Questions",
    "",
    renderGroupedHubItems(questions, 5),
    "",
    "## Top Risks",
    "",
    renderGroupedHubItems(risks, 5),
    "",
    "## Stale Context",
    "",
    renderItemList(selectHighSignalItems(pack.staleItems, WEEKLY_ITEM_LIMIT), WEEKLY_ITEM_LIMIT),
    "",
    "## Warning Triage",
    "",
    renderWarningTriage(pack.report),
    "",
    "## Source Coverage",
    "",
    renderSourceCoverage(pack.report),
    "",
    "## Source Provenance",
    "",
    renderSourceProvenance(pack.report),
    "",
    "## Contradiction Candidates",
    "",
    renderContradictionCandidates(pack.report),
    ""
  ].join("\n");
}

export function renderLlmHandoff(pack: ContextPack, files: Partial<Record<string, string>>): string {
  return [
    `# LLM Handoff: ${pack.projectName}`,
    "",
    `Generated: ${pack.generatedAt}`,
    "",
    "This handoff is local-only generated context. It does not include AI-generated analysis.",
    "",
    "## Project Context",
    "",
    stripTitle(files["PROJECT_CONTEXT.md"] ?? ""),
    "",
    "## Memory Snapshot",
    "",
    stripTitle(files["MEMORY_SNAPSHOT.md"] ?? ""),
    "",
    "## Decision Log",
    "",
    stripTitle(files["DECISION_LOG.md"] ?? ""),
    "",
    "## Action Backlog",
    "",
    stripTitle(files["ACTION_BACKLOG.md"] ?? ""),
    "",
    "## Risk Register",
    "",
    stripTitle(files["RISK_REGISTER.md"] ?? ""),
    "",
    "## Open Questions",
    "",
    stripTitle(files["OPEN_QUESTIONS.md"] ?? ""),
    ""
  ].join("\n");
}

export function formatValidationIssue(issue: ValidationIssue): string {
  return `${issue.path}: ${issue.message}`;
}

function renderStringList(items: string[]): string {
  if (items.length === 0) {
    return "- None.";
  }

  return items.map((item) => `- ${item}`).join("\n");
}

function renderItemList(
  items: Array<{
    text: string;
    sourcePath: string;
    status?: string;
    priority?: string;
  }>,
  limit: number
): string {
  if (items.length === 0) {
    return "- None.";
  }

  const rendered = items.slice(0, limit).map((item) => {
    const metadata = [
      `source: ${item.sourcePath}`,
      item.status ? `status: ${item.status}` : undefined,
      item.priority ? `priority: ${item.priority}` : undefined
    ]
      .filter((value): value is string => value !== undefined)
      .join("; ");

    return `- ${item.text} (${metadata})`;
  });

  const omitted = items.length - rendered.length;
  if (omitted > 0) {
    rendered.push(`- ... ${omitted} more items omitted from this view.`);
  }

  return rendered.join("\n");
}

function renderSourceCoverage(report: CompileReport): string {
  const stats = report.extractionStats;
  const coverage = report.sourceCoverage;
  const lines = [
    `- Files scanned: ${report.filesScanned}`,
    `- Markdown files parsed: ${report.markdownFilesParsed}`,
    `- Files skipped: ${report.filesSkipped}`,
    `- Warnings: ${report.warnings.length}`
  ];

  if (stats) {
    lines.push(`- Extracted items: ${stats.totalItems}`);
    lines.push(`- Notes with extracted items: ${stats.notesWithItems}`);
    lines.push(`- Notes without extracted items: ${stats.notesWithoutItems}`);
  }

  if (coverage) {
    lines.push(`- Notes with updated dates: ${coverage.notesWithUpdated}`);
    lines.push(`- Notes missing updated dates: ${coverage.notesMissingUpdated}`);
  }

  return lines.join("\n");
}

function renderSourceProvenance(report: CompileReport): string {
  const stats = report.provenanceStats;
  if (!stats) {
    return "- No provenance stats available.";
  }

  const levels = Object.entries(stats.byLevel)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([level, count]) => `${level}: ${count}`)
    .join(", ");

  return [
    `- Average score: ${stats.averageScore}`,
    `- Strong items: ${stats.strongItems}`,
    `- Moderate items: ${stats.moderateItems}`,
    `- Weak items: ${stats.weakItems}`,
    `- By level: ${levels || "none"}`
  ].join("\n");
}

function renderConfidenceMetadata(report: CompileReport): string {
  const stats = report.confidenceStats;
  if (!stats) {
    return "- No confidence stats available.";
  }

  const levels = Object.entries(stats.byLevel)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([level, count]) => `${level}: ${count}`)
    .join(", ");

  return [
    `- Average score: ${stats.averageScore}`,
    `- High confidence items: ${stats.highItems}`,
    `- Low confidence items: ${stats.lowItems}`,
    `- By level: ${levels || "none"}`
  ].join("\n");
}

function renderContradictionCandidates(report: CompileReport): string {
  const stats = report.contradictionStats;
  if (!stats) {
    return "- No contradiction stats available.";
  }

  const signals = Object.entries(stats.bySignal)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([signal, count]) => `${signal}: ${count}`)
    .join(", ");

  return [
    `- Candidates: ${stats.totalCandidates}`,
    `- Review items: ${stats.reviewItems}`,
    `- Watchlist items: ${stats.watchItems}`,
    `- By signal: ${signals || "none"}`
  ].join("\n");
}

function renderWarningTriage(report: CompileReport): string {
  const triage = report.warningTriage ?? createWarningTriage(report);
  if (triage.items.length === 0) {
    return "- None.";
  }

  return triage.items
    .map((item) => {
      const examples = item.examples.slice(0, 5).map((example) => `  - ${example}`).join("\n");
      return [`- ${item.label}: ${item.count} (${item.severity})`, examples].filter(Boolean).join("\n");
    })
    .join("\n");
}

function renderCoreReportLinks(outputFolder: string, generatedFiles: string[]): string {
  const files = generatedFiles.filter((fileName) => fileName !== "COMPILE_REPORT.json");
  if (files.length === 0) {
    return "- None.";
  }

  return files
    .map((fileName) => `- ${toVaultWikiLink(`${outputFolder}/${fileName}`, titleFromReportFile(fileName))}`)
    .join("\n");
}

function renderPluginReportLinks(outputFolder: string): string {
  return [
    `- ${toVaultWikiLink(`${outputFolder}/${REPORT_HUB_FILE}`, "Report Hub")}`,
    `- ${toVaultWikiLink(`${outputFolder}/WEEKLY_REVIEW_CONTEXT.md`, "Weekly Review Context")}`,
    `- ${toVaultWikiLink(`${outputFolder}/LLM_HANDOFF.md`, "LLM Handoff")}`,
    `- ${toVaultWikiLink(`${outputFolder}/VALIDATION_REPORT.md`, "Validation Report")}`
  ].join("\n");
}

function renderHubItemList(items: ExtractedItem[], limit: number): string {
  if (items.length === 0) {
    return "- None.";
  }

  const rendered = items.slice(0, limit).map((item) => {
    const metadata = [
      toVaultWikiLink(item.sourcePath, item.sourcePath),
      item.status ? `status: ${item.status}` : undefined,
      item.priority ? `priority: ${item.priority}` : undefined
    ]
      .filter((value): value is string => value !== undefined)
      .join("; ");

    return `- ${item.text} (${metadata})`;
  });

  const omitted = items.length - rendered.length;
  if (omitted > 0) {
    rendered.push(`- ... ${omitted} more items omitted from this hub view.`);
  }

  return rendered.join("\n");
}

function renderGroupedHubItems(items: ExtractedItem[], limitPerSource: number): string {
  if (items.length === 0) {
    return "- None.";
  }

  return groupItemsBySource(items)
    .map((group) => {
      return [
        `### ${toVaultWikiLink(group.sourcePath, group.sourcePath)}`,
        "",
        renderHubItemList(group.items, limitPerSource)
      ].join("\n");
    })
    .join("\n\n");
}

function renderMissingUpdatedNotes(pack: ContextPack, limit: number): string {
  const notes = pack.notes.filter((note) => !note.updated);
  if (notes.length === 0) {
    return "- None.";
  }

  const rendered = notes
    .slice(0, limit)
    .map((note) => `- ${toVaultWikiLink(note.path, note.path)} (${note.noteType}; title: ${note.title})`);

  const omitted = notes.length - rendered.length;
  if (omitted > 0) {
    rendered.push(`- ... ${omitted} more notes omitted from this hub view.`);
  }

  return rendered.join("\n");
}

function countExtractedItems(pack: ContextPack): number {
  return (
    pack.facts.length +
    pack.decisions.length +
    pack.actions.length +
    pack.risks.length +
    pack.assumptions.length +
    pack.questions.length +
    pack.insights.length
  );
}

function titleFromReportFile(fileName: string): string {
  return fileName
    .replace(/\.md$/i, "")
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function toVaultWikiLink(pathOrLinkText: string, label: string): string {
  const safePath = pathOrLinkText.replace(/\|/g, " ");
  const safeLabel = label.replace(/\|/g, " ");
  return `[[${safePath}|${safeLabel}]]`;
}

function stripTitle(markdown: string): string {
  return markdown
    .split(/\r?\n/)
    .filter((line, index) => !(index === 0 && /^#\s+/.test(line)))
    .join("\n")
    .trim();
}

export function makeReportPath(outputDir: string, fileName: string): string {
  return path.join(outputDir, fileName);
}
