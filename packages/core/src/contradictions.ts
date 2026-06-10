import type {
  CompileReport,
  ContradictionCandidate,
  ContradictionSignal,
  ContradictionSeverity
} from "./schemas/context";
import type { NoteDocument } from "./schemas/note";
import { createDeterministicId, normalizeTextForId } from "./utils/hash";
import { compareStrings } from "./utils/path";

const CONTRADICTION_HEADING_PATTERN =
  /\b(contradictions?|conflicts?|inconsistenc(?:y|ies)|uncertainty|uncertainties|tensions?)\b|모순|충돌|불확실/iu;
const EXPLICIT_MARKER_PATTERN = /^\s*[-*]?\s*(?:contradiction|conflict|inconsistency|uncertainty|모순|충돌|불확실)\s*:\s*(?<text>.+)$/iu;
const KEYWORD_CUE_PATTERN =
  /\b(contradicts?|conflicts? with|inconsistent with|cannot both be true|on the other hand|however|but|uncertain|uncertainty|tension)\b|모순|충돌|불확실/iu;
const BULLET_PATTERN = /^\s*[-*]\s+(?:\[[ xX]\]\s+)?(?<text>.+)$/u;
const HEADING_PATTERN = /^(?<level>#{1,6})\s+(?<text>.+)$/u;
const MAX_CANDIDATE_TEXT_LENGTH = 360;

type HeadingContext = {
  title: string;
  level: number;
  contradictionSection: boolean;
};

export function detectContradictionCandidates(notes: NoteDocument[]): ContradictionCandidate[] {
  const candidates = notes.flatMap(detectNoteContradictions);
  return dedupeCandidates(candidates).sort(compareContradictionCandidates);
}

export function createContradictionStats(
  candidates: ContradictionCandidate[]
): NonNullable<CompileReport["contradictionStats"]> {
  const bySignal: Record<string, number> = {};

  for (const candidate of candidates) {
    bySignal[candidate.signal] = (bySignal[candidate.signal] ?? 0) + 1;
  }

  return {
    totalCandidates: candidates.length,
    bySignal: sortRecord(bySignal),
    reviewItems: candidates.filter((candidate) => candidate.severity === "review").length,
    watchItems: candidates.filter((candidate) => candidate.severity === "watch").length
  };
}

export function compareContradictionCandidates(a: ContradictionCandidate, b: ContradictionCandidate): number {
  return (
    compareStrings(severityRank(a.severity), severityRank(b.severity)) ||
    compareStrings(a.sourcePath, b.sourcePath) ||
    compareStrings(a.signal, b.signal) ||
    compareStrings(a.text, b.text)
  );
}

function detectNoteContradictions(note: NoteDocument): ContradictionCandidate[] {
  const candidates: ContradictionCandidate[] = [];
  const headings: HeadingContext[] = [];

  for (const line of note.body.split(/\r?\n/)) {
    const heading = parseHeading(line);
    if (heading) {
      while (headings.at(-1) && headings.at(-1)!.level >= heading.level) {
        headings.pop();
      }
      headings.push({
        title: heading.text,
        level: heading.level,
        contradictionSection: CONTRADICTION_HEADING_PATTERN.test(heading.text)
      });
      continue;
    }

    const explicit = EXPLICIT_MARKER_PATTERN.exec(line);
    if (explicit?.groups?.["text"]) {
      const candidate = createCandidate(note, explicit.groups["text"], "explicit_marker", "review", headings);
      if (candidate) {
        candidates.push(candidate);
      }
      continue;
    }

    const bulletText = BULLET_PATTERN.exec(line)?.groups?.["text"];
    const text = bulletText ?? line.trim();
    if (!text) {
      continue;
    }

    const inContradictionSection = headings.some((context) => context.contradictionSection);
    if (inContradictionSection) {
      const candidate = createCandidate(note, text, "section_heading", "review", headings);
      if (candidate) {
        candidates.push(candidate);
      }
      continue;
    }

    if (KEYWORD_CUE_PATTERN.test(text)) {
      const candidate = createCandidate(note, text, "keyword_cue", "watch", headings);
      if (candidate) {
        candidates.push(candidate);
      }
    }
  }

  return candidates;
}

function createCandidate(
  note: NoteDocument,
  rawText: string,
  signal: ContradictionSignal,
  severity: ContradictionSeverity,
  headings: HeadingContext[]
): ContradictionCandidate | undefined {
  const text = cleanCandidateText(rawText);
  if (!text) {
    return undefined;
  }

  const evidence = [
    `signal: ${signal}`,
    ...headings.map((heading) => `heading: ${heading.title}`),
    note.updated ? `updated: ${note.updated}` : "updated: missing"
  ];

  return {
    id: createDeterministicId([note.path, signal, normalizeTextForId(text)]),
    sourcePath: note.path,
    sourceTitle: note.title,
    signal,
    severity,
    text,
    evidence,
    tags: [...note.tags]
  };
}

function cleanCandidateText(text: string): string {
  const cleaned = text
    .replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, "$1")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\[|\]/g, "")
    .replace(/[*`~]/g, "")
    .replace(/^#+\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .replace(/^(?:contradiction|conflict|inconsistency|uncertainty|모순|충돌|불확실)\s*:\s*/iu, "")
    .trim()
    .replace(/\s+/g, " ");

  if (cleaned.length < 8 || cleaned.startsWith("<%") || /^https?:\/\//iu.test(cleaned)) {
    return "";
  }

  return cleaned.length > MAX_CANDIDATE_TEXT_LENGTH
    ? `${cleaned.slice(0, MAX_CANDIDATE_TEXT_LENGTH - 1).trimEnd()}...`
    : cleaned;
}

function parseHeading(line: string): { level: number; text: string } | undefined {
  const match = HEADING_PATTERN.exec(line.trim());
  const text = match?.groups?.["text"];
  const marker = match?.groups?.["level"];
  if (!text || !marker) {
    return undefined;
  }

  return {
    level: marker.length,
    text: text.trim()
  };
}

function dedupeCandidates(candidates: ContradictionCandidate[]): ContradictionCandidate[] {
  const seen = new Set<string>();
  const deduped: ContradictionCandidate[] = [];

  for (const candidate of candidates) {
    const key = `${candidate.sourcePath}|${candidate.signal}|${normalizeTextForId(candidate.text)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(candidate);
  }

  return deduped;
}

function severityRank(severity: ContradictionSeverity): string {
  return severity === "review" ? "0" : "1";
}

function sortRecord(record: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => compareStrings(left, right)));
}
