import { describe, expect, it } from "vitest";

import {
  CLI_JSON_SCHEMA_VERSION,
  renderCliError,
  renderCliErrorJson,
  renderCompileJson,
  renderCompileSummary,
  renderValidationJson,
  renderValidationSummary,
  type CliErrorJsonPayload,
  type CompileJsonPayload,
  type ValidationJsonPayload,
} from "../src/output";

// JSON.parse is typed `any`. The renderers declare the shapes they emit, so the
// assertions below go through those types and stay checked against drift.
function parseJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

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

describe("renderCompileJson", () => {
  it("emits a schema-versioned JSON document with report and counts", () => {
    const out = renderCompileJson({
      projectName: "Demo",
      source: "/vault",
      output: "/out",
      itemCounts: { facts: 1 },
      report: {
        filesScanned: 2,
        markdownFilesParsed: 2,
        filesSkipped: 0,
        parseErrors: [],
        warnings: ["w1"],
        generatedFiles: ["PROJECT_CONTEXT.md"],
      },
    });
    const parsed = parseJson<CompileJsonPayload>(out);
    expect(parsed.schemaVersion).toBe(CLI_JSON_SCHEMA_VERSION);
    expect(parsed.command).toBe("compile");
    expect(parsed.project).toBe("Demo");
    expect(parsed.report.warnings).toEqual(["w1"]);
    expect(parsed.itemCounts.facts).toBe(1);
    expect(out.endsWith("\n")).toBe(true);
  });
});

describe("renderCliErrorJson", () => {
  it("emits a JSON error object", () => {
    const parsed = parseJson<CliErrorJsonPayload>(renderCliErrorJson({ title: "t", reason: "r" }));
    expect(parsed.error).toEqual({ title: "t", reason: "r" });
    expect(parsed.schemaVersion).toBe(CLI_JSON_SCHEMA_VERSION);
  });
});

describe("renderValidationJson", () => {
  it("computes status and carries full issue lists", () => {
    const parsed = parseJson<ValidationJsonPayload>(
      renderValidationJson({
        source: "/vault",
        markdownFiles: 3,
        mode: "strict",
        warnings: ["a: w"],
        errors: [],
      }),
    );
    expect(parsed.command).toBe("validate");
    expect(parsed.status).toBe("valid with warnings");
    expect(parsed.mode).toBe("strict");
    expect(parsed.warnings).toEqual(["a: w"]);
  });

  it("reports invalid when errors exist", () => {
    const parsed = parseJson<ValidationJsonPayload>(
      renderValidationJson({
        source: "/vault",
        markdownFiles: 1,
        mode: "compatibility",
        warnings: [],
        errors: ["b: e"],
      }),
    );
    expect(parsed.status).toBe("invalid");
  });
});
