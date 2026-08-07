import fs from "node:fs/promises";
import path from "node:path";

import {
  createWarningTriage,
  groupItemsBySource,
  inferCurrentObjective,
  selectHighSignalItems,
} from "../quality";
import { compareItemsByConfidence } from "../confidence";
import { compareContradictionCandidates } from "../contradictions";
import { compareItemsByProvenance } from "../provenance";
import type {
  CompileReport,
  ContextPack,
  ContradictionCandidate,
  ExtractedItem,
} from "../schemas/context";
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
  "CONTRADICTIONS.md",
  "ENGINEERING_OPS.md",
  "TEAM_MEMORY.md",
] as const;

export type GeneratedMarkdownFile = (typeof GENERATED_MARKDOWN_FILES)[number];

// Per-list cap for the dedicated single-category registers (Risk Register, Action
// Backlog, Open Questions, Memory Snapshot lists, Stale Context). When a register
// would exceed this many items, high-signal items (explicit markers first, then
// confidence) are kept and the remainder is summarized with an omission footer.
export const REGISTER_ITEM_CAP = 200;

// Back-compat alias: the risk register was the first register to adopt the cap.
export const RISK_REGISTER_CAP = REGISTER_ITEM_CAP;

// Separate bound for the Memory Snapshot Insights list, which tends to run
// longer than the other registers on research-heavy vaults.
export const INSIGHTS_ITEM_CAP = 120;

// Overrides for the per-list caps above. Undefined fields fall back to the
// module defaults (REGISTER_ITEM_CAP / INSIGHTS_ITEM_CAP).
export type RegisterCaps = {
  register?: number;
  insights?: number;
};

export function renderMarkdownFiles(
  pack: ContextPack,
  caps: RegisterCaps = {},
): Record<GeneratedMarkdownFile, string> {
  return {
    "PROJECT_CONTEXT.md": renderProjectContext(pack),
    "MEMORY_SNAPSHOT.md": renderMemorySnapshot(pack, caps),
    "DECISION_LOG.md": renderDecisionLog(pack),
    "ACTION_BACKLOG.md": renderActionBacklog(pack, caps),
    "RISK_REGISTER.md": renderRiskRegister(pack, caps),
    "OPEN_QUESTIONS.md": renderOpenQuestions(pack, caps),
    "STALE_CONTEXT.md": renderStaleContext(pack, caps),
    "SOURCE_PROVENANCE.md": renderSourceProvenance(pack),
    "CONFIDENCE.md": renderConfidenceMetadata(pack),
    "CONTRADICTIONS.md": renderContradictions(pack),
    "ENGINEERING_OPS.md": renderEngineeringOps(pack),
    "TEAM_MEMORY.md": renderTeamMemory(pack),
  };
}

export async function writeMarkdownContextPack(
  pack: ContextPack,
  outputDir: string,
  caps: RegisterCaps = {},
): Promise<string[]> {
  await fs.mkdir(outputDir, { recursive: true });
  const files = renderMarkdownFiles(pack, caps);

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
    renderItemList(
      selectHighSignalItems(
        pack.actions.filter((item) => item.status === "open" || item.status === "active"),
        25,
      ),
    ),
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
    "",
  ].join("\n");
}

export function renderMemorySnapshot(pack: ContextPack, caps: RegisterCaps = {}): string {
  return [
    `# Memory Snapshot: ${pack.projectName}`,
    "",
    `Generated: ${pack.generatedAt}`,
    "",
    "## Durable Facts",
    "",
    renderCappedRegisterList(pack.facts, caps.register ?? REGISTER_ITEM_CAP),
    "",
    "## Insights",
    "",
    renderCappedRegisterList(pack.insights, caps.insights ?? INSIGHTS_ITEM_CAP),
    "",
    "## Assumptions",
    "",
    renderCappedRegisterList(pack.assumptions, caps.register ?? REGISTER_ITEM_CAP),
    "",
    "## Recent Updates",
    "",
    renderRecentUpdates(pack.notes),
    "",
    "## Source Coverage",
    "",
    ...renderCoverageLines(pack.report),
    "",
    "## Source Provenance",
    "",
    renderProvenanceSummary(pack.report),
    "",
    "## Confidence Metadata",
    "",
    renderConfidenceSummary(pack.report),
    "",
    "## Contradiction Candidates",
    "",
    renderContradictionSummary(pack.report),
    "",
    "## Warning Triage",
    "",
    renderWarningTriage(pack.report),
    "",
  ].join("\n");
}

