import { describe, expect, it } from "vitest";

import {
  createContradictionStats,
  detectContradictionCandidates,
  parseMarkdown
} from "../src/index";

describe("contradiction candidates", () => {
  it("extracts explicit contradiction markers as review candidates", () => {
    const note = parseMarkdown(
      [
        "---",
        "type: research",
        "updated: 2026-06-06",
        "tags: [research]",
        "---",
        "# Research",
        "",
        "- contradiction: The roadmap says plugin-first, but the architecture says framework-first."
      ].join("\n"),
      "/vault/research.md",
      "/vault"
    );

    const candidates = detectContradictionCandidates([note]);

    expect(candidates).toMatchObject([
      {
        sourcePath: "research.md",
        signal: "explicit_marker",
        severity: "review",
        text: "The roadmap says plugin-first, but the architecture says framework-first."
      }
    ]);
  });

  it("collects section-heading and keyword cues without semantic verification", () => {
    const note = parseMarkdown(
      [
        "---",
        "type: project",
        "updated: 2026-06-06",
        "---",
        "# Project",
        "",
        "## Contradictions / Uncertainty",
        "",
        "- Package publishing is ready, but npm scope ownership is not confirmed.",
        "",
        "## Notes",
        "",
        "- However, the old release checklist says publish immediately."
      ].join("\n"),
      "/vault/project.md",
      "/vault"
    );

    const candidates = detectContradictionCandidates([note]);
    const stats = createContradictionStats(candidates);

    expect(candidates.map((candidate) => candidate.signal)).toEqual(["section_heading", "keyword_cue"]);
    expect(stats).toEqual({
      totalCandidates: 2,
      bySignal: {
        keyword_cue: 1,
        section_heading: 1
      },
      reviewItems: 1,
      watchItems: 1
    });
  });
});
