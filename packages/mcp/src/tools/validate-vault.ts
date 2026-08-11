import path from "node:path";

import { parseMarkdownFile, scanMarkdownFiles, validateNoteMetadata } from "@gotsaeng/core";

import type { ServerConfig } from "../config";

const ISSUE_LIST_CAP = 50;

export type ValidateVaultResult = {
  filesChecked: number;
  mode: "compatibility" | "strict";
  status: "valid" | "valid with warnings" | "invalid";
  warningCount: number;
  errorCount: number;
  warnings: string[];
  errors: string[];
  truncated: boolean;
};

export async function validateVault(
  config: ServerConfig,
  input: { strict?: boolean },
): Promise<ValidateVaultResult> {
  const strict = input.strict ?? false;
  const errors: string[] = [];
  const warnings: string[] = [];

  const files = await scanMarkdownFiles(config.vaultRoot);
  for (const filePath of files) {
    try {
      const note = await parseMarkdownFile(filePath, config.vaultRoot);
      for (const issue of validateNoteMetadata(note, { strict })) {
        (issue.severity === "error" ? errors : warnings).push(`${issue.path}: ${issue.message}`);
      }
    } catch (error) {
      errors.push(
        `${path.relative(config.vaultRoot, filePath)}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const status =
    errors.length > 0 ? "invalid" : warnings.length > 0 ? "valid with warnings" : "valid";
  return {
    filesChecked: files.length,
    mode: strict ? "strict" : "compatibility",
    status,
    warningCount: warnings.length,
    errorCount: errors.length,
    warnings: warnings.slice(0, ISSUE_LIST_CAP),
    errors: errors.slice(0, ISSUE_LIST_CAP),
    truncated: warnings.length > ISSUE_LIST_CAP || errors.length > ISSUE_LIST_CAP,
  };
}
