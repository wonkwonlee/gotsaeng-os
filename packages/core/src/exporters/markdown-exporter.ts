import fs from "node:fs/promises";
import path from "node:path";

import {
  createWarningTriage,
  groupItemsBySource,
  inferCurrentObjective,
  selectHighSignalItems
} from "../quality";
import { compareItemsByConfidence } from "../confidence";
import { compareContradictionCandidates } from "../contradictions";
import { compareItemsByProvenance } from "../provenance";
import type { ContextPack, ContradictionCandidate, ExtractedItem } from "../schemas/context";
import type { NoteDocument } from "../schemas/note";
import { compareStrings } from "../utils/path";

export const GENERATED_MARKDOWN_FILES = [
  "PROJECT_CONTEXT.md",
  "MEMORY_SNAPSHOT.md",
  "DECISION_LOG.md",
  "ACTION_BACKLOG.md",
  "RISK_REGISTER.md",
  "OPEN_QUESTIONS.md",
  "STALE_CONTEXT.md",
  "SOURCE_PROVENANCE.md",
  "CONFIDENCE.md",
  "CONTRADICTIONS.md"
] as const;

export type GeneratedMarkdownFile = (typeof GENERATED_MARKDOWN_FILES)[number];

export function renderMarkdownFiles(pack: ContextPack): Record<GeneratedMarkdownFile, string> {
  return {
    "PROJECT_CONTEXT.md": renderProjectContext(pack),
    "MEMORY_SNAPSHOT.md": renderMemorySnapshot(pack),
    "DECISION_LOG.md": renderDecisionLog(pack),
    "ACTION_BACKLOG.md": renderActionBacklog(pack),
    "RISK_REGISTER.md": renderRiskRegister(pack),
    "OPEN_QUESTIONS.md": renderOpenQuestions(pack),
    "STALE_CONTEXT.md": renderStaleContext(pack),
    "SOURCE_PROVENANCE.md": renderSourceProvenance(pack),
    "CONFIDENCE.md": renderConfidenceMetadata(pack),
    "CONTRADICTIONS.md": renderContradictions(pack)
  };
}

export async function writeMarkdownContextPack(
  pack: ContextPack,
  outputDir: string
): Promise<string[]> {
  await fs.mkdir(outputDir, { recursive: true });
  const files = renderMarkdownFiles(pack);

  for (const fileName of GENERATED_MARKDOWN_FILES) {
    await fs.writeFile(path.join(outputDir, fileName), files[fileName], "utf8");
  }

  return [...GENERATED_MARKDOWN_FILES];
}

export function renderProjectContext(pack: ContextPack): string {
  const objective = inferCurrentObjective(pack);

  return [
    `# Project Context: ${pack.projectName}`,
    "",
    `Generated: ${pack.generatedAt}`,
    "",
    "## Current Objective",
    "",
    objective.text,
    "",
    `Source: ${objective.sourcePath ?? "none"} (${objective.confidence}; ${objective.reason})`,
    "",
    "## Key Facts",
    "",
    renderItemList(pack.facts, { limit: 80 }),
    "",
    "## Key Decisions",
    "",
    renderGroupedItems(pack.decisions, { headingLevel: 3, limitPerSource: 8 }),
    "",
    "## Active Actions",
    "",
    renderItemList(selectHighSignalItems(pack.actions.filter((item) => item.status === "open" || item.status === "active"), 25)),
    "",
    "## Risks",
    "",
    renderGroupedItems(pack.risks, { headingLevel: 3, limitPerSource: 8 }),
    "",
    "## Open Questions",
    "",
    renderGroupedItems(pack.questions, { headingLevel: 3, limitPerSource: 8 }),
    "",
    "## Source Notes",
    "",
    renderSourceNotes(pack.notes),
    ""
  ].join("\n");
}

