import { describe, expect, it } from "vitest";

import { parseMarkdown, validateNoteMetadata } from "../src/parser";

describe("parser", () => {
  it("parses YAML frontmatter and normalizes tags", () => {
    const note = parseMarkdown(
      [
        "---",
        "type: project",
        "title: Test Project",
        "created: 2026-06-06",
        "updated: 2026-06-06",
        "tags:",
        "  - llm",
        "  - context-engineering",
        "---",
        "",
        "# Ignored H1",
        "",
        "Body."
      ].join("\n"),
      "/vault/projects/test.md",
      "/vault"
    );

    expect(note.title).toBe("Test Project");
    expect(note.noteType).toBe("project");
    expect(note.tags).toEqual(["context-engineering", "llm"]);
    expect(note.created).toBe("2026-06-06");
    expect(note.updated).toBe("2026-06-06");
  });

  it("infers title from the first H1 when frontmatter title is missing", () => {
    const note = parseMarkdown("# H1 Title\n\nBody.", "/vault/research/h1-title.md", "/vault");

    expect(note.title).toBe("H1 Title");
  });

  it("falls back to a readable filename title", () => {
    const note = parseMarkdown("Body without heading.", "/vault/notes/raw-note.md", "/vault");

    expect(note.title).toBe("Raw Note");
  });

  it("treats custom Obsidian note types and templater dates as warnings in compatibility mode", () => {
    const note = parseMarkdown(
      [
        "---",
        "type: wiki",
        "title: Wiki Note",
        "created: <% tp.date.now(\"YYYY-MM-DD\") %>",
        "updated: <% tp.date.now(\"YYYY-MM-DD\") %>",
        "---",
        "",
        "# Wiki Note"
      ].join("\n"),
      "/vault/10_Wiki/home.md",
      "/vault"
    );

    const compatibilityIssues = validateNoteMetadata(note, { strict: false });
    const strictIssues = validateNoteMetadata(note, { strict: true });

    expect(compatibilityIssues.every((issue) => issue.severity === "warning")).toBe(true);
    expect(compatibilityIssues.map((issue) => issue.message)).toEqual([
      "Custom note type: wiki; mapped to research.",
      "Unvalidated created date: <% tp.date.now(\"YYYY-MM-DD\") %>.",
      "Unvalidated updated date: <% tp.date.now(\"YYYY-MM-DD\") %>.",
      "Missing updated field."
    ]);
    expect(strictIssues.filter((issue) => issue.severity === "error")).toHaveLength(3);
  });
});
