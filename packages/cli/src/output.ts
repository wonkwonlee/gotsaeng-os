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

export function renderCompileJson(input: CompileSummaryInput): string {
  return `${JSON.stringify(
    {
      schemaVersion: CLI_JSON_SCHEMA_VERSION,
      command: "compile",
      project: input.projectName,
      source: input.source,
      output: input.output,
      itemCounts: input.itemCounts,
      report: input.report,
    },
    null,
    2,
  )}\n`;
}

export function renderCliErrorJson(input: { title: string; reason: string }): string {
  return `${JSON.stringify(
    { schemaVersion: CLI_JSON_SCHEMA_VERSION, error: { title: input.title, reason: input.reason } },
    null,
    2,
  )}\n`;
}

export function renderValidationJson(input: {
  source: string;
  markdownFiles: number;
  mode: "compatibility" | "strict";
  warnings: string[];
  errors: string[];
}): string {
  const status =
    input.errors.length > 0
      ? "invalid"
      : input.warnings.length > 0
        ? "valid with warnings"
        : "valid";
  return `${JSON.stringify(
    {
      schemaVersion: CLI_JSON_SCHEMA_VERSION,
      command: "validate",
      source: input.source,
      markdownFiles: input.markdownFiles,
      mode: input.mode,
      status,
      warnings: input.warnings,
      errors: input.errors,
    },
    null,
    2,
  )}\n`;
}

export function renderValidationSummary(input: {
  source: string;
  markdownFiles: number;
  mode?: "compatibility" | "strict";
  warnings: string[];
  errors: string[];
}): string {
  const status =
    input.errors.length > 0
      ? "invalid"
      : input.warnings.length > 0
        ? "valid with warnings"
        : "valid";
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
