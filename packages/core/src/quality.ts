import type { CompileReport, ContextPack, ExtractedItem } from "./schemas/context";
import type { NoteDocument } from "./schemas/note";
import { compareStrings } from "./utils/path";

export type ObjectiveInference = {
  text: string;
  sourcePath?: string;
  confidence: "explicit" | "inferred" | "none";
  reason: string;
};

export type SourceGroup<T> = {
  sourcePath: string;
  sourceTitle: string;
  items: T[];
};

export type WarningTriageItem = {
  label: string;
  count: number;
  severity: "info" | "warning" | "error";
  examples: string[];
};

export type WarningTriage = {
  totalWarnings: number;
  totalParseErrors: number;
  items: WarningTriageItem[];
};

const OBJECTIVE_FRONTMATTER_KEYS = ["objective", "currentObjective", "goal", "mission"] as const;
const OBJECTIVE_HEADINGS = [
  "Current Objective",
  "Objective",
  "Goal",
  "Mission",
  "North Star",
  "Focus",
  "Current Focus",
  "프로젝트 목표",
  "목표"
];
const MAX_OBJECTIVE_LENGTH = 220;
const WARNING_EXAMPLE_LIMIT = 8;

export function inferCurrentObjective(pack: ContextPack): ObjectiveInference {
  const projectNotes = pack.notes
    .filter((note) => note.noteType === "project")
    .sort(compareNotesByPriority);

  for (const note of projectNotes) {
    const fromFrontmatter = extractObjectiveFromFrontmatter(note);
    if (fromFrontmatter) {
      return {
        text: fromFrontmatter,
        sourcePath: note.path,
        confidence: "explicit",
        reason: "Read from project note frontmatter."
      };
    }

    const fromSection = extractObjectiveFromSections(note);
    if (fromSection) {
      return {
        text: fromSection,
        sourcePath: note.path,
        confidence: "explicit",
        reason: "Read from a project note objective section."
      };
    }
  }

  const highPriorityAction = pack.actions.find(
    (item) => item.priority === "high" && (item.status === "open" || item.status === "active")
  );
  if (highPriorityAction) {
    return {
      text: highPriorityAction.text,
      sourcePath: highPriorityAction.sourcePath,
      confidence: "inferred",
      reason: "Inferred from the first high-priority open action."
    };
  }

  const activeAction = pack.actions.find((item) => item.status === "open" || item.status === "active");
  if (activeAction) {
    return {
      text: activeAction.text,
      sourcePath: activeAction.sourcePath,
      confidence: "inferred",
      reason: "Inferred from the first open action."
    };
  }

  return {
    text: "No explicit objective found.",
    confidence: "none",
    reason: "No objective frontmatter, objective section, or open action was found."
  };
}

export function groupItemsBySource<T extends { sourcePath: string; sourceTitle: string }>(items: T[]): SourceGroup<T>[] {
  const groups = new Map<string, SourceGroup<T>>();

  for (const item of items) {
    const existing = groups.get(item.sourcePath);
    if (existing) {
      existing.items.push(item);
    } else {
      groups.set(item.sourcePath, {
        sourcePath: item.sourcePath,
        sourceTitle: item.sourceTitle,
        items: [item]
      });
    }
  }

  return [...groups.values()].sort((left, right) => {
      const count = right.items.length - left.items.length;
      if (count !== 0) {
        return count;
      }
      return compareStrings(left.sourcePath, right.sourcePath);
    });
}

export function selectHighSignalItems(items: ExtractedItem[], limit: number): ExtractedItem[] {
  return [...items].sort(compareItemsBySignal).slice(0, limit);
}

