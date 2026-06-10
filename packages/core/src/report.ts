import type { CompileReport, ContextPack, ExtractedItem } from "./schemas/context";
import type { NoteDocument } from "./schemas/note";
import { compareStrings } from "./utils/path";
import { createConfidenceStats } from "./confidence";
import { createContradictionStats } from "./contradictions";
import { createProvenanceStats } from "./provenance";

export function createCompileReport(input: Omit<CompileReport, "generatedFiles">): CompileReport {
  return {
    ...input,
    generatedFiles: []
  };
}

export function getItemCounts(pack: ContextPack): Record<string, number> {
  return {
    facts: pack.facts.length,
    decisions: pack.decisions.length,
    actions: pack.actions.length,
    risks: pack.risks.length,
    assumptions: pack.assumptions.length,
    questions: pack.questions.length,
    insights: pack.insights.length,
    stale: pack.staleItems.length
  };
}

export function createExtractionStats(notes: NoteDocument[], items: ExtractedItem[]): NonNullable<CompileReport["extractionStats"]> {
  const byKind: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const sourcePathsWithItems = new Set<string>();

  for (const item of items) {
    byKind[item.kind] = (byKind[item.kind] ?? 0) + 1;
    byStatus[item.status ?? "unknown"] = (byStatus[item.status ?? "unknown"] ?? 0) + 1;
    sourcePathsWithItems.add(item.sourcePath);
  }

  return {
    totalItems: items.length,
    byKind: sortRecord(byKind),
    byStatus: sortRecord(byStatus),
    notesWithItems: sourcePathsWithItems.size,
    notesWithoutItems: notes.length - sourcePathsWithItems.size
  };
}

export function createSourceCoverage(notes: NoteDocument[]): NonNullable<CompileReport["sourceCoverage"]> {
  const noteTypes: Record<string, number> = {};

  for (const note of notes) {
    noteTypes[note.noteType] = (noteTypes[note.noteType] ?? 0) + 1;
  }

  return {
    noteTypes: sortRecord(noteTypes),
    notesWithUpdated: notes.filter((note) => note.updated).length,
    notesMissingUpdated: notes.filter((note) => !note.updated).length
  };
}

export { createConfidenceStats, createContradictionStats, createProvenanceStats };

function sortRecord(record: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => compareStrings(left, right))
  );
}
