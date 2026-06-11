import type {
  ExtractedItem,
  ExtractedItemKind,
  ExtractedItemPriority,
  ExtractedItemStatus
} from "./schemas/context";
import { scoreExtractionConfidence, type ExtractionConfidenceSource } from "./confidence";
import type { NoteDocument } from "./schemas/note";
import { createDeterministicId, normalizeTextForId } from "./utils/hash";
import { compareStrings } from "./utils/path";

const MARKER_TO_KIND: Record<string, ExtractedItemKind> = {
  fact: "fact",
  사실: "fact",
  decision: "decision",
  결정: "decision",
  action: "action",
  todo: "action",
  할일: "action",
  작업: "action",
  risk: "risk",
  위험: "risk",
  assumption: "assumption",
  가정: "assumption",
  question: "question",
  질문: "question",
  insight: "insight",
  통찰: "insight"
};

const MARKER_NAMES = Object.keys(MARKER_TO_KIND).join("|");

const LIST_ITEM_PREFIX_PATTERN = String.raw`(?:[-*]|\d+\.)`;

const BULLET_MARKER_PATTERN =
  new RegExp(
    `^\\s*${LIST_ITEM_PREFIX_PATTERN}\\s+(?:\\[(?<checked>[ xX])\\]\\s+)?(?<marker>${MARKER_NAMES}):\\s*(?<text>.+)$`,
    "i"
  );

const HEADING_MARKER_PATTERN =
  new RegExp(`^\\s*(?<marker>${MARKER_NAMES}):\\s*(?<text>.+)$`, "i");

const TASK_PATTERN = new RegExp(
  `^\\s*${LIST_ITEM_PREFIX_PATTERN}\\s+\\[(?<checked>[ xX])\\]\\s+(?<text>.+)$`
);
const BULLET_PATTERN = /^\s*[-*]\s+(?<text>.+)$/;
const HEADING_PATTERN = /^(?<level>#{1,6})\s+(?<text>.+)$/;

const MAX_ITEM_TEXT_LENGTH = 360;

// Inferred (non-explicit) extraction can balloon on research vaults where a single
// "Risks"/"Questions" heading is followed by dozens of bullets. Cap how many
// section_line items a single heading may emit. Explicit markers are exempt.
export const MAX_SECTION_LINE_ITEMS_PER_HEADING = 12;

export function extractItems(note: NoteDocument): ExtractedItem[] {
  const items: ExtractedItem[] = [];
  const lines = note.body.split(/\r?\n/);
  let currentSection: SectionContext | undefined;

  for (const line of lines) {
    const heading = parseHeading(line);
    if (heading) {
      currentSection = {
        title: heading.text,
        kind: classifySectionHeading(heading.text),
        level: heading.level,
        emittedCount: 0
      };

      const headingItem = extractHeadingItem(heading.text, note, currentSection);
      if (headingItem) {
        items.push(headingItem);
      }
      continue;
    }

    const explicitItem = extractExplicitLine(line, note);
    if (explicitItem) {
      items.push(explicitItem);
      continue;
    }

    const taskItem = extractTaskLine(line, note, currentSection);
    if (taskItem) {
      items.push(taskItem);
      continue;
    }

    const sectionItem = extractSectionLine(line, note, currentSection);
    if (sectionItem) {
      items.push(sectionItem);
      if (currentSection) {
        currentSection.emittedCount += 1;
      }
    }
  }

  return sortExtractedItems(dedupeExtractedItems(items));
}

export function sortExtractedItems(items: ExtractedItem[]): ExtractedItem[] {
  return [...items].sort((a, b) => {
    const kind = compareStrings(a.kind, b.kind);
    if (kind !== 0) {
      return kind;
    }
    const source = compareStrings(a.sourcePath, b.sourcePath);
    if (source !== 0) {
      return source;
    }
    return compareStrings(a.text, b.text);
  });
}

type SectionContext = {
  title: string;
  kind: ExtractedItemKind | undefined;
  level: number;
  emittedCount: number;
};

function extractExplicitLine(line: string, note: NoteDocument): ExtractedItem | undefined {
  const match = BULLET_MARKER_PATTERN.exec(line) ?? HEADING_MARKER_PATTERN.exec(line);
  const marker = match?.groups?.["marker"]?.toLowerCase();
  const rawText = match?.groups?.["text"];

  if (!marker || !rawText) {
    return undefined;
  }

  const kind = MARKER_TO_KIND[marker];
  if (!kind) {
    return undefined;
  }

  return createItem({
    note,
    kind,
    text: rawText,
    line,
    confidenceSource: "explicit_marker"
  });
}

function extractTaskLine(
  line: string,
  note: NoteDocument,
  section: SectionContext | undefined
): ExtractedItem | undefined {
  if (!shouldUseInferredExtraction(note)) {
    return undefined;
  }

  const match = TASK_PATTERN.exec(line);
  const rawText = match?.groups?.["text"];
  if (!rawText || HEADING_MARKER_PATTERN.test(rawText)) {
    return undefined;
  }

  const taskSection = section?.title ? normalizeSectionTitle(section.title) : undefined;
  if (taskSection && isIgnoredTaskSection(taskSection)) {
    return undefined;
  }

  const text =
    taskSection && !isGenericTaskSection(taskSection)
      ? `${taskSection}: ${rawText}`
      : rawText;

  const kind = section?.kind === "question" ? "question" : "action";
  return createItem({
    note,
    kind,
    text,
    line,
    confidenceSource: "task_list"
  });
}

function extractSectionLine(
  line: string,
  note: NoteDocument,
  section: SectionContext | undefined
): ExtractedItem | undefined {
  if (!section?.kind || !shouldUseInferredExtraction(note)) {
    return undefined;
  }

  if (section.level > 2 && section.kind !== "insight") {
    return undefined;
  }

  if (section.emittedCount >= MAX_SECTION_LINE_ITEMS_PER_HEADING) {
    return undefined;
  }

  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(">") || trimmed === "---") {
    return undefined;
  }

  const bullet = BULLET_PATTERN.exec(line);
  if (bullet?.groups?.["text"]) {
    return createItem({
      note,
      kind: section.kind,
      text: bullet.groups["text"],
      line,
      confidenceSource: "section_line"
    });
  }

  if (isSectionParagraphCandidate(trimmed, section.kind)) {
    return createItem({
      note,
      kind: section.kind,
      text: trimmed,
      line,
      confidenceSource: "section_line"
    });
  }

  return undefined;
}

