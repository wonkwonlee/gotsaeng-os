import { NoteTypeSchema, type NoteType } from "./schemas/note";

export function isNoteType(value: unknown): value is NoteType {
  return typeof value === "string" && NoteTypeSchema.safeParse(value).success;
}

export function classifyNoteType(
  sourcePath: string,
  frontmatter: Record<string, unknown> = {}
): NoteType {
  const frontmatterType = frontmatter["type"];
  if (isNoteType(frontmatterType)) {
    return frontmatterType;
  }
  if (typeof frontmatterType === "string") {
    const mappedType = mapCompatibleNoteType(frontmatterType);
    if (mappedType) {
      return mappedType;
    }
  }

  const normalizedPath = sourcePath.toLowerCase();
  const filename = normalizedPath.split("/").at(-1) ?? normalizedPath;

  if (normalizedPath.includes("templates")) {
    return "template";
  }
  if (normalizedPath.includes("decisions")) {
    return "decision";
  }
  if (normalizedPath.includes("daily") || normalizedPath.includes("/days/")) {
    return "daily";
  }
  if (normalizedPath.includes("research")) {
    return "research";
  }
  if (normalizedPath.includes("logs") && filename.includes("weekly")) {
    return "weekly-review";
  }
  if (filename.includes("weekly")) {
    return "weekly-review";
  }
  if (normalizedPath.includes("inbox") && filename.includes("chat")) {
    return "chat-export";
  }
  if (normalizedPath.includes("projects")) {
    return "project";
  }
  // Meeting and interview notes capture decisions, facts, and open questions much
  // like research notes do, so treat their folders as research rather than the
  // low-confidence `unknown` fallback.
  if (normalizedPath.includes("meetings") || normalizedPath.includes("interviews")) {
    return "research";
  }

  return "unknown";
}

export function mapCompatibleNoteType(value: string): NoteType | undefined {
  const normalized = value.trim().toLowerCase();

  const aliases: Record<string, NoteType> = {
    conversation: "chat-export",
    dashboard: "unknown",
    index: "unknown",
    log: "unknown",
    memo: "research",
    monthly: "weekly-review",
    note: "research",
    output: "unknown",
    reflection: "research",
    source: "research",
    system: "unknown",
    weekly: "weekly-review",
    wiki: "research"
  };

  return aliases[normalized];
}
