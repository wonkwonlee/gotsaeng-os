import { Command, InvalidArgumentError } from "commander";

import { compileContextPack, getItemCounts, writeContextPack } from "@gotsaeng/core";

import { renderCliError, renderCompileSummary } from "../output";

type CompileCommandOptions = {
  output: string;
  project: string;
  staleDays: number;
};

export function createCompileCommand(): Command {
  return new Command("compile")
    .description("Compile a Markdown vault into a GotSaeng OS context pack.")
    .argument("<vaultPath>", "Path to the Markdown vault.")
    .requiredOption("--output <outputDir>", "Directory for generated context-pack files.")
    .requiredOption("--project <projectName>", "Project name for generated context files.")
    .option("--stale-days <number>", "Number of days before updated context is considered stale.", parsePositiveInteger, 90)
    .action(async (vaultPath: string, options: CompileCommandOptions) => {
      try {
        const pack = await compileContextPack({
          sourceRoot: vaultPath,
          projectName: options.project,
          staleDays: options.staleDays
        });
        const report = await writeContextPack(pack, options.output);

        process.stdout.write(
          renderCompileSummary({
            projectName: pack.projectName,
            source: vaultPath,
            output: options.output,
            report,
            itemCounts: getItemCounts(pack)
          })
        );
      } catch (error) {
        process.stderr.write(
          renderCliError({
            title: "GotSaeng OS compile failed",
            reason: error instanceof Error ? error.message : String(error),
            checks: [
              "The source vault path exists and is a directory.",
              "The output directory path is writable.",
              "The command includes both --output and --project.",
              "Markdown files use valid YAML frontmatter when frontmatter is present."
            ]
          })
        );
        process.exitCode = 1;
      }
    });
}

function parsePositiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new InvalidArgumentError("Expected a positive integer.");
  }
  return parsed;
}
