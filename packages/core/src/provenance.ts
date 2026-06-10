import type {
  CompileReport,
  ExtractedItem,
  SourceProvenance,
  SourceProvenanceLevel
} from "./schemas/context";
import type { NoteDocument } from "./schemas/note";
import { compareStrings } from "./utils/path";

type ProvenanceSignal = {
  label: string;
  impact: number;
};

const PROVENANCE_CALIBRATION = "v0.10-local-metadata";

export function applySourceProvenance(notes: NoteDocument[], items: ExtractedItem[]): ExtractedItem[] {
  const notesByPath = new Map(notes.map((note) => [note.path, note]));

  return items.map((item) => {
    const note = notesByPath.get(item.sourcePath);
    return {
      ...item,
      provenance: scoreSourceProvenance(note, item)
    };
  });
}

export function scoreSourceProvenance(note: NoteDocument | undefined, item?: ExtractedItem): SourceProvenance {
  const signals: ProvenanceSignal[] = [{ label: "baseline local Markdown source", impact: 45 }];
  const warnings: string[] = [];

  if (!note) {
    signals.push({ label: "source note missing from compile set", impact: -35 });
    warnings.push("Source note was not available during provenance scoring.");
    return finalizeProvenance(signals, warnings);
  }

  if (note.updated) {
    signals.push({ label: "source has updated date", impact: 15 });
  } else {
    signals.push({ label: "source missing updated date", impact: -20 });
    warnings.push("Source note has no updated date.");
  }

  if (note.created) {
    signals.push({ label: "source has created date", impact: 5 });
  }

  if (hasExplicitTitle(note)) {
    signals.push({ label: "source has explicit title", impact: 5 });
  }

  if (note.tags.length > 0) {
    signals.push({ label: "source has tags", impact: 5 });
  }

  if (note.noteType === "unknown") {
    signals.push({ label: "source note type is unknown", impact: -10 });
    warnings.push("Source note type is unknown.");
  } else if (note.noteType === "template") {
    signals.push({ label: "source is a template", impact: -25 });
    warnings.push("Source note is a template.");
  } else {
    signals.push({ label: `source note type is ${note.noteType}`, impact: 10 });
  }

  if (hasKnownFrontmatterStatus(note)) {
    signals.push({ label: "source has frontmatter status", impact: 5 });
  }

  if (item?.status && item.status !== "unknown") {
    signals.push({ label: `item status is ${item.status}`, impact: 5 });
  } else if (item) {
    signals.push({ label: "item status is unknown", impact: -10 });
    warnings.push("Extracted item status is unknown.");
  }

  if (item?.priority) {
    signals.push({ label: `item priority is ${item.priority}`, impact: 3 });
  }

  return finalizeProvenance(signals, warnings);
}

export function createProvenanceStats(items: ExtractedItem[]): NonNullable<CompileReport["provenanceStats"]> {
  const scoredItems = items.filter((item) => item.provenance);
  const byLevel: Record<string, number> = {};

  for (const item of scoredItems) {
    const level = item.provenance?.level ?? "weak";
    byLevel[level] = (byLevel[level] ?? 0) + 1;
  }

  const totalScore = scoredItems.reduce((sum, item) => sum + (item.provenance?.score ?? 0), 0);
  const averageScore = scoredItems.length > 0 ? roundToOneDecimal(totalScore / scoredItems.length) : 0;

  return {
    averageScore,
    byLevel: sortRecord(byLevel),
    weakItems: byLevel["weak"] ?? 0,
    moderateItems: byLevel["moderate"] ?? 0,
    strongItems: byLevel["strong"] ?? 0
  };
}

export function compareItemsByProvenance(a: ExtractedItem, b: ExtractedItem): number {
  return (
    (a.provenance?.score ?? 0) - (b.provenance?.score ?? 0) ||
    compareStrings(a.kind, b.kind) ||
    compareStrings(a.sourcePath, b.sourcePath) ||
    compareStrings(a.text, b.text)
  );
}

function finalizeProvenance(signals: ProvenanceSignal[], warnings: string[]): SourceProvenance {
  const score = clampScore(signals.reduce((sum, signal) => sum + signal.impact, 0));

  return {
    score,
    level: scoreToLevel(score),
    calibration: PROVENANCE_CALIBRATION,
    signals: signals.map((signal) => `${signal.impact >= 0 ? "+" : ""}${signal.impact}: ${signal.label}`),
    warnings: [...new Set(warnings)].sort()
  };
}

function scoreToLevel(score: number): SourceProvenanceLevel {
  if (score >= 80) {
    return "strong";
  }
  if (score >= 60) {
    return "moderate";
  }
  return "weak";
}

function clampScore(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function hasExplicitTitle(note: NoteDocument): boolean {
  const frontmatterTitle = note.frontmatter["title"];
  if (typeof frontmatterTitle === "string" && frontmatterTitle.trim().length > 0) {
    return true;
  }

  return /^#\s+.+$/m.test(note.body);
}

function hasKnownFrontmatterStatus(note: NoteDocument): boolean {
  const status = note.frontmatter["status"];
  return typeof status === "string" && status.trim().length > 0 && !status.includes("<%");
}

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function sortRecord(record: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => compareStrings(left, right)));
}