export function renderMemorySnapshot(pack: ContextPack): string {
  return [
    `# Memory Snapshot: ${pack.projectName}`,
    "",
    `Generated: ${pack.generatedAt}`,
    "",
    "## Durable Facts",
    "",
    renderItemList(pack.facts),
    "",
    "## Insights",
    "",
    renderItemList(pack.insights, { limit: 120 }),
    "",
    "## Assumptions",
    "",
    renderItemList(pack.assumptions),
    "",
    "## Recent Updates",
    "",
    renderRecentUpdates(pack.notes),
    "",
    "## Source Coverage",
    "",
    `- Files scanned: ${pack.report.filesScanned}`,
    `- Markdown files parsed: ${pack.report.markdownFilesParsed}`,
    `- Files skipped: ${pack.report.filesSkipped}`,
    `- Warnings: ${pack.report.warnings.length}`,
    ...renderCoverageLines(pack),
    "",
    "## Source Provenance",
    "",
    renderProvenanceSummary(pack),
    "",
    "## Confidence Metadata",
    "",
    renderConfidenceSummary(pack),
    "",
    "## Contradiction Candidates",
    "",
    renderContradictionSummary(pack),
    "",
    "## Warning Triage",
    "",
    renderWarningTriage(pack),
    ""
  ].join("\n");
}

export function renderDecisionLog(pack: ContextPack): string {
  return [
    `# Decision Log: ${pack.projectName}`,
    "",
    `Generated: ${pack.generatedAt}`,
    "",
    renderGroupedItems(pack.decisions),
    ""
  ].join("\n");
}

export function renderActionBacklog(pack: ContextPack): string {
  const open = pack.actions.filter((item) => item.status === "open");
  const active = pack.actions.filter((item) => item.status === "active");
  const unknown = pack.actions.filter((item) => item.status === "unknown" || item.status === undefined);
  const done = pack.actions.filter((item) => item.status === "done");

  return [
    `# Action Backlog: ${pack.projectName}`,
    "",
    `Generated: ${pack.generatedAt}`,
    "",
    "## Open",
    "",
    renderItemList(open),
    "",
    "## Active",
    "",
    renderItemList(active),
    "",
    "## Unknown",
    "",
    renderItemList(unknown),
    "",
    "## Done",
    "",
    renderItemList(done),
    ""
  ].join("\n");
}

export function renderRiskRegister(pack: ContextPack): string {
  return [
    `# Risk Register: ${pack.projectName}`,
    "",
    `Generated: ${pack.generatedAt}`,
    "",
    renderItemList(pack.risks),
    ""
  ].join("\n");
}

export function renderOpenQuestions(pack: ContextPack): string {
  return [
    `# Open Questions: ${pack.projectName}`,
    "",
    `Generated: ${pack.generatedAt}`,
    "",
    renderItemList(pack.questions),
    ""
  ].join("\n");
}

export function renderStaleContext(pack: ContextPack): string {
  const missingUpdated = pack.notes.filter((note) => !note.updated);

  return [
    `# Stale Context: ${pack.projectName}`,
    "",
    `Generated: ${pack.generatedAt}`,
    "",
    "## Stale Items",
    "",
    pack.staleItems.length > 0 ? renderItemList(pack.staleItems) : "- No stale items detected.",
    "",
    "## Notes Missing Updated Dates",
    "",
    missingUpdated.length > 0 ? renderSourceNotes(missingUpdated) : "- None.",
    ""
  ].join("\n");
}

export function renderSourceProvenance(pack: ContextPack): string {
  const items = getAllItems(pack);
  const weakItems = items
    .filter((item) => item.provenance?.level === "weak")
    .sort(compareItemsByProvenance);
  const strongItems = items
    .filter((item) => item.provenance?.level === "strong")
    .sort((a, b) => compareItemsByProvenance(b, a));
  const warningItems = items
    .filter((item) => (item.provenance?.warnings.length ?? 0) > 0)
    .sort(compareItemsByProvenance);

  return [
    `# Source Provenance: ${pack.projectName}`,
    "",
    `Generated: ${pack.generatedAt}`,
    "",
    "## Summary",
    "",
    renderProvenanceSummary(pack),
    "",
    "## Weak Provenance Items",
    "",
    renderProvenanceItemList(weakItems, { limit: 80 }),
    "",
    "## Strong Provenance Items",
    "",
    renderProvenanceItemList(strongItems, { limit: 40 }),
    "",
    "## Provenance Warnings",
    "",
    renderProvenanceItemList(warningItems, { limit: 80, includeWarnings: true }),
    ""
  ].join("\n");
}