export function renderDecisionLog(pack: ContextPack): string {
  return [
    `# Decision Log: ${pack.projectName}`,
    "",
    `Generated: ${pack.generatedAt}`,
    "",
    renderGroupedItems(pack.decisions),
    "",
  ].join("\n");
}

// Statuses that get their own dedicated section. Any action whose status is not
// one of these (including `undefined` and any future enum value) falls through to
// the catch-all "Unknown" bucket, so no action can ever vanish from the backlog.
const NAMED_ACTION_STATUSES = new Set<string>(["open", "active", "stale", "done"]);

export function renderActionBacklog(pack: ContextPack, caps: RegisterCaps = {}): string {
  const cap = caps.register ?? REGISTER_ITEM_CAP;
  // `markStale` returns a stale-marked copy instead of mutating the item in
  // `pack.actions`, so staleness has to be resolved by id here. Filtering on
  // `status` alone would leave detector-flagged actions in their original bucket.
  // `done` is terminal: the detector flags any old item, but a finished action
  // has not gone cold, so it stays in Done.
  const staleIds = new Set(pack.staleItems.map((item) => item.id));
  const isStale = (item: ExtractedItem): boolean =>
    item.status === "stale" || (staleIds.has(item.id) && item.status !== "done");

  const stale = pack.actions.filter(isStale);
  const live = pack.actions.filter((item) => !isStale(item));
  const open = live.filter((item) => item.status === "open");
  const active = live.filter((item) => item.status === "active");
  const done = live.filter((item) => item.status === "done");
  const unknown = live.filter(
    (item) => item.status === undefined || !NAMED_ACTION_STATUSES.has(item.status),
  );

  return [
    `# Action Backlog: ${pack.projectName}`,
    "",
    `Generated: ${pack.generatedAt}`,
    "",
    "## Open",
    "",
    renderCappedRegisterList(open, cap),
    "",
    "## Active",
    "",
    renderCappedRegisterList(active, cap),
    "",
    "## Stale",
    "",
    renderCappedRegisterList(stale, cap),
    "",
    "## Unknown",
    "",
    renderCappedRegisterList(unknown, cap),
    "",
    "## Done",
    "",
    renderCappedRegisterList(done, cap),
    "",
  ].join("\n");
}

export function renderRiskRegister(pack: ContextPack, caps: RegisterCaps = {}): string {
  return [
    `# Risk Register: ${pack.projectName}`,
    "",
    `Generated: ${pack.generatedAt}`,
    "",
    renderCappedRegisterList(pack.risks, caps.register ?? REGISTER_ITEM_CAP),
    "",
  ].join("\n");
}

// Bound a dedicated register's flat list. Output is unchanged while the list is
// within the cap; once it exceeds the cap, high-signal items (explicit markers,
// then confidence score) are ordered first so the trimmed items are the low-signal
// ones, summarized by renderItemList's omission footer. Explicit-marker items are
// never dropped: if a register contains more explicit markers than `cap`, the
// effective limit is raised to fit all of them (see #18) — only non-explicit items
// are ever trimmed.
function renderCappedRegisterList(items: ExtractedItem[], cap: number = REGISTER_ITEM_CAP): string {
  if (items.length <= cap) {
    return renderItemList(items);
  }
  const explicitMarkerCount = items.filter(isExplicitMarkerItem).length;
  const effectiveCap = Math.max(cap, explicitMarkerCount);
  return renderItemList(orderItemsForRegister(items), { limit: effectiveCap });
}

function orderItemsForRegister(items: ExtractedItem[]): ExtractedItem[] {
  return [...items].sort(compareItemsForRegister);
}

