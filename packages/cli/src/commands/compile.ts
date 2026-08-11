import { Command, InvalidArgumentError } from "commander";

import { compileContextPack, getItemCounts, writeContextPack } from "@gotsaeng/core";

import { installJsonErrorHandling } from "../json-error";
import {
  renderCliError,
  renderCliErrorJson,
  renderCompileJson,
  renderCompileSummary,
} from "../output";

type CompileCommandOptions = {
  output: string;
  project: string;
  staleDays: number;
  json?: boolean;
};

export function createCompileCommand(): Command {
  const command = new Command("compile")
    .description("Compile a Markdown vault into a GotSaeng OS context pack.")
    .argument("<vaultPath>", "Path to the Markdown vault.")
    .requiredOption("--output <outputDir>", "Directory for generated context-pack files.")
    .requiredOption("--project <projectName>", "Project name for generated context files.")
    .option(
      "--stale-days <number>",
      "Number of days before updated context is considered stale.",
      parsePositiveInteger,
      90,
    )
    .option("--json", "Print a machine-readable JSON summary instead of text.")
    .action(async (vaultPath: string, options: CompileCommandOptions) => {
      try {
        const pack = await compileContextPack({
          sourceRoot: vaultPath,
          projectName: options.project,
          staleDays: options.staleDays,
        });
        const report = await writeContextPack(pack, options.output);

        const summaryInput = {
          projectName: pack.projectName,
          source: vaultPath,
          output: options.output,
          report,
          itemCounts: getItemCounts(pack),
        };
        process.stdout.write(
          options.json ? renderCompileJson(summaryInput) : renderCompileSummary(summaryInput),
        );
      } catch (error) {
        const errorInput = {
          title: "GotSaeng OS compile failed",
          reason: error instanceof Error ? error.message : String(error),
        };
        process.stderr.write(
          options.json
            ? renderCliErrorJson(errorInput)
            : renderCliError({
                ...errorInput,
                checks: [
                  "The source vault path exists and is a directory.",
                  "The output directory path is writable.",
                  "The command includes both --output and --project.",
                  "Markdown files use valid YAML frontmatter when frontmatter is present.",
                ],
              }),
        );
        process.exitCode = 1;
      }
    });

  installJsonErrorHandling(command);
  return command;
}

function parsePositiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new InvalidArgumentError("Expected a positive integer.");
  }
  return parsed;
}
