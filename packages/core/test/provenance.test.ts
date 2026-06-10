import { describe, expect, it } from "vitest";

import {
  applySourceProvenance,
  createProvenanceStats,
  scoreSourceProvenance,
  type ExtractedItem,
  type NoteDocument
} from "../src/index";

describe("source provenance", () => {
  it("scores well-formed source notes as strong provenance", () => {
    const note = createNote({
      noteType: "project",
      created: "2026-06-01",
      updated: "2026-06-06",
      tags: ["context"],
      frontmatter: {
        title: "Project",
        status: "active"
      }
    });
    const provenance = scoreSourceProvenance(note, createItem({ status: "open", priority: "high" }));

    expect(provenance.score).toBe(98);
    expect(provenance.level).toBe("strong");
    expect(provenance.calibration).toBe("v0.10-local-metadata");
    expect(provenance.warnings).toEqual([]);
    expect(provenance.signals).toContain("+15: source has updated date");
  });

  it("scores missing metadata and unknown status as weak provenance", () => {
    const note = createNote({
      noteType: "unknown",
      tags: []
    });
    const provenance = scoreSourceProvenance(note, createItem({ status: "unknown" }));

    expect(provenance.score).toBe(5);
    expect(provenance.level).toBe("weak");
    expect(provenance.warnings).toEqual([
      "Extracted item status is unknown.",
      "Source note has no updated date.",
      "Source note type is unknown."
    ]);
  });

  it("annotates extracted items and creates aggregate stats", () => {
    const notes = [
      createNote({
        path: "project.md",
        noteType: "project",
        updated: "2026-06-06",
        frontmatter: { title: "Project" }
      }),
      createNote({
        path: "unknown.md",
        noteType: "unknown"
      })
    ];
    const items = [
      createItem({ sourcePath: "project.md", status: "open" }),
      createItem({ sourcePath: "unknown.md", status: "unknown" })
    ];

    const annotated = applySourceProvenance(notes, items);
    const stats = createProvenanceStats(annotated);

    expect(annotated[0]?.provenance?.level).toBe("strong");
    expect(annotated[1]?.provenance?.level).toBe("weak");
    expect(stats).toEqual({
      averageScore: 42.5,
      byLevel: {
        strong: 1,
        weak: 1
      },
      weakItems: 1,
      moderateItems: 0,
      strongItems: 1
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
    ...overrides
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
    ...overrides
  };
}
