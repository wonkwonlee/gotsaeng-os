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
    ""
  ].join("\n");
}

export function renderCliError(input: {
  title: string;
  reason: string;
  checks: string[];
}): string {
  return [
    input.title,
    "",
    `Reason: ${input.reason}`,
    "",
    "Check:",
    ...input.checks.map((check) => `- ${check}`),
    ""
  ].join("\n");
}

export function renderValidationSummary(input: {
  source: string;
  markdownFiles: number;
  mode?: "compatibility" | "strict";
  warnings: string[];
  errors: string[];
}): string {
  const status = input.errors.length > 0 ? "invalid" : input.warnings.length > 0 ? "valid with warnings" : "valid";
  const sections = [
    "GotSaeng OS Vault Validation",
    "",
    `Source: ${input.source}`,
    `Markdown files: ${input.markdownFiles}`,
    `Mode: ${input.mode ?? "compatibility"}`,
    `Status: ${status}`,
    `Warnings: ${input.warnings.length}`,
    `Errors: ${input.errors.length}`,
    ""
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
