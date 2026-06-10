import { describe, expect, it } from "vitest";

import type { ContextPack, ExtractedItem, NoteDocument } from "../src/index";
import { createWarningTriage, groupItemsBySource, inferCurrentObjective, selectHighSignalItems } from "../src/index";

describe("quality helpers", () => {
  it("infers an explicit current objective from project notes", () => {
    const pack = createPack({
      notes: [
        createNote({
          path: "project.md",
          noteType: "project",
          body: "## Current Objective\n\nShip the compiler foundation."
        })
      ]
    });

    expect(inferCurrentObjective(pack)).toEqual({
      text: "Ship the compiler foundation.",
      sourcePath: "project.md",
      confidence: "explicit",
      reason: "Read from a project note objective section."
    });
  });

  it("falls back to high-priority open actions when no explicit objective exists", () => {
    const pack = createPack({
      actions: [
        createItem("action", "Low signal task", "todo.md", "open", "low"),
        createItem("action", "Build report hub", "plan.md", "open", "high")
      ]
    });

    expect(inferCurrentObjective(pack)).toMatchObject({
      text: "Build report hub",
      sourcePath: "plan.md",
      confidence: "inferred"
    });
  });

  it("groups items by source with highest-volume sources first", () => {
    const groups = groupItemsBySource([
      createItem("risk", "B", "b.md"),
      createItem("risk", "A1", "a.md"),
      createItem("risk", "A2", "a.md")
    ]);

    expect(groups.map((group) => [group.sourcePath, group.items.map((item) => item.text)])).toEqual([
      ["a.md", ["A1", "A2"]],
      ["b.md", ["B"]]
    ]);
  });

  it("selects high-signal items by priority and status", () => {
    const items = [
      createItem("action", "Unknown item", "z.md", "unknown"),
      createItem("action", "Medium active", "b.md", "active", "medium"),
      createItem("action", "High open", "a.md", "open", "high")
    ];

    expect(selectHighSignalItems(items, 2).map((item) => item.text)).toEqual(["High open", "Medium active"]);
  });

  it("triages warnings into actionable buckets", () => {
    const triage = createWarningTriage({
      filesScanned: 2,
      markdownFilesParsed: 1,
      filesSkipped: 1,
      parseErrors: [{ path: "bad.md", message: "YAML failed" }],
      warnings: ["Missing updated field: stale.md", "Other warning"],
      generatedFiles: []
    });

    expect(triage.items.map((item) => [item.label, item.count, item.severity])).toEqual([
      ["Parse errors", 1, "error"],
      ["Notes missing updated dates", 1, "warning"],
      ["Other warnings", 1, "warning"]
    ]);
  });
});

function createPack(overrides: Partial<ContextPack>): ContextPack {
  return {
    projectName: "GotSaeng OS",
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
    report: {
      filesScanned: 0,
      markdownFilesParsed: 0,
      filesSkipped: 0,
      parseErrors: [],
      warnings: [],
      generatedFiles: []
    },
    ...overrides
  };
}

function createNote(overrides: Partial<NoteDocument>): NoteDocument {
  return {
    id: "note",
    path: "note.md",
    title: "Note",
    body: "",
    frontmatter: {},
    noteType: "unknown",
    tags: [],
    raw: "",
    ...overrides
  };
}

function createItem(
  kind: ExtractedItem["kind"],
  text: string,
  sourcePath: string,
  status: ExtractedItem["status"] = "unknown",
  priority?: ExtractedItem["priority"]
): ExtractedItem {
  return {
    id: `${kind}:${sourcePath}:${text}`,
    sourcePath,
    sourceTitle: sourcePath,
    kind,
    text,
    status,
    priority,
    tags: []
  };
}
