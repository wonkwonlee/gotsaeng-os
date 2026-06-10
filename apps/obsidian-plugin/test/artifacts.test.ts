import { describe, expect, it } from "vitest";

import { OUTPUT_ARTIFACTS } from "../src/artifacts";

describe("Obsidian output artifacts", () => {
  it("exposes every generated context-pack artifact in the Report Hub view", () => {
    expect(OUTPUT_ARTIFACTS.map((artifact) => artifact.fileName)).toEqual([
      "REPORT_HUB.md",
      "WEEKLY_REVIEW_CONTEXT.md",
      "LLM_HANDOFF.md",
      "MEMORY_DIFF.md",
      "PROJECT_CONTEXT.md",
      "MEMORY_SNAPSHOT.md",
      "DECISION_LOG.md",
      "ACTION_BACKLOG.md",
      "RISK_REGISTER.md",
      "OPEN_QUESTIONS.md",
      "STALE_CONTEXT.md",
      "SOURCE_PROVENANCE.md",
      "CONFIDENCE.md",
      "CONTRADICTIONS.md",
      "VALIDATION_REPORT.md",
      "CONTEXT_MANIFEST.json",
      "COMPILE_REPORT.json"
    ]);
  });
});
