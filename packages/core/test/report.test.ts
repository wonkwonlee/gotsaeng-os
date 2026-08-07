import { describe, expect, it } from "vitest";

import {
  createCompileReport,
  createExtractionStats,
  createSourceCoverage,
  getItemCounts,
  type CompileReport,
  type ContextPack,
  type ExtractedItem,
  type NoteDocument,
} from "../src/index";

describe("createCompileReport", () => {
  it("appends an empty generatedFiles array to the given report fields", () => {
    const input: Omit<CompileReport, "generatedFiles"> = {
      filesScanned: 3,
      markdownFilesParsed: 2,
      filesSkipped: 1,
      parseErrors: [],
      warnings: ["Missing updated field: note.md"],
    };

    const report = createCompileReport(input);

    expect(report).toEqual({
      ...input,
      generatedFiles: [],
    });
  });
});

describe("getItemCounts", () => {
  it("counts each collection in the pack independently, including empty ones", () => {
    const pack = createPack({
      facts: [createItem({ kind: "fact" })],
      decisions: [createItem({ kind: "decision" }), createItem({ kind: "decision" })],
      actions: [],
      risks: [createItem({ kind: "risk" })],
      assumptions: [],
      questions: [],
      insights: [],
      staleItems: [createItem({ kind: "action" }), createItem({ kind: "action" })],
    });

    expect(getItemCounts(pack)).toEqual({
      facts: 1,
      decisions: 2,
      actions: 0,
      risks: 1,
      assumptions: 0,
      questions: 0,
      insights: 0,
      stale: 2,
    });
  });
});

describe("createExtractionStats", () => {
  it("tallies items by kind and status, sorted, and splits notes with/without items", () => {
    const notes = [
      createNote({ path: "a.md" }),
      createNote({ path: "b.md" }),
      createNote({ path: "c.md" }),
    ];
    const items = [
      createItem({ sourcePath: "a.md", kind: "risk", status: "open" }),
      createItem({ sourcePath: "a.md", kind: "action", status: "open" }),
      createItem({ sourcePath: "b.md", kind: "action", status: "done" }),
    ];

    const stats = createExtractionStats(notes, items);

    expect(stats).toEqual({
      totalItems: 3,
      byKind: { action: 2, risk: 1 },
      byStatus: { done: 1, open: 2 },
      notesWithItems: 2,
      notesWithoutItems: 1,
    });
    // byKind/byStatus keys must come back sorted (sortRecord), not insertion order.
    expect(Object.keys(stats.byKind)).toEqual(["action", "risk"]);
  });

  it("buckets items with no status under 'unknown'", () => {
    const notes = [createNote({ path: "a.md" })];
    const items = [createItem({ sourcePath: "a.md", status: undefined })];

    const stats = createExtractionStats(notes, items);

    expect(stats.byStatus).toEqual({ unknown: 1 });
  });

  it("counts a note only once toward notesWithItems even with multiple items from it", () => {
    const notes = [createNote({ path: "a.md" })];
    const items = [
      createItem({ sourcePath: "a.md", kind: "fact" }),
      createItem({ sourcePath: "a.md", kind: "decision" }),
    ];

    const stats = createExtractionStats(notes, items);

    expect(stats.notesWithItems).toBe(1);
    expect(stats.notesWithoutItems).toBe(0);
  });
});

describe("createSourceCoverage", () => {
  it("tallies notes by type and splits by presence of an updated date", () => {
    const notes = [
      createNote({ noteType: "project", updated: "2026-06-01" }),
      createNote({ noteType: "project", updated: undefined }),
      createNote({ noteType: "daily", updated: "2026-06-02" }),
    ];

    const coverage = createSourceCoverage(notes);

    expect(coverage).toEqual({
      noteTypes: { daily: 1, project: 2 },
      notesWithUpdated: 2,
      notesMissingUpdated: 1,
    });
    expect(Object.keys(coverage.noteTypes)).toEqual(["daily", "project"]);
  });

  it("returns all-zero coverage for an empty note list", () => {
    expect(createSourceCoverage([])).toEqual({
      noteTypes: {},
      notesWithUpdated: 0,
      notesMissingUpdated: 0,
    });
  });
});

function createNote(overrides: Partial<NoteDocument> = {}): NoteDocument {
  return {
    id: "note",
    path: "source.md",
    title: "Source",
    body: "Body",
    frontmatter: {},
    noteType: "project",
    tags: [],
    raw: "",
    ...overrides,
  };
}

function createItem(overrides: Partial<ExtractedItem> = {}): ExtractedItem {
  return {
    id: "item",
    sourcePath: "source.md",
    sourceTitle: "Source",
    kind: "action",
    text: "Do the work.",
    status: "open",
    tags: [],
    ...overrides,
  };
}

function createPack(overrides: Partial<ContextPack> = {}): ContextPack {
  return {
    projectName: "Project",
    generatedAt: "2026-06-06T00:00:00.000Z",
    sourceRoot: "/vault",
    notes: [],
    facts: [],
    decisions: [],
    actions: [],
    risks: [],
    assumptions: [],
    questions: [],
    insights: [],
    contradictions: [],
    staleItems: [],
    report: createCompileReport({
      filesScanned: 0,
      markdownFilesParsed: 0,
      filesSkipped: 0,
      parseErrors: [],
      warnings: [],
    }),
    ...overrides,
  };
}