// Explicit-marker items first (so the cap never drops them), then by confidence
// score descending, with a deterministic tiebreak matching sortExtractedItems.
function compareItemsForRegister(a: ExtractedItem, b: ExtractedItem): number {
  const explicitDelta = Number(isExplicitMarkerItem(b)) - Number(isExplicitMarkerItem(a));
  if (explicitDelta !== 0) {
    return explicitDelta;
  }

  const scoreDelta = (b.confidence?.score ?? 0) - (a.confidence?.score ?? 0);
  if (scoreDelta !== 0) {
    return scoreDelta;
  }

  return (
    compareStrings(a.kind, b.kind) ||
    compareStrings(a.sourcePath, b.sourcePath) ||
    compareStrings(a.text, b.text)
  );
}

function isExplicitMarkerItem(item: ExtractedItem): boolean {
  return item.confidenceSource === "explicit_marker";
}

export function renderOpenQuestions(pack: ContextPack, caps: RegisterCaps = {}): string {
  return [
    `# Open Questions: ${pack.projectName}`,
    "",
    `Generated: ${pack.generatedAt}`,
    "",
    renderCappedRegisterList(pack.questions, caps.register ?? REGISTER_ITEM_CAP),
    "",
  ].join("\n");
}

export function renderStaleContext(pack: ContextPack, caps: RegisterCaps = {}): string {
  const missingUpdated = pack.notes.filter((note) => !note.updated);

  return [
    `# Stale Context: ${pack.projectName}`,
    "",
    `Generated: ${pack.generatedAt}`,
    "",
    "## Stale Items",
    "",
    pack.staleItems.length > 0
      ? renderCappedRegisterList(pack.staleItems, caps.register ?? REGISTER_ITEM_CAP)
      : "- No stale items detected.",
    "",
    "## Notes Missing Updated Dates",
    "",
    missingUpdated.length > 0 ? renderSourceNotes(missingUpdated) : "- None.",
    "",
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
    renderProvenanceSummary(pack.report),
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
    "",
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
    renderConfidenceSummary(pack.report),
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
    "",
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
    renderContradictionSummary(pack.report),
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
    "",
  ].join("\n");
}

/**
 * A release-gate snapshot: everything already computed for the other reports,
 * collected into one place so a maintainer can eyeball quality signals before
 * merging or publishing without opening every individual report.
 */
export function renderEngineeringOps(pack: ContextPack): string {
  return [
    `# Engineering Ops: ${pack.projectName}`,
    "",
    `Generated: ${pack.generatedAt}`,
    "",
    "## Quality Snapshot",
    "",
    ...renderCoverageLines(pack.report),
    `- Parse errors: ${pack.report.parseErrors.length}`,
    `- Generated Markdown reports: ${GENERATED_MARKDOWN_FILES.length}`,
    "",
    "## Warning Triage",
    "",
    renderWarningTriage(pack.report),
    "",
    "## Source Provenance",
    "",
    renderProvenanceSummary(pack.report),
    "",
    "## Confidence Metadata",
    "",
    renderConfidenceSummary(pack.report),
    "",
    "## Contradiction Candidates",
    "",
    renderContradictionSummary(pack.report),
    "",
    "## Generated Artifacts",
    "",
    renderGeneratedArtifactList(),
    "",
    "## Release Gate Notes",
    "",
    "- Run typecheck, tests, build, and lint before publishing or merging release work.",
    "- Keep releases local-only unless a future task explicitly changes that scope.",
    "- Treat provenance, confidence, and contradiction reports as review aids, not semantic proof.",
    "",
  ].join("\n");
}

/**
 * A team-facing handoff: current objective, active work, and the queues worth a
 * second pair of eyes, so a teammate picking up the vault does not have to read
 * every individual report to know where to start.
 */