export function createWarningTriage(report: CompileReport): WarningTriage {
  const parseErrors = report.parseErrors.map((error) => `${error.path}: ${error.message}`);
  const missingUpdated = report.warnings
    .filter((warning) => warning.startsWith("Missing updated field: "))
    .map((warning) => warning.replace("Missing updated field: ", ""));
  const otherWarnings = report.warnings.filter((warning) => !warning.startsWith("Missing updated field: "));

  const items: WarningTriageItem[] = [];
  if (parseErrors.length > 0) {
    items.push({
      label: "Parse errors",
      count: parseErrors.length,
      severity: "error",
      examples: parseErrors.slice(0, WARNING_EXAMPLE_LIMIT)
    });
  }
  if (missingUpdated.length > 0) {
    items.push({
      label: "Notes missing updated dates",
      count: missingUpdated.length,
      severity: "warning",
      examples: missingUpdated.slice(0, WARNING_EXAMPLE_LIMIT)
    });
  }
  if (otherWarnings.length > 0) {
    items.push({
      label: "Other warnings",
      count: otherWarnings.length,
      severity: "warning",
      examples: otherWarnings.slice(0, WARNING_EXAMPLE_LIMIT)
    });
  }

  return {
    totalWarnings: report.warnings.length,
    totalParseErrors: report.parseErrors.length,
    items
  };
}

function extractObjectiveFromFrontmatter(note: NoteDocument): string | undefined {
  for (const key of OBJECTIVE_FRONTMATTER_KEYS) {
    const value = note.frontmatter[key];
    if (typeof value === "string" && value.trim()) {
      return clampObjective(value.trim());
    }
  }

  return undefined;
}

function extractObjectiveFromSections(note: NoteDocument): string | undefined {
  for (const heading of OBJECTIVE_HEADINGS) {
    const value = extractSectionFirstLine(note.body, heading);
    if (value) {
      return clampObjective(value);
    }
  }

  return undefined;
}

function extractSectionFirstLine(markdown: string, heading: string): string | undefined {
  const lines = markdown.split(/\r?\n/);
  const headingPattern = new RegExp(`^#{1,3}\\s+${escapeRegExp(heading)}\\s*$`, "i");
  const start = lines.findIndex((line) => headingPattern.test(line.trim()));
  if (start === -1) {
    return undefined;
  }

  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim();
    if (/^#{1,6}\s+/.test(trimmed)) {
      return undefined;
    }
    if (trimmed.length > 0) {
      return trimmed.replace(/^[-*]\s+/, "");
    }
  }

  return undefined;
}

function compareNotesByPriority(left: NoteDocument, right: NoteDocument): number {
  const priority = compareStrings(priorityRank(right.frontmatter["priority"]), priorityRank(left.frontmatter["priority"]));
  if (priority !== 0) {
    return priority;
  }

  return compareStrings(right.updated ?? "", left.updated ?? "") || compareStrings(left.path, right.path);
}

function compareItemsBySignal(left: ExtractedItem, right: ExtractedItem): number {
  const priority = signalScore(right) - signalScore(left);
  if (priority !== 0) {
    return priority;
  }

  const source = compareStrings(left.sourcePath, right.sourcePath);
  if (source !== 0) {
    return source;
  }

  return compareStrings(left.text, right.text);
}

function signalScore(item: ExtractedItem): number {
  const priorityScore = item.priority === "high" ? 50 : item.priority === "medium" ? 25 : item.priority === "low" ? 5 : 0;
  const statusScore = item.status === "active" ? 20 : item.status === "open" ? 15 : item.status === "unknown" ? 3 : 0;
  const updatedScore = item.updated ? 5 : 0;
  return priorityScore + statusScore + updatedScore;
}

function priorityRank(value: unknown): string {
  if (value === "high") {
    return "3";
  }
  if (value === "medium") {
    return "2";
  }
  if (value === "low") {
    return "1";
  }
  return "0";
}

function clampObjective(value: string): string {
  if (value.length <= MAX_OBJECTIVE_LENGTH) {
    return value;
  }

  return `${value.slice(0, MAX_OBJECTIVE_LENGTH - 3).trimEnd()}...`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
