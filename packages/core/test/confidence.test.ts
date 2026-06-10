import { describe, expect, it } from "vitest";

import {
  createConfidenceStats,
  extractItems,
  parseMarkdown,
  scoreExtractionConfidence,
  type ExtractedItem,
  type NoteDocument
} from "../src/index";

describe("confidence metadata", () => {
  it("scores explicit marker extraction as high confidence", () => {
    const note = createNote({
      noteType: "project",
      updated: "2026-06-06"
    });
    const confidence = scoreExtractionConfidence(note, createItem({ status: "open", priority: "high" }), "explicit_marker");

    expect(confidence.score).toBe(98);
    expect(confidence.level).toBe("high");
    expect(confidence.warnings).toEqual([]);
    expect(confidence.signals).toContain("+35: explicit extraction marker");
  });

  it("scores weak inferred extraction with metadata gaps as low confidence", () => {
    const note = createNote({
      noteType: "unknown"
    });
    const confidence = scoreExtractionConfidence(note, createItem({ status: "unknown" }), "heading_inference");

    expect(confidence.score).toBe(20);
    expect(confidence.level).toBe("low");
    expect(confidence.warnings).toEqual([
      "Extracted item status is unknown.",
      "Source note has no updated date.",
      "Source note type is unknown."
    ]);
  });

  it("annotates extracted items and creates aggregate stats", () => {
    const note = parseMarkdown(
      [
        "---",
        "type: project",
        "updated: 2026-06-06",
        "---",
        "# Project",
        "",
        "- action: Ship confidence metadata. status: open priority: high",
        "",
        "## Summary",
        "",
        "The compiler should keep extraction confidence auditable."
      ].join("\n"),
      "/vault/project.md",
      "/vault"
    );

    const items = extractItems(note);
    const stats = createConfidenceStats(items);

    expect(items.map((item) => item.confidence?.level)).toContain("high");
    expect(stats).toMatchObject({
      averageScore: expect.any(Number),
      highItems: expect.any(Number),
      lowItems: 0
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