function extractHeadingItem(
  headingText: string,
  note: NoteDocument,
  section: SectionContext
): ExtractedItem | undefined {
  if (!shouldUseInferredExtraction(note) || section.level < 3) {
    return undefined;
  }

  const parentKind = section.kind ?? classifySubheading(headingText);
  if (!parentKind) {
    return undefined;
  }

  return createItem({
    note,
    kind: parentKind,
    text: headingText,
    line: headingText,
    confidenceSource: "heading_inference"
  });
}

function createItem(input: {
  note: NoteDocument;
  kind: ExtractedItemKind;
  text: string;
  line: string;
  confidenceSource: ExtractionConfidenceSource;
}): ExtractedItem | undefined {
  const { text, truncatedFrom } = cleanExtractedText(input.text);
  if (!text) {
    return undefined;
  }

  const item = {
    id: createDeterministicId([input.note.path, input.kind, normalizeTextForId(text)]),
    sourcePath: input.note.path,
    sourceTitle: input.note.title,
    kind: input.kind,
    text,
    status: inferStatus(input.line),
    priority: inferPriority(input.line),
    created: input.note.created,
    updated: input.note.updated,
    tags: [...input.note.tags]
  };

  const confidence = scoreExtractionConfidence(
    input.note,
    item,
    input.confidenceSource,
    truncatedFrom !== undefined
      ? { truncation: { originalLength: truncatedFrom, maxLength: MAX_ITEM_TEXT_LENGTH } }
      : {}
  );

  return { ...item, confidence };
}

type CleanedText = { text: string; truncatedFrom?: number };

