import { describe, expect, it } from "vitest";

import {
  CompileOptionsSchema,
  CompileReportSchema,
  ContextManifestItemSchema,
  ExtractedItemSchema,
  NoteDocumentSchema,
} from "../src/index";

// These schemas are at 100% line coverage already. These tests do not restate
// the schema shape; they pin two things downstream code actually relies on:
// (1) `.parse()` throwing on malformed input (the compiler treats a thrown
// ZodError as "this is invalid", not as a crash), and (2) defaults/optionality
// that other modules read without re-checking.

describe("NoteDocumentSchema", () => {
  it("rejects a note with an empty title", () => {
    expect(() => NoteDocumentSchema.parse(validNote({ title: "" }))).toThrow();
  });

  it("rejects an unrecognized noteType", () => {
    expect(() => NoteDocumentSchema.parse(validNote({ noteType: "essay" }))).toThrow();
  });

  it("parses successfully without created/updated (parser.ts relies on these staying optional)", () => {
    const note = validNote();
    delete note.created;
    delete note.updated;
    expect(() => NoteDocumentSchema.parse(note)).not.toThrow();
  });
});

describe("ExtractedItemSchema", () => {
  it("rejects an item with an unrecognized kind", () => {
    expect(() => ExtractedItemSchema.parse(validItem({ kind: "todo" }))).toThrow();
  });

  it("rejects an item with empty text", () => {
    expect(() => ExtractedItemSchema.parse(validItem({ text: "" }))).toThrow();
  });

  it("parses successfully without status/priority/created/updated (extractor.ts relies on these staying optional)", () => {
    const item = validItem();
    delete item.status;
    delete item.priority;
    delete item.created;
    delete item.updated;
    expect(() => ExtractedItemSchema.parse(item)).not.toThrow();
  });
});

describe("ContextManifestItemSchema", () => {
  it("requires the `stale` flag that memory-diff.ts reads unconditionally", () => {
    expect(() => ContextManifestItemSchema.parse(validItem())).toThrow();
    expect(() => ContextManifestItemSchema.parse({ ...validItem(), stale: false })).not.toThrow();
  });
});

describe("CompileReportSchema", () => {
  it("rejects negative file counts", () => {
    expect(() => CompileReportSchema.parse({ ...validReport(), filesScanned: -1 })).toThrow();
  });

  it("parses successfully with every stats section omitted (report.ts builds them conditionally)", () => {
    expect(() => CompileReportSchema.parse(validReport())).not.toThrow();
  });
});

describe("CompileOptionsSchema", () => {
  it("defaults staleDays to 90 when omitted (compiler.ts and stale.ts both read this default)", () => {
    const parsed = CompileOptionsSchema.parse({
      sourceRoot: "/vault",
      projectName: "Project",
    });
    expect(parsed.staleDays).toBe(90);
  });

  it("rejects an empty sourceRoot or projectName", () => {
    expect(() => CompileOptionsSchema.parse({ sourceRoot: "", projectName: "Project" })).toThrow();
    expect(() => CompileOptionsSchema.parse({ sourceRoot: "/vault", projectName: "" })).toThrow();
  });

  it("rejects a non-positive staleDays instead of silently accepting 0 or negative windows", () => {
    expect(() =>
      CompileOptionsSchema.parse({ sourceRoot: "/vault", projectName: "Project", staleDays: 0 }),
    ).toThrow();
    expect(() =>
      CompileOptionsSchema.parse({ sourceRoot: "/vault", projectName: "Project", staleDays: -5 }),
    ).toThrow();
  });

  it("leaves caps undefined when omitted so extractor.ts/markdown-exporter.ts fall back to their own defaults (#10)", () => {
    const parsed = CompileOptionsSchema.parse({ sourceRoot: "/vault", projectName: "Project" });
    expect(parsed.caps).toBeUndefined();
  });

  it("accepts a partial caps override and rejects non-positive cap values", () => {
    const parsed = CompileOptionsSchema.parse({
      sourceRoot: "/vault",
      projectName: "Project",
      caps: { register: 50 },
    });
    expect(parsed.caps).toEqual({ register: 50 });

    expect(() =>
      CompileOptionsSchema.parse({
        sourceRoot: "/vault",
        projectName: "Project",
        caps: { perHeading: 0 },
      }),
    ).toThrow();
  });
});

function validNote(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "note",
    path: "source.md",
    title: "Source",
    body: "Body",
    frontmatter: {},
    noteType: "project",
    tags: [],
    raw: "",
    created: "2026-06-01",
    updated: "2026-06-06",
    ...overrides,
  };
}

function validItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "item",
    sourcePath: "source.md",
    sourceTitle: "Source",
    kind: "action",
    text: "Do the work.",
    status: "open",
    priority: "high",
    created: "2026-06-01",
    updated: "2026-06-06",
    tags: [],
    ...overrides,
  };
}

function validReport(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    filesScanned: 4,
    markdownFilesParsed: 3,
    filesSkipped: 1,
    parseErrors: [],
    warnings: [],
    generatedFiles: [],
    ...overrides,
  };
}
