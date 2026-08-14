import { describe, expect, it } from "vitest";

import { groupOutputArtifacts, OUTPUT_ARTIFACTS } from "../src/artifacts";

describe("Obsidian output artifacts", () => {
  it("exposes every generated context-pack artifact in the Report Hub view", () => {
    expect(OUTPUT_ARTIFACTS.map((artifact) => artifact.fileName)).toEqual([
      "REPORT_HUB.md",
      "WEEKLY_REVIEW_CONTEXT.md",
      "LLM_HANDOFF.md",
      "PROJECT_CONTEXT.md",
      "MEMORY_SNAPSHOT.md",
      "DECISION_LOG.md",
      "ACTION_BACKLOG.md",
      "RISK_REGISTER.md",
      "OPEN_QUESTIONS.md",
      "STALE_CONTEXT.md",
      "VALIDATION_REPORT.md",
      "MEMORY_DIFF.md",
      "SOURCE_PROVENANCE.md",
      "CONFIDENCE.md",
      "CONTRADICTIONS.md",
      "ENGINEERING_OPS.md",
      "TEAM_MEMORY.md",
      "CONTEXT_MANIFEST.json",
      "COMPILE_REPORT.json",
      "ARTIFACT_INDEX.json",
    ]);
  });
});

describe("groupOutputArtifacts", () => {
  it("groups every artifact into Core Reports, Governance, Analysis, or Raw Data with none left over", () => {
    const groups = groupOutputArtifacts();

    expect(groups.map((section) => section.label)).toEqual([
      "Core Reports",
      "Governance",
      "Analysis",
      "Raw Data",
    ]);

    const totalGrouped = groups.reduce((sum, section) => sum + section.artifacts.length, 0);
    expect(totalGrouped).toBe(OUTPUT_ARTIFACTS.length);

    const rawGroup = groups.find((section) => section.group === "raw");
    expect(rawGroup?.artifacts.map((artifact) => artifact.fileName)).toEqual([
      "CONTEXT_MANIFEST.json",
      "COMPILE_REPORT.json",
      "ARTIFACT_INDEX.json",
    ]);

    const governanceGroup = groups.find((section) => section.group === "governance");
    expect(governanceGroup?.artifacts.map((artifact) => artifact.fileName)).toEqual([
      "DECISION_LOG.md",
      "RISK_REGISTER.md",
      "OPEN_QUESTIONS.md",
      "STALE_CONTEXT.md",
    ]);
  });

  // Regression guard for the cognitive-load guideline (roughly 7 items per
  // decision point) that motivated splitting "Core Reports" into a separate
  // "Governance" group in the first place.
  it("keeps every group at 7 items or fewer", () => {
    const groups = groupOutputArtifacts();

    for (const section of groups) {
      expect(section.artifacts.length).toBeLessThanOrEqual(7);
    }
  });

  it("omits a group heading entirely when it has no artifacts", () => {
    const groups = groupOutputArtifacts(
      OUTPUT_ARTIFACTS.filter((artifact) => artifact.group !== "raw"),
    );

    expect(groups.map((section) => section.group)).toEqual(["core", "governance", "analysis"]);
  });
});
