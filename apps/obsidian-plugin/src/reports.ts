import {
  groupItemsBySource,
  inferCurrentObjective,
  renderConfidenceSummary,
  renderContradictionSummary,
  renderCoverageLines,
  renderProvenanceSummary,
  renderWarningTriage,
  selectHighSignalItems,
  titleFromGeneratedFileName,
  type CompileReport,
  type ContextPack,
  type ExtractedItem,
} from "@gotsaeng/core";

export { renderLlmHandoff } from "@gotsaeng/core";

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
// The Report Hub trims core's summaries for in-app reading: no note-type
// breakdown, and at most this many triage examples per row.
const HUB_TRIAGE_EXAMPLE_LIMIT = 5;

export function renderReportHub(pack: ContextPack, options: ReportHubOptions): string {
  const generatedAt = options.generatedAt ?? pack.generatedAt;
  const activeActions = pack.actions.filter(
    (item) => item.status === "open" || item.status === "active",
  );
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
    "## Notes Needing Metadata",
    "",
    renderMissingUpdatedNotes(pack, HUB_ITEM_LIMIT),
    "",
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
    "",
  ].join("\n");
}

export function renderWeeklyReview(pack: ContextPack): string {
  const activeActions = pack.actions.filter(
    (item) => item.status === "open" || item.status === "active",
  );
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
    renderHubWarningTriage(pack.report),
    "",
    "## Source Coverage",
    "",
    renderSourceCoverage(pack.report),
    "",
    "## Source Provenance",
    "",
    renderProvenanceSummary(pack.report),
    "",
    "## Contradiction Candidates",
    "",
    renderContradictionSummary(pack.report),
    "",
  ].join("\n");
}

function renderStringList(items: string[]): string {
  if (items.length === 0) {
    return "- None.";
  }

  return items.map((item) => `- ${item}`).join("\n");
}

function renderSourceCoverage(report: CompileReport): string {
  return renderCoverageLines(report, { includeNoteTypes: false }).join("\n");
}

function renderHubWarningTriage(report: CompileReport): string {
  return renderWarningTriage(report, { maxExamples: HUB_TRIAGE_EXAMPLE_LIMIT });
}

function renderItemList(
  items: Array<{
    text: string;
    sourcePath: string;
    status?: string;
    priority?: string;
  }>,
  limit: number,
): string {
  if (items.length === 0) {
    return "- None.";
  }

  const rendered = items.slice(0, limit).map((item) => {
    const metadata = [
      `source: ${item.sourcePath}`,
      item.status ? `status: ${item.status}` : undefined,
      item.priority ? `priority: ${item.priority}` : undefined,
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

function renderCoreReportLinks(outputFolder: string, generatedFiles: string[]): string {
  const files = generatedFiles.filter((fileName) => !fileName.endsWith(".json"));
  if (files.length === 0) {
    return "- None.";
  }

  return files
    .map(
      (fileName) =>
        `- ${toVaultWikiLink(`${outputFolder}/${fileName}`, titleFromGeneratedFileName(fileName))}`,
    )
    .join("\n");
}

function renderPluginReportLinks(outputFolder: string): string {
  return [
    `- ${toVaultWikiLink(`${outputFolder}/${REPORT_HUB_FILE}`, "Report Hub")}`,
    `- ${toVaultWikiLink(`${outputFolder}/WEEKLY_REVIEW_CONTEXT.md`, "Weekly Review Context")}`,
    `- ${toVaultWikiLink(`${outputFolder}/LLM_HANDOFF.md`, "LLM Handoff")}`,
    `- ${toVaultWikiLink(`${outputFolder}/VALIDATION_REPORT.md`, "Validation Report")}`,
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
      item.priority ? `priority: ${item.priority}` : undefined,
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
        renderHubItemList(group.items, limitPerSource),
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
    .map(
      (note) =>
        `- ${toVaultWikiLink(note.path, note.path)} (${note.noteType}; title: ${note.title})`,
    );

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

// The characters Obsidian gives structural meaning to inside a wikilink: `[`
// and `]` delimit the link, `|` starts the alias, `#` a heading reference and
// `^` a block reference.
//
// `%` is deliberately NOT in the character class. Obsidian resolves a wikilink
// target literally — it does not percent-decode it — so every `%` this encodes
// turns a link that used to open the right file into one that opens nothing.
// Encoding `%` unconditionally therefore broke click-through for every
// ordinary `%`-bearing file name ("100% done.md", "10_Wiki/a%b.md"), which is
// the common case, to protect against a pathological one.
//
// The lookahead narrows it to exactly the pathological case: a literal `%` is
// escaped only when the two characters behind it already spell one of the six
// escape codes this function emits. Without that, a real file named
// "a%5Bb.md" would go into the link untouched and come back out of
// `decodeWikiLinkReserved` (source-links.ts) as "a[b.md" — a different file.
// A `%` followed by anything else is left byte-identical, so the click-through
// regression is narrowed to file names that already look percent-encoded.
//
// String.replace scans the original string once, so the "%25" this produces is
// never re-scanned — the ordering that would otherwise double-encode the
// escapes for `[`/`]`/etc. cannot arise. It is also why an unescaped literal
// `%` can never be mistaken for an escape on the way back: the only sequences
// that follow it in the output are either the original characters (which the
// lookahead just proved are not an escape code) or an emitted escape, whose
// own `%` sits between the two.
const WIKILINK_RESERVED = /%(?=25|5B|5D|7C|23|5E)|[[\]|#^]/giu;
// The subset that breaks a *label*. `#` and `^` carry no meaning after the
// alias separator, so they are left alone rather than mangling display text.
const WIKILINK_LABEL_RESERVED = /[[\]|]/gu;

/**
 * Renders `[[path|label]]` for a vault path. Reserved characters in the path
 * are percent-encoded rather than replaced: only `|` used to be handled, and
 * by substituting a space — which silently produced a *different* path, and
 * left `#`/`[`/`]`/`^` to break the link outright. The encoding is what makes
 * the link survive a round trip back through `extractSourceLinks`, whose path
 * pattern excludes exactly these characters (see `decodeWikiLinkReserved` in
 * source-links.ts). `%` is escaped only in the one case that would otherwise
 * round-trip to the wrong file — see the comment on WIKILINK_RESERVED for why
 * escaping it any more widely costs real click-through in Obsidian.
 */
export function toVaultWikiLink(pathOrLinkText: string, label: string): string {
  const safePath = pathOrLinkText.replace(WIKILINK_RESERVED, encodeReservedChar);
  const safeLabel = label.replace(WIKILINK_LABEL_RESERVED, " ");
  return `[[${safePath}|${safeLabel}]]`;
}

function encodeReservedChar(char: string): string {
  return `%${char.charCodeAt(0).toString(16).toUpperCase()}`;
}
