import path from "node:path";

import { Command } from "commander";

import { parseMarkdownFile, scanMarkdownFiles, validateNoteMetadata } from "@gotsaeng/core";

import { renderCliError, renderValidationSummary } from "../output";

type ValidateCommandOptions = {
  strict?: boolean;
};

export function createValidateCommand(): Command {
  return new Command("validate")
    .description("Validate Markdown note frontmatter and basic schema conventions.")
    .argument("<vaultPath>", "Path to the Markdown vault.")
    .option("--strict", "Treat unsupported note types and unrecognized date values as errors.")
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
              `${path.relative(rootPath, filePath)}: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }

        process.stdout.write(
          renderValidationSummary({
            source: vaultPath,
            markdownFiles: files.length,
            mode: strict ? "strict" : "compatibility",
            warnings,
            errors
          })
        );
        process.exitCode = errors.length > 0 ? 1 : 0;
      } catch (error) {
        process.stderr.write(
          renderCliError({
            title: "GotSaeng OS validate failed",
            reason: error instanceof Error ? error.message : String(error),
            checks: [
              "The source vault path exists and is a directory.",
              "Markdown files are readable by the current user.",
              "YAML frontmatter blocks are closed with a second --- line."
            ]
          })
        );
        process.exitCode = 1;
      }
    });
}
