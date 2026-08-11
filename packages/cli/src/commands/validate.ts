import path from "node:path";

import { Command } from "commander";

import { parseMarkdownFile, scanMarkdownFiles, validateNoteMetadata } from "@gotsaeng/core";

import { installJsonErrorHandling } from "../json-error";
import {
  renderCliError,
  renderCliErrorJson,
  renderValidationJson,
  renderValidationSummary,
} from "../output";

type ValidateCommandOptions = {
  strict?: boolean;
  json?: boolean;
};

export function createValidateCommand(): Command {
  const command = new Command("validate")
    .description("Validate Markdown note frontmatter and basic schema conventions.")
    .argument("<vaultPath>", "Path to the Markdown vault.")
    .option("--strict", "Treat unsupported note types and unrecognized date values as errors.")
    .option("--json", "Print a machine-readable JSON summary instead of text.")
    .action(async (vaultPath: string, options: ValidateCommandOptions) => {
      const rootPath = path.resolve(vaultPath);
      const errors: string[] = [];
      const warnings: string[] = [];
      const strict = options.strict ?? false;

      try {
        const files = await scanMarkdownFiles(rootPath);

        for (const filePath of files) {
          try {
            const note = await parseMarkdownFile(filePath, rootPath);
            for (const issue of validateNoteMetadata(note, { strict })) {
              if (issue.severity === "error") {
                errors.push(`${issue.path}: ${issue.message}`);
              } else {
                warnings.push(`${issue.path}: ${issue.message}`);
              }
            }
          } catch (error) {
            errors.push(
              `${path.relative(rootPath, filePath)}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }

        const summaryInput = {
          source: vaultPath,
          markdownFiles: files.length,
          mode: (strict ? "strict" : "compatibility") as "compatibility" | "strict",
          warnings,
          errors,
        };
        process.stdout.write(
          options.json ? renderValidationJson(summaryInput) : renderValidationSummary(summaryInput),
        );
        process.exitCode = errors.length > 0 ? 1 : 0;
      } catch (error) {
        const errorInput = {
          title: "GotSaeng OS validate failed",
          reason: error instanceof Error ? error.message : String(error),
        };
        process.stderr.write(
          options.json
            ? renderCliErrorJson(errorInput)
            : renderCliError({
                ...errorInput,
                checks: [
                  "The source vault path exists and is a directory.",
                  "Markdown files are readable by the current user.",
                  "YAML frontmatter blocks are closed with a second --- line.",
                ],
              }),
        );
        process.exitCode = 1;
      }
    });

  installJsonErrorHandling(command);
  return command;
}
