import { describe, expect, it } from "vitest";

import type { ContextPack, ExtractedItem } from "@gotsaeng/core";

import { renderLlmHandoff, renderReportHub, renderValidationReport, renderWeeklyReview } from "../src/reports";

describe("Obsidian plugin reports", () => {
  it("renders a validation report in compatibility mode", () => {
    const report = renderValidationReport({
      generatedAt: "2026-06-06T00:00:00.000Z",
      projectName: "GotSaeng OS",
      sourceRoot: "/vault",
      strict: false,
      result: {
        filesChecked: 2,
        warnings: ["note.md: Missing updated field."],
        errors: []
      }
    });

    expect(report).toContain("# Vault Validation: GotSaeng OS");
    expect(report).toContain("Mode: compatibility");
    expect(report).toContain("Status: valid");
    expect(report).toContain("note.md: Missing updated field.");
  });

  it("renders weekly review context from a compiled pack", () => {
    const pack = createPack({
      actions: [
        createItem("action", "Ship Obsidian adapter.", "project.md", "open", "high"),
        createItem("action", "Archived task.", "archive.md", "done")
      ],
      questions: [createItem("question", "Should v0.3 add memory diff?", "roadmap.md", "unknown")],
      risks: [createItem("risk", "Plugin UX can drift from CLI behavior.", "risk.md", "unknown")]
    });

    const markdown = renderWeeklyReview(pack);

    expect(markdown).toContain("# Weekly Review Context: GotSaeng OS");
    expect(markdown).toContain("## Current Objective");
    expect(markdown).toContain("## This Week's Focus");
    expect(markdown).toContain("## Warning Triage");
    expect(markdown).toContain("Ship Obsidian adapter.");
    expect(markdown).not.toContain("Archived task.");
    expect(markdown).toContain("Should v0.3 add memory diff?");
  });

  it("combines generated context pack files into an LLM handoff", () => {
    const markdown = renderLlmHandoff(createPack({}), {
      "PROJECT_CONTEXT.md": "# Project Context: GotSaeng OS\n\n## Key Facts\n\n- fact",
      "MEMORY_SNAPSHOT.md": "# Memory Snapshot: GotSaeng OS\n\n## Insights\n\n- insight"
    });

    expect(markdown).toContain("# LLM Handoff: GotSaeng OS");
    expect(markdown).toContain("This handoff is local-only generated context.");
    expect(markdown).toContain("## Key Facts");
    expect(markdown).toContain("## Insights");
  });

  it("renders a report hub with Obsidian links back to source notes", () => {
    const pack = createPack({
      actions: [createItem("action", "Follow up from source.", "10_Wiki/source-note.md", "open")],
      questions: [createItem("question", "What changed?", "10_Wiki/source-note.md", "open")],
      risks: [createItem("risk", "Context may be stale.", "20_Projects/project.md", "unknown")],
      notes: [
        {
          id: "note:missing",
          path: "10_Wiki/source-note.md",
          title: "Source Note",
          body: "",
          frontmatter: {},
          noteType: "research",
          tags: [],
          raw: ""
        }
      ],
      report: {
        ...createPack({}).report,
        generatedFiles: ["PROJECT_CONTEXT.md", "COMPILE_REPORT.json"],
        extractionStats: {
          totalItems: 3,
          byKind: { action: 1, question: 1, risk: 1 },
          byStatus: { open: 2, unknown: 1 },
          notesWithItems: 2,
          notesWithoutItems: 0
        },
        sourceCoverage: {
          noteTypes: { research: 1 },
          notesWithUpdated: 0,
          notesMissingUpdated: 1
        },
        provenanceStats: {
          averageScore: 72,
          byLevel: { moderate: 3 },
          weakItems: 0,
          moderateItems: 3,
          strongItems: 0
        },
        contradictionStats: {
          totalCandidates: 1,
          bySignal: { keyword_cue: 1 },
          reviewItems: 0,
          watchItems: 1
        }
      }
    });

    const markdown = renderReportHub(pack, {
      outputFolder: ".gotsaeng/context-pack",
      generatedAt: "2026-06-06T00:00:00.000Z"
    });

    expect(markdown).toContain("# GotSaeng OS Report Hub: GotSaeng OS");
    expect(markdown).toContain("[[.gotsaeng/context-pack/PROJECT_CONTEXT.md|Project Context]]");
    expect(markdown).toContain("[[10_Wiki/source-note.md|10_Wiki/source-note.md]]");
    expect(markdown).toContain("- Extracted items: 3");
    expect(markdown).toContain("- Current objective: Follow up from source.");
    expect(markdown).toContain("## Source Provenance");
    expect(markdown).toContain("- Average score: 72");
    expect(markdown).toContain("- Moderate items: 3");
    expect(markdown).toContain("## Contradiction Candidates");
    expect(markdown).toContain("- Candidates: 1");
    expect(markdown).toContain("## Notes Needing Metadata");
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
      filesScanned: 1,
      markdownFilesParsed: 1,
      filesSkipped: 0,
      parseErrors: [],
      warnings: [],
      extractionStats: {
        totalItems: 0,
        byKind: {},
        byStatus: {},
        notesWithItems: 0,
        notesWithoutItems: 1
      },
      sourceCoverage: {
        noteTypes: { project: 1 },
        notesWithUpdated: 1,
        notesMissingUpdated: 0
      },
      generatedFiles: []
    },
    ...overrides
  };
}

function createItem(
  kind: ExtractedItem["kind"],
  text: string,
  sourcePath: string,
  status: ExtractedItem["status"],
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
