import type {
  CompileReport,
  ConfidenceLevel,
  ConfidenceMetadata,
  ExtractedItem
} from "./schemas/context";
import type { NoteDocument } from "./schemas/note";
import { compareStrings } from "./utils/path";

export type ExtractionConfidenceSource =
  | "explicit_marker"
  | "task_list"
  | "section_line"
  | "heading_inference";

type ConfidenceSignal = {
  label: string;
  impact: number;
};

export function scoreExtractionConfidence(
  note: NoteDocument,
  item: ExtractedItem,
  source: ExtractionConfidenceSource
): ConfidenceMetadata {
  const signals: ConfidenceSignal[] = [{ label: "deterministic local extraction", impact: 35 }];
  const warnings: string[] = [];

  addExtractionSourceSignal(signals, source);

  if (note.updated) {
    signals.push({ label: "source has updated date", impact: 10 });
  } else {
    signals.push({ label: "source missing updated date", impact: -10 });
    warnings.push("Source note has no updated date.");
  }

  if (note.noteType === "unknown") {
    signals.push({ label: "source note type is unknown", impact: -10 });
    warnings.push("Source note type is unknown.");
  } else if (note.noteType === "template") {
    signals.push({ label: "source is a template", impact: -20 });
    warnings.push("Source note is a template.");
  } else {
    signals.push({ label: `source note type is ${note.noteType}`, impact: 10 });
  }

  if (item.status && item.status !== "unknown") {
    signals.push({ label: `item status is ${item.status}`, impact: 5 });
  } else {
    signals.push({ label: "item status is unknown", impact: -5 });
    warnings.push("Extracted item status is unknown.");
  }

  if (item.priority) {
    signals.push({ label: `item priority is ${item.priority}`, impact: 3 });
  }

  return finalizeConfidence(signals, warnings);
}

export function createConfidenceStats(items: ExtractedItem[]): NonNullable<CompileReport["confidenceStats"]> {
  const scoredItems = items.filter((item) => item.confidence);
  const byLevel: Record<string, number> = {};

  for (const item of scoredItems) {
    const level = item.confidence?.level ?? "low";
    byLevel[level] = (byLevel[level] ?? 0) + 1;
  }

  const totalScore = scoredItems.reduce((sum, item) => sum + (item.confidence?.score ?? 0), 0);
  const averageScore = scoredItems.length > 0 ? roundToOneDecimal(totalScore / scoredItems.length) : 0;

  return {
    averageScore,
    byLevel: sortRecord(byLevel),
    lowItems: byLevel["low"] ?? 0,
    highItems: byLevel["high"] ?? 0
  };
}

export function compareItemsByConfidence(a: ExtractedItem, b: ExtractedItem): number {
  return (
    (a.confidence?.score ?? 0) - (b.confidence?.score ?? 0) ||
    compareStrings(a.kind, b.kind) ||
    compareStrings(a.sourcePath, b.sourcePath) ||
    compareStrings(a.text, b.text)
  );
}

function addExtractionSourceSignal(signals: ConfidenceSignal[], source: ExtractionConfidenceSource): void {
  if (source === "explicit_marker") {
    // NOTE: exporters/markdown-exporter.ts string-matches this exact label
    // (EXPLICIT_MARKER_CONFIDENCE_SIGNAL) to keep explicit-marker risks above
    // RISK_REGISTER_CAP. Do not reword without updating that consumer.
    signals.push({ label: "explicit extraction marker", impact: 35 });
    return;
  }
  if (source === "task_list") {
    signals.push({ label: "Obsidian task-list extraction", impact: 25 });
    return;
  }
  if (source === "section_line") {
    signals.push({ label: "section-pattern extraction", impact: 15 });
    return;
  }

  signals.push({ label: "heading-pattern extraction", impact: 10 });
}

function finalizeConfidence(signals: ConfidenceSignal[], warnings: string[]): ConfidenceMetadata {
  const score = clampScore(signals.reduce((sum, signal) => sum + signal.impact, 0));

  return {
    score,
    level: scoreToLevel(score),
    signals: signals.map((signal) => `${signal.impact >= 0 ? "+" : ""}${signal.impact}: ${signal.label}`),
    warnings: [...new Set(warnings)].sort()
  };
}

function scoreToLevel(score: number): ConfidenceLevel {
  if (score >= 80) {
    return "high";
  }
  if (score >= 60) {
    return "medium";
  }
  return "low";
}

function clampScore(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function sortRecord(record: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => compareStrings(left, right)));
}
