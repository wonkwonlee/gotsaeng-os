import { describe, expect, it } from "vitest";

import { renderCliError, renderCompileSummary, renderValidationSummary } from "../src/output";

// cli.test.ts drives the built binary as a subprocess, which exercises these
// renderers but cannot assert their edge cases (or register as coverage). These
// tests call them directly.
describe("renderCompileSummary", () => {
  const report = {
    filesScanned: 12,
    markdownFilesParsed: 9,
    filesSkipped: 3,
    parseErrors: [],
    warnings: [],
    generatedFiles: ["PROJECT_CONTEXT.md", "COMPILE_REPORT.json"],
  };

  it("reports counts and the generated file list", () => {
    const summary = renderCompileSummary({
      projectName: "Vault",
      source: "/vault",
      output: "/out",
      report,
      itemCounts: { facts: 4, actions: 2 },
    });

    expect(summary).toContain("Project: Vault");
    expect(summary).toContain("Files scanned: 12");
    expect(summary).toContain("- facts: 4");
    expect(summary).toContain("- actions: 2");
    expect(summary).toContain("- PROJECT_CONTEXT.md");
    expect(summary.endsWith("Done.\n")).toBe(true);
  });

  it("prints zero for every kind missing from itemCounts", () => {
    const summary = renderCompileSummary({
      projectName: "Vault",
      source: "/vault",
      output: "/out",
      report,
      itemCounts: {},
    });

    for (const kind of [
      "facts",
      "decisions",
      "actions",
      "risks",
      "assumptions",
      "questions",
      "insights",
      "stale",
    ]) {
      expect(summary).toContain(`- ${kind}: 0`);
    }
  });
});

describe("renderValidationSummary", () => {
  const base = { source: "/vault", markdownFiles: 5 };

  it("is valid with no warnings or errors, and defaults to compatibility mode", () => {
    const output = renderValidationSummary({ ...base, warnings: [], errors: [] });

    expect(output).toContain("Mode: compatibility");
    expect(output).toContain("Status: valid");
    expect(output).toContain("Valid.");
    // Empty sections are omitted entirely rather than printed as "(0):".
    expect(output).not.toContain("Warnings (");
    expect(output).not.toContain("Errors (");
  });

  it("downgrades to 'valid with warnings' and lists them", () => {
    const output = renderValidationSummary({
      ...base,
      mode: "strict",
      warnings: ["a.md: Missing updated field."],
      errors: [],
    });

    expect(output).toContain("Mode: strict");
    expect(output).toContain("Status: valid with warnings");
    expect(output).toContain("Warnings (1):");
    expect(output).toContain("- a.md: Missing updated field.");
    expect(output).toContain("Valid.");
  });

  it("reports invalid when there are errors, even alongside warnings", () => {
    const output = renderValidationSummary({
      ...base,
      warnings: ["a.md: Missing updated field."],
      errors: ["b.md: Invalid note type: wiki"],
    });

    expect(output).toContain("Status: invalid");
    expect(output).toContain("Errors (1):");
    expect(output).toContain("- b.md: Invalid note type: wiki");
    expect(output).toContain("Invalid.");
    expect(output).not.toContain("Valid.\n\n");
  });
});

describe("renderCliError", () => {
  it("renders the title, reason, and actionable checks", () => {
    const output = renderCliError({
      title: "GotSaeng OS compile failed",
      reason: "ENOENT: no such file or directory",
      checks: ["The source vault path exists and is a directory."],
    });

    expect(output).toContain("GotSaeng OS compile failed");
    expect(output).toContain("Reason: ENOENT: no such file or directory");
    expect(output).toContain("- The source vault path exists and is a directory.");
  });
});
