import path from "node:path";

import matter from "gray-matter";

import type { FileSystemAdapter } from "./adapters/file-system";
import { classifyNoteType, isNoteType, mapCompatibleNoteType } from "./classifier";
import { NoteDocumentSchema, type NoteDocument } from "./schemas/note";
import { createDeterministicId } from "./utils/hash";
import { describeValue } from "./utils/describe";
import { isValidDateLike, normalizeDateValue } from "./utils/date";
import { titleFromFilename, toRelativeSourcePath } from "./utils/path";

export type ValidationIssue = {
  path: string;
  severity: "warning" | "error";
  message: string;
};

export type ValidationOptions = {
  strict?: boolean;
};

export async function parseMarkdownFile(
  fsAdapter: FileSystemAdapter,
  filePath: string,
  rootPath: string,
): Promise<NoteDocument> {
  const raw = await fsAdapter.readText(filePath);
  if (raw === null) {
    throw new Error(`Source file not found: ${filePath}`);
  }
  return parseMarkdown(raw, filePath, rootPath);
}

export function parseMarkdown(raw: string, filePath: string, rootPath: string): NoteDocument {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedFile = path.resolve(filePath);
  const parsed = matter(raw);
  const sourcePath = toRelativeSourcePath(resolvedRoot, resolvedFile);
  const frontmatter = normalizeFrontmatter(parsed.data);
  const title = inferTitle(frontmatter, parsed.content, resolvedFile);
  const noteType = classifyNoteType(sourcePath, frontmatter);
  const note = {
    id: createDeterministicId(["note", sourcePath]),
    path: sourcePath,
    title,
    body: parsed.content.trim(),
    frontmatter,
    noteType,
    tags: normalizeTags(frontmatter["tags"]),
    created: normalizeDateValue(frontmatter["created"]),
    updated: normalizeDateValue(frontmatter["updated"]),
    raw,
  };

  return NoteDocumentSchema.parse(note);
}

export function inferTitle(
  frontmatter: Record<string, unknown>,
  body: string,
  filePath: string,
): string {
  const frontmatterTitle = frontmatter["title"];
  if (typeof frontmatterTitle === "string" && frontmatterTitle.trim().length > 0) {
    return frontmatterTitle.trim();
  }

  const heading = /^#\s+(.+)$/m.exec(body);
  if (heading?.[1]) {
    return heading[1].trim();
  }

  return titleFromFilename(filePath);
}

export function normalizeTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .flatMap((item) => item.split(","))
      .map((tag) => tag.trim().replace(/^#/, ""))
      .filter(Boolean)
      .sort();
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((tag) => tag.trim().replace(/^#/, ""))
      .filter(Boolean)
      .sort();
  }

  return [];
}

export function validateNoteMetadata(
  note: NoteDocument,
  options: ValidationOptions = {},
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const strict = options.strict ?? true;

  if (!hasExplicitTitle(note)) {
    issues.push({
      path: note.path,
      severity: "warning",
      message: "Missing explicit title; inferred from filename.",
    });
  }

  const rawType = note.frontmatter["type"];
  if (rawType !== undefined && !isNoteType(rawType)) {
    const mappedType = typeof rawType === "string" ? mapCompatibleNoteType(rawType) : undefined;
    issues.push({
      path: note.path,
      severity: strict ? "error" : "warning",
      message: strict
        ? `Invalid note type: ${describeValue(rawType)}.`
        : mappedType
          ? `Custom note type: ${describeValue(rawType)}; mapped to ${mappedType}.`
          : `Unsupported note type: ${describeValue(rawType)}; inferred ${note.noteType}.`,
    });
  }

  const rawTags = note.frontmatter["tags"];
  if (
    rawTags !== undefined &&
    !(
      typeof rawTags === "string" ||
      (Array.isArray(rawTags) && rawTags.every((tag) => typeof tag === "string"))
    )
  ) {
    issues.push({
      path: note.path,
      severity: "error",
      message: "Invalid tags; expected a string or an array of strings.",
    });
  }

  for (const field of ["created", "updated"] as const) {
    const value = note.frontmatter[field];
    if (value !== undefined && !isValidDateLike(value)) {
      issues.push({
        path: note.path,
        severity: strict ? "error" : "warning",
        message: strict
          ? `Invalid ${field} date: ${describeValue(value)}.`
          : `Unvalidated ${field} date: ${describeValue(value)}.`,
      });
    }
  }

  if (!note.updated) {
    issues.push({
      path: note.path,
      severity: "warning",
      message: "Missing updated field.",
    });
  }

  return issues;
}

function normalizeFrontmatter(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, normalizeFrontmatterValue(value)]),
  );
}

function normalizeFrontmatterValue(value: unknown): unknown {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (Array.isArray(value)) {
    return value.map(normalizeFrontmatterValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
        key,
        normalizeFrontmatterValue(nestedValue),
      ]),
    );
  }

  return value;
}

function hasExplicitTitle(note: NoteDocument): boolean {
  const title = note.frontmatter["title"];
  if (typeof title === "string" && title.trim().length > 0) {
    return true;
  }

  return /^#\s+.+$/m.test(note.body);
}
