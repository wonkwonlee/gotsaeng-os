import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Command, InvalidArgumentError } from "commander";

import { resolveServerConfig } from "./config";
import { createGotsaengMcpServer } from "./server";

function parsePositiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new InvalidArgumentError("Expected a positive integer.");
  }
  return parsed;
}

const program = new Command("gotsaeng-mcp")
  .description("GotSaeng OS MCP stdio server. Vault and output roots are fixed at launch.")
  .requiredOption("--vault <path>", "Path to the Markdown vault (read-only for this server).")
  .requiredOption("--output <path>", "Directory for generated context-pack files.")
  .requiredOption("--project <name>", "Project name for generated context files.")
  .option(
    "--stale-days <number>",
    "Days before context is considered stale.",
    parsePositiveInteger,
    90,
  )
  .action(
    async (options: { vault: string; output: string; project: string; staleDays: number }) => {
      const config = await resolveServerConfig(options);
      const server = createGotsaengMcpServer(config);
      await server.connect(new StdioServerTransport());
      process.stderr.write(
        `gotsaeng-mcp serving vault=${config.vaultRoot} output=${config.outputRoot}\n`,
      );
    },
  );

program.parseAsync(process.argv).catch((error: unknown) => {
  process.stderr.write(
    `gotsaeng-mcp failed to start: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