export function renderTeamMemory(pack: ContextPack): string {
  const objective = inferCurrentObjective(pack);
  const activeActions = pack.actions.filter(
    (item) => item.status === "open" || item.status === "active",
  );

  return [
    `# Team Memory: ${pack.projectName}`,
    "",
    `Generated: ${pack.generatedAt}`,
    "",
    "## Current Objective",
    "",
    `${objective.text} (source: ${objective.sourcePath ?? "none"}; confidence: ${objective.confidence})`,
    "",
    "## Active Work",
    "",
    renderGroupedItems(selectHighSignalItems(activeActions, 30), {
      headingLevel: 3,
      limitPerSource: 8,
    }),
    "",
    "## Decisions",
    "",
    renderGroupedItems(pack.decisions, { headingLevel: 3, limitPerSource: 8 }),
    "",
    "## Risks",
    "",
    renderGroupedItems(selectHighSignalItems(pack.risks, 20), {
      headingLevel: 3,
      limitPerSource: 8,
    }),
    "",
    "## Open Questions",
    "",
    renderGroupedItems(selectHighSignalItems(pack.questions, 20), {
      headingLevel: 3,
      limitPerSource: 8,
    }),
    "",
    "## Stale Follow-up",
    "",
    renderItemList(selectHighSignalItems(pack.staleItems, 20)),
    "",
    "## Review Queues",
    "",
    renderTeamReviewQueues(pack),
    "",
    "## Handoff Notes",
    "",
    "- This report is generated from local Markdown only.",
    "- Use source paths to inspect or update the underlying notes before changing shared context.",
    "- Keep team-facing decisions in source notes so the next compile can carry them forward.",
    "",
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
    rendered.push(
      `- ... ${omitted} more items omitted from this view. See COMPILE_REPORT.json for totals.`,
    );
  }

  return rendered.join("\n");
}

function renderItem(item: ExtractedItem): string {
  const metadata = [
    `source: ${item.sourcePath}`,
    item.status ? `status: ${item.status}` : undefined,
    item.priority ? `priority: ${item.priority}` : undefined,
    item.tags.length > 0 ? `tags: ${item.tags.join(", ")}` : undefined,
  ]
    .filter((value): value is string => value !== undefined)
    .join("; ");

  return `- ${item.text} (${metadata})`;
}