export function renderConfidenceMetadata(pack: ContextPack): string {
  const items = getAllItems(pack);
  const lowItems = items
    .filter((item) => item.confidence?.level === "low")
    .sort(compareItemsByConfidence);
  const highItems = items
    .filter((item) => item.confidence?.level === "high")
    .sort((a, b) => compareItemsByConfidence(b, a));
  const warningItems = items
    .filter((item) => (item.confidence?.warnings.length ?? 0) > 0)
    .sort(compareItemsByConfidence);

  return [
    `# Confidence Metadata: ${pack.projectName}`,
    "",
    `Generated: ${pack.generatedAt}`,
    "",
    "## Summary",
    "",
    renderConfidenceSummary(pack),
    "",
    "## Low Confidence Items",
    "",
    renderConfidenceItemList(lowItems, { limit: 80 }),
    "",
    "## High Confidence Items",
    "",
    renderConfidenceItemList(highItems, { limit: 40 }),
    "",
    "## Confidence Warnings",
    "",
    renderConfidenceItemList(warningItems, { limit: 80, includeWarnings: true }),
    "",
    "## Notes",
    "",
    "- Confidence scores describe extraction reliability from local metadata and patterns.",
    "- Confidence scores do not verify whether a claim is factually true.",
    ""
  ].join("\n");
}

export function renderContradictions(pack: ContextPack): string {
  const reviewItems = pack.contradictions
    .filter((candidate) => candidate.severity === "review")
    .sort(compareContradictionCandidates);
  const watchItems = pack.contradictions
    .filter((candidate) => candidate.severity === "watch")
    .sort(compareContradictionCandidates);

  return [
    `# Contradiction Candidates: ${pack.projectName}`,
    "",
    `Generated: ${pack.generatedAt}`,
    "",
    "## Summary",
    "",
    renderContradictionSummary(pack),
    "",
    "## Review Candidates",
    "",
    renderContradictionCandidateList(reviewItems, { limit: 80, includeEvidence: true }),
    "",
    "## Watchlist Candidates",
    "",
    renderContradictionCandidateList(watchItems, { limit: 80, includeEvidence: true }),
    "",
    "## Notes",
    "",
    "- Candidates are deterministic local cues from headings, markers, and explicit contradiction language.",
    "- This report does not prove that sources are semantically inconsistent.",
    ""
  ].join("\n");
}

function renderItemList(items: ExtractedItem[], options: { limit?: number } = {}): string {
  if (items.length === 0) {
    return "- None.";
  }

  const limit = options.limit ?? items.length;
  const rendered = items.slice(0, limit).map(renderItem);
  const omitted = items.length - rendered.length;

  if (omitted > 0) {
    rendered.push(`- ... ${omitted} more items omitted from this view. See COMPILE_REPORT.json for totals.`);
  }

  return rendered.join("\n");
}

function renderItem(item: ExtractedItem): string {
  const metadata = [
    `source: ${item.sourcePath}`,
    item.status ? `status: ${item.status}` : undefined,
    item.priority ? `priority: ${item.priority}` : undefined,
    item.tags.length > 0 ? `tags: ${item.tags.join(", ")}` : undefined
  ]
    .filter((value): value is string => value !== undefined)
    .join("; ");

  return `- ${item.text} (${metadata})`;
}

function renderGroupedItems(items: ExtractedItem[], options: { headingLevel?: 2 | 3; limitPerSource?: number } = {}): string {
  if (items.length === 0) {
    return "- None.";
  }

  const limit = options.limitPerSource;
  const headingPrefix = "#".repeat(options.headingLevel ?? 2);
  return groupItemsBySource(items)
    .map((group) => {
      const renderedItems = limit ? renderItemList(group.items, { limit }) : renderItemList(group.items);
      return [`${headingPrefix} ${group.sourcePath}`, "", renderedItems, ""].join("\n");
    })
    .join("\n")
    .trimEnd();
}

