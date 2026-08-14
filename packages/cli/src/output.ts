import type { CompileReport } from "@gotsaeng/core";

type CompileSummaryInput = {
  projectName: string;
  source: string;
  output: string;
  report: CompileReport;
  itemCounts: Record<string, number>;
};

export function renderCompileSummary(input: CompileSummaryInput): string {
  return [
    "GotSaeng OS Context Compiler",
    "",
    `Project: ${input.projectName}`,
    `Source: ${input.source}`,
    `Output: ${input.output}`,
    "",
    `Files scanned: ${input.report.filesScanned}`,
    `Markdown parsed: ${input.report.markdownFilesParsed}`,
    "Items extracted:",
    `- facts: ${input.itemCounts["facts"] ?? 0}`,
    `- decisions: ${input.itemCounts["decisions"] ?? 0}`,
    `- actions: ${input.itemCounts["actions"] ?? 0}`,
    `- risks: ${input.itemCounts["risks"] ?? 0}`,
    `- assumptions: ${input.itemCounts["assumptions"] ?? 0}`,
    `- questions: ${input.itemCounts["questions"] ?? 0}`,
    `- insights: ${input.itemCounts["insights"] ?? 0}`,
    `- stale: ${input.itemCounts["stale"] ?? 0}`,
    "",
    "Generated:",
    ...input.report.generatedFiles.map((file) => `- ${file}`),
    "",
    "Done.",
    "",
  ].join("\n");
}

export function renderCliError(input: { title: string; reason: string; checks: string[] }): string {
  return [
    input.title,
    "",
    `Reason: ${input.reason}`,
    "",
    "Check:",
    ...input.checks.map((check) => `- ${check}`),
    "",
  ].join("\n");
}

export const CLI_JSON_SCHEMA_VERSION = 1;

export type ValidationStatus = "valid" | "valid with warnings" | "invalid";

export type ValidationInput = {
  source: string;
  markdownFiles: number;
  mode: "compatibility" | "strict";
  warnings: string[];
  errors: string[];
};

/**
 * Single source of truth for the validate status wording, shared by the text
 * and JSON renderers so the two cannot drift apart.
 */
function resolveValidationStatus(input: {
  warnings: string[];
  errors: string[];
}): ValidationStatus {
  if (input.errors.length > 0) {
    return "invalid";
  }
  return input.warnings.length > 0 ? "valid with warnings" : "valid";
}

// The `--json` payloads are a versioned contract with external tools that parse
// the CLI's stdout (see CLI_JSON_SCHEMA_VERSION), so their shapes are named
// rather than left implicit in the JSON.stringify argument. Annotating the
// literals below makes any drift a type error, and lets this package's own
// tests parse into a real type instead of `any`. These types are internal —
// not re-exported from the package entry point — since the schema they
// describe is the wire contract; nothing in-process needs the TS type.
export type CompileJsonPayload = {
  schemaVersion: typeof CLI_JSON_SCHEMA_VERSION;
  command: "compile";
  project: string;
  source: string;
  output: string;
  itemCounts: Record<string, number>;
  report: CompileReport;
};

export type CliErrorJsonPayload = {
  schemaVersion: typeof CLI_JSON_SCHEMA_VERSION;
  error: { title: string; reason: string };
};

export type ValidationJsonPayload = {
  schemaVersion: typeof CLI_JSON_SCHEMA_VERSION;
  command: "validate";
  source: string;
  markdownFiles: number;
  mode: "compatibility" | "strict";
  status: ValidationStatus;
  warnings: string[];
  errors: string[];
};

export function renderCompileJson(input: CompileSummaryInput): string {
  const payload: CompileJsonPayload = {
    schemaVersion: CLI_JSON_SCHEMA_VERSION,
    command: "compile",
    project: input.projectName,
    source: input.source,
    output: input.output,
    itemCounts: input.itemCounts,
    report: input.report,
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function renderCliErrorJson(input: { title: string; reason: string }): string {
  const payload: CliErrorJsonPayload = {
    schemaVersion: CLI_JSON_SCHEMA_VERSION,
    error: { title: input.title, reason: input.reason },
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function renderValidationJson(input: ValidationInput): string {
  const payload: ValidationJsonPayload = {
    schemaVersion: CLI_JSON_SCHEMA_VERSION,
    command: "validate",
    source: input.source,
    markdownFiles: input.markdownFiles,
    mode: input.mode,
    status: resolveValidationStatus(input),
    warnings: input.warnings,
    errors: input.errors,
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

// The text renderer keeps `mode` optional — it falls back to "compatibility" —
// while the JSON payload always carries an explicit mode.
export function renderValidationSummary(
  input: Omit<ValidationInput, "mode"> & { mode?: ValidationInput["mode"] },
): string {
  const status = resolveValidationStatus(input);
  const sections = [
    "GotSaeng OS Vault Validation",
    "",
    `Source: ${input.source}`,
    `Markdown files: ${input.markdownFiles}`,
    `Mode: ${input.mode ?? "compatibility"}`,
    `Status: ${status}`,
    `Warnings: ${input.warnings.length}`,
    `Errors: ${input.errors.length}`,
    "",
  ];

  if (input.warnings.length > 0) {
    sections.push(`Warnings (${input.warnings.length}):`);
    sections.push(...input.warnings.map((warning) => `- ${warning}`));
    sections.push("");
  }

  if (input.errors.length > 0) {
    sections.push(`Errors (${input.errors.length}):`);
    sections.push(...input.errors.map((error) => `- ${error}`));
    sections.push("");
  }

  sections.push(input.errors.length > 0 ? "Invalid." : "Valid.");
  sections.push("");

  return sections.join("\n");
}