function renderGroupedItems(
  items: ExtractedItem[],
  options: { headingLevel?: 2 | 3; limitPerSource?: number } = {},
): string {
  if (items.length === 0) {
    return "- None.";
  }

  const limit = options.limitPerSource;
  const headingPrefix = "#".repeat(options.headingLevel ?? 2);
  return groupItemsBySource(items)
    .map((group) => {
      const renderedItems = limit
        ? renderItemList(group.items, { limit })
        : renderItemList(group.items);
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

/**
 * Coverage lines for a compile report. Shared with the Obsidian Report Hub, which
 * omits the note-type breakdown to keep its summary short.
 */
export function renderCoverageLines(
  report: CompileReport,
  options: { includeNoteTypes?: boolean } = {},
): string[] {
  const stats = report.extractionStats;
  const coverage = report.sourceCoverage;
  const lines: string[] = [
    `- Files scanned: ${report.filesScanned}`,
    `- Markdown files parsed: ${report.markdownFilesParsed}`,
    `- Files skipped: ${report.filesSkipped}`,
    `- Warnings: ${report.warnings.length}`,
  ];

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
    if (noteTypeSummary && options.includeNoteTypes !== false) {
      lines.push(`- Note types: ${noteTypeSummary}`);
    }
  }

  return lines;
}

/**
 * Warning triage for a compile report. Shared with the Obsidian Report Hub, which
 * caps examples per row so the in-app note stays readable.
 */
export function renderWarningTriage(
  report: CompileReport,
  options: { maxExamples?: number } = {},
): string {
  const triage = report.warningTriage ?? createWarningTriage(report);
  if (triage.items.length === 0) {
    return "- None.";
  }

  return triage.items
    .map((item) => {
      const shown =
        options.maxExamples === undefined
          ? item.examples
          : item.examples.slice(0, options.maxExamples);
      const examples = shown.map((example) => `  - ${example}`).join("\n");
      return [`- ${item.label}: ${item.count} (${item.severity})`, examples]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");
}

export function renderProvenanceSummary(report: CompileReport): string {
  const stats = report.provenanceStats;
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
    `- By level: ${levels || "none"}`,
  ].join("\n");
}

export function renderConfidenceSummary(report: CompileReport): string {
  const stats = report.confidenceStats;
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
    `- By level: ${levels || "none"}`,
  ].join("\n");
}

export function renderContradictionSummary(report: CompileReport): string {
  const stats = report.contradictionStats;
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
    `- By signal: ${signals || "none"}`,
  ].join("\n");
}

function renderProvenanceItemList(
  items: ExtractedItem[],
  options: { limit?: number; includeWarnings?: boolean } = {},
): string {
  if (items.length === 0) {
    return "- None.";
  }

  const limit = options.limit ?? items.length;
  const rendered = items.slice(0, limit).map((item) => renderProvenanceItem(item, options));
  const omitted = items.length - rendered.length;

  if (omitted > 0) {
    rendered.push(
      `- ... ${omitted} more items omitted from this provenance view. See COMPILE_REPORT.json for totals.`,
    );
  }

  return rendered.join("\n");
}

function renderProvenanceItem(
  item: ExtractedItem,
  options: { includeWarnings?: boolean } = {},
): string {
  const provenance = item.provenance;
  const details = [
    `source: ${item.sourcePath}`,
    `kind: ${item.kind}`,
    `status: ${item.status ?? "unknown"}`,
    provenance ? `provenance: ${provenance.level} ${provenance.score}` : "provenance: unavailable",
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
  options: { limit?: number; includeWarnings?: boolean } = {},
): string {
  if (items.length === 0) {
    return "- None.";
  }

  const limit = options.limit ?? items.length;
  const rendered = items.slice(0, limit).map((item) => renderConfidenceItem(item, options));
  const omitted = items.length - rendered.length;

  if (omitted > 0) {
    rendered.push(
      `- ... ${omitted} more items omitted from this confidence view. See COMPILE_REPORT.json for totals.`,
    );
  }

  return rendered.join("\n");
}

function renderConfidenceItem(
  item: ExtractedItem,
  options: { includeWarnings?: boolean } = {},
): string {
  const confidence = item.confidence;
  const details = [
    `source: ${item.sourcePath}`,
    `kind: ${item.kind}`,
    `status: ${item.status ?? "unknown"}`,
    confidence ? `confidence: ${confidence.level} ${confidence.score}` : "confidence: unavailable",
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
  options: { limit?: number; includeEvidence?: boolean } = {},
): string {
  if (candidates.length === 0) {
    return "- None.";
  }

  const limit = options.limit ?? candidates.length;
  const rendered = candidates
    .slice(0, limit)
    .map((candidate) => renderContradictionCandidate(candidate, options));
  const omitted = candidates.length - rendered.length;

  if (omitted > 0) {
    rendered.push(
      `- ... ${omitted} more candidates omitted from this contradictions view. See COMPILE_REPORT.json for totals.`,
    );
  }

  return rendered.join("\n");
}

function renderContradictionCandidate(
  candidate: ContradictionCandidate,
  options: { includeEvidence?: boolean } = {},
): string {
  const details = [
    `source: ${candidate.sourcePath}`,
    `signal: ${candidate.signal}`,
    `severity: ${candidate.severity}`,
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
    ...pack.insights,
  ];
}

function renderGeneratedArtifactList(): string {
  const artifacts = [
    ...GENERATED_MARKDOWN_FILES,
    "MEMORY_DIFF.md",
    "CONTEXT_MANIFEST.json",
    "COMPILE_REPORT.json",
  ];
  return artifacts.map((artifact) => `- ${artifact}`).join("\n");
}

function renderTeamReviewQueues(pack: ContextPack): string {
  const lowConfidence = getAllItems(pack).filter((item) => item.confidence?.level === "low").length;
  const weakProvenance = pack.report.provenanceStats?.weakItems ?? 0;
  const contradictionCandidates = pack.report.contradictionStats?.totalCandidates ?? 0;

  return [
    `- Low confidence items: ${lowConfidence}`,
    `- Weak provenance items: ${weakProvenance}`,
    `- Contradiction candidates: ${contradictionCandidates}`,
    `- Warnings: ${pack.report.warnings.length}`,
    `- Parse errors: ${pack.report.parseErrors.length}`,
  ].join("\n");
}