function renderSourceNotes(notes: NoteDocument[]): string {
  if (notes.length === 0) {
    return "- None.";
  }

  return [...notes]
    .sort((a, b) => compareStrings(a.path, b.path))
    .map((note) => `- ${note.path} (${note.noteType}; title: ${note.title})`)
    .join("\n");
}

function renderRecentUpdates(notes: NoteDocument[]): string {
  const updatedNotes = [...notes]
    .filter((note) => note.updated)
    .sort((a, b) => compareStrings(b.updated ?? "", a.updated ?? ""));

  if (updatedNotes.length === 0) {
    return "- None.";
  }

  return updatedNotes
    .slice(0, 10)
    .map((note) => `- ${note.updated}: ${note.title} (source: ${note.path})`)
    .join("\n");
}

function renderCoverageLines(pack: ContextPack): string[] {
  const lines: string[] = [];
  const stats = pack.report.extractionStats;
  const coverage = pack.report.sourceCoverage;

  if (stats) {
    lines.push(`- Extracted items: ${stats.totalItems}`);
    lines.push(`- Notes with extracted items: ${stats.notesWithItems}`);
    lines.push(`- Notes without extracted items: ${stats.notesWithoutItems}`);
  }

  if (coverage) {
    lines.push(`- Notes with updated dates: ${coverage.notesWithUpdated}`);
    lines.push(`- Notes missing updated dates: ${coverage.notesMissingUpdated}`);
    const noteTypeSummary = Object.entries(coverage.noteTypes)
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([noteType, count]) => `${noteType}: ${count}`)
      .join(", ");
    if (noteTypeSummary) {
      lines.push(`- Note types: ${noteTypeSummary}`);
    }
  }

  return lines;
}

function renderWarningTriage(pack: ContextPack): string {
  const triage = pack.report.warningTriage ?? createWarningTriage(pack.report);
  if (triage.items.length === 0) {
    return "- None.";
  }

  return triage.items
    .map((item) => {
      const examples = item.examples.map((example) => `  - ${example}`).join("\n");
      return [`- ${item.label}: ${item.count} (${item.severity})`, examples].filter(Boolean).join("\n");
    })
    .join("\n");
}

function renderProvenanceSummary(pack: ContextPack): string {
  const stats = pack.report.provenanceStats;
  if (!stats) {
    return "- No provenance stats available.";
  }

  const levels = Object.entries(stats.byLevel)
    .sort(([left], [right]) => compareStrings(left, right))
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

function renderConfidenceSummary(pack: ContextPack): string {
  const stats = pack.report.confidenceStats;
  if (!stats) {
    return "- No confidence stats available.";
  }

  const levels = Object.entries(stats.byLevel)
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([level, count]) => `${level}: ${count}`)
    .join(", ");

  return [
    `- Average score: ${stats.averageScore}`,
    `- High confidence items: ${stats.highItems}`,
    `- Low confidence items: ${stats.lowItems}`,
    `- By level: ${levels || "none"}`
  ].join("\n");
}

function renderContradictionSummary(pack: ContextPack): string {
  const stats = pack.report.contradictionStats;
  if (!stats) {
    return "- No contradiction stats available.";
  }

  const signals = Object.entries(stats.bySignal)
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([signal, count]) => `${signal}: ${count}`)
    .join(", ");

  return [
    `- Candidates: ${stats.totalCandidates}`,
    `- Review items: ${stats.reviewItems}`,
    `- Watchlist items: ${stats.watchItems}`,
    `- By signal: ${signals || "none"}`
  ].join("\n");
}