function cleanExtractedText(text: string): CleanedText {
  const cleaned = text
    .replace(/\s+\bstatus:\s*(open|active|done|stale|unknown)\b/gi, "")
    .replace(/\s+\bpriority:\s*(low|medium|high)\b/gi, "")
    .replace(/\s+!(low|medium|high)\b/gi, "")
    .replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, "$1")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\[|\]/g, "")
    .replace(/[*`~]/g, "")
    .replace(/[⏫🔼🔽]/gu, "")
    .replace(/^#+\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .trim()
    .replace(/\s+/g, " ");

  if (
    cleaned.length < 3 ||
    cleaned.startsWith("<%") ||
    /^https?:\/\//i.test(cleaned) ||
    cleaned.toLowerCase() === "none"
  ) {
    return { text: "" };
  }

  if (cleaned.length > MAX_ITEM_TEXT_LENGTH) {
    return {
      text: `${cleaned.slice(0, MAX_ITEM_TEXT_LENGTH - 1).trimEnd()}...`,
      truncatedFrom: cleaned.length
    };
  }

  return { text: cleaned };
}

function inferStatus(line: string): ExtractedItemStatus {
  if (/\[[xX]\]/.test(line)) {
    return "done";
  }
  if (/\[\s\]/.test(line)) {
    return "open";
  }
  if (/\bstatus:\s*done\b/i.test(line)) {
    return "done";
  }
  if (/\bstatus:\s*active\b/i.test(line)) {
    return "active";
  }
  if (/\bstatus:\s*open\b/i.test(line)) {
    return "open";
  }
  if (/\bstatus:\s*stale\b/i.test(line)) {
    return "stale";
  }
  return "unknown";
}

function inferPriority(line: string): ExtractedItemPriority | undefined {
  const explicit = /\bpriority:\s*(high|medium|low)\b/i.exec(line)?.[1]?.toLowerCase();
  if (explicit === "high" || explicit === "medium" || explicit === "low") {
    return explicit;
  }

  const shorthand = /!(high|medium|low)\b/i.exec(line)?.[1]?.toLowerCase();
  if (shorthand === "high" || shorthand === "medium" || shorthand === "low") {
    return shorthand;
  }

  if (line.includes("⏫")) {
    return "high";
  }
  if (line.includes("🔼")) {
    return "medium";
  }
  if (line.includes("🔽")) {
    return "low";
  }

  return undefined;
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

function classifySectionHeading(heading: string): ExtractedItemKind | undefined {
  const normalized = heading.toLowerCase();

  if (/(open questions?|questions?|todo|tasks?|next actions?|backlog|할 ?일|질문)/i.test(normalized)) {
    return "question";
  }
  if (/(decisions?|verdict|decision log|결정|판단)/i.test(normalized)) {
    return "decision";
  }
  if (/(risks?|contradictions?|uncertainty|warnings?|caution|위험|불확실)/i.test(normalized)) {
    return "risk";
  }
  if (/(assumptions?|가정)/i.test(normalized)) {
    return "assumption";
  }
  if (/(facts?|claims?|source metadata|entities|사실|주장)/i.test(normalized)) {
    return "fact";
  }
  if (
    /(summary|key points?|tl;dr|core thesis|core insight|insights?|why this matters|context|signals?|how to use|raw thought|요약|핵심|통찰)/i.test(
      normalized
    )
  ) {
    return "insight";
  }

  return classifySubheading(heading);
}

function classifySubheading(heading: string): ExtractedItemKind | undefined {
  const normalized = heading.toLowerCase();

  if (/^(signal|bucket)\s+\d+/i.test(normalized)) {
    return "insight";
  }
  if (/^\d+\./.test(normalized)) {
    return "insight";
  }
  if (/(risk|위험)/i.test(normalized)) {
    return "risk";
  }
  if (/(question|질문)/i.test(normalized)) {
    return "question";
  }
  if (/(decision|verdict|결정)/i.test(normalized)) {
    return "decision";
  }

  return undefined;
}

function shouldUseInferredExtraction(note: NoteDocument): boolean {
  if (note.noteType === "template") {
    return false;
  }

  if (note.path.startsWith("00_System/templates/")) {
    return false;
  }
  if (
    note.path.startsWith("00_System/workflows/") ||
    note.path.startsWith("90_Archive/") ||
    note.path === "CLAUDE.md"
  ) {
    return false;
  }

  return true;
}

function isSectionParagraphCandidate(text: string, kind: ExtractedItemKind): boolean {
  if (text.length < 20 || text.includes("|")) {
    return false;
  }
  if (/^(links?|sources?|related)$/i.test(text)) {
    return false;
  }
  if (kind === "question") {
    return /[?？]$/.test(text) || /^(question|질문)\s*:/i.test(text);
  }

  return kind === "insight" || kind === "decision" || kind === "risk" || kind === "fact";
}

function normalizeSectionTitle(title: string): string {
  return cleanExtractedText(title).text.replace(/:$/, "");
}

function isGenericTaskSection(title: string): boolean {
  return /^(todo|tasks?|open questions?|next actions?|backlog|할 ?일|질문)$/i.test(title.trim());
}

function isIgnoredTaskSection(title: string): boolean {
  return /(routine|루틴|식단|운동|health check|habit)/i.test(title.trim());
}

function dedupeExtractedItems(items: ExtractedItem[]): ExtractedItem[] {
  const seen = new Set<string>();
  const deduped: ExtractedItem[] = [];

  for (const item of items) {
    const key = `${item.kind}|${item.sourcePath}|${normalizeTextForId(item.text)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}