function renderProvenanceItemList(
  items: ExtractedItem[],
  options: { limit?: number; includeWarnings?: boolean } = {}
): string {
  if (items.length === 0) {
    return "- None.";
  }

  const limit = options.limit ?? items.length;
  const rendered = items.slice(0, limit).map((item) => renderProvenanceItem(item, options));
  const omitted = items.length - rendered.length;

  if (omitted > 0) {
    rendered.push(`- ... ${omitted} more items omitted from this provenance view. See COMPILE_REPORT.json for totals.`);
  }

  return rendered.join("\n");
}

function renderProvenanceItem(
  item: ExtractedItem,
  options: { includeWarnings?: boolean } = {}
): string {
  const provenance = item.provenance;
  const details = [
    `source: ${item.sourcePath}`,
    `kind: ${item.kind}`,
    `status: ${item.status ?? "unknown"}`,
    provenance ? `provenance: ${provenance.level} ${provenance.score}` : "provenance: unavailable"
  ];
  const rendered = [`- ${item.text} (${details.join("; ")})`];

  if (options.includeWarnings && provenance?.warnings.length) {
    rendered.push(...provenance.warnings.map((warning) => `  - warning: ${warning}`));
  }

  if (options.includeWarnings && provenance?.signals.length) {
    rendered.push(...provenance.signals.map((signal) => `  - signal: ${signal}`));
  }

  return rendered.join("\n");
}

function renderConfidenceItemList(
  items: ExtractedItem[],
  options: { limit?: number; includeWarnings?: boolean } = {}
): string {
  if (items.length === 0) {
    return "- None.";
  }

  const limit = options.limit ?? items.length;
  const rendered = items.slice(0, limit).map((item) => renderConfidenceItem(item, options));
  const omitted = items.length - rendered.length;

  if (omitted > 0) {
    rendered.push(`- ... ${omitted} more items omitted from this confidence view. See COMPILE_REPORT.json for totals.`);
  }

  return rendered.join("\n");
}

function renderConfidenceItem(
  item: ExtractedItem,
  options: { includeWarnings?: boolean } = {}
): string {
  const confidence = item.confidence;
  const details = [
    `source: ${item.sourcePath}`,
    `kind: ${item.kind}`,
    `status: ${item.status ?? "unknown"}`,
    confidence ? `confidence: ${confidence.level} ${confidence.score}` : "confidence: unavailable"
  ];
  const rendered = [`- ${item.text} (${details.join("; ")})`];

  if (options.includeWarnings && confidence?.warnings.length) {
    rendered.push(...confidence.warnings.map((warning) => `  - warning: ${warning}`));
  }

  if (options.includeWarnings && confidence?.signals.length) {
    rendered.push(...confidence.signals.map((signal) => `  - signal: ${signal}`));
  }

  return rendered.join("\n");
}

function renderContradictionCandidateList(
  candidates: ContradictionCandidate[],
  options: { limit?: number; includeEvidence?: boolean } = {}
): string {
  if (candidates.length === 0) {
    return "- None.";
  }

  const limit = options.limit ?? candidates.length;
  const rendered = candidates.slice(0, limit).map((candidate) => renderContradictionCandidate(candidate, options));
  const omitted = candidates.length - rendered.length;

  if (omitted > 0) {
    rendered.push(`- ... ${omitted} more candidates omitted from this contradictions view. See COMPILE_REPORT.json for totals.`);
  }

  return rendered.join("\n");
}

function renderContradictionCandidate(
  candidate: ContradictionCandidate,
  options: { includeEvidence?: boolean } = {}
): string {
  const details = [
    `source: ${candidate.sourcePath}`,
    `signal: ${candidate.signal}`,
    `severity: ${candidate.severity}`
  ];
  const rendered = [`- ${candidate.text} (${details.join("; ")})`];

  if (options.includeEvidence && candidate.evidence.length) {
    rendered.push(...candidate.evidence.map((evidence) => `  - evidence: ${evidence}`));
  }

  return rendered.join("\n");
}

function getAllItems(pack: ContextPack): ExtractedItem[] {
  return [
    ...pack.facts,
    ...pack.decisions,
    ...pack.actions,
    ...pack.risks,
    ...pack.assumptions,
    ...pack.questions,
    ...pack.insights
  ];
}
