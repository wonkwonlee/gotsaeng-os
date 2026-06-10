import fs from "node:fs/promises";

import { Command } from "commander";

import { scanMarkdownFiles } from "@gotsaeng/core";

import { CLI_VERSION } from "../version";

export function createDoctorCommand(): Command {
  return new Command("doctor")
    .description("Check the local GotSaeng OS CLI runtime.")
    .action(async () => {
      const cwd = process.cwd();
      const checks: string[] = [];
      let healthy = true;

      try {
        await fs.access(cwd, fs.constants.W_OK);
        checks.push("Write permission: ok");
      } catch {
        healthy = false;
        checks.push("Write permission: failed");
      }

      checks.push(`Core scanner: ${typeof scanMarkdownFiles === "function" ? "ok" : "failed"}`);

      process.stdout.write("GotSaeng OS Doctor\n\n");
      process.stdout.write(`Node: ${process.version}\n`);
      process.stdout.write(`CLI version: ${CLI_VERSION}\n`);
      process.stdout.write(`Current directory: ${cwd}\n`);
      process.stdout.write(`${checks.join("\n")}\n`);

      if (!healthy) {
        process.exitCode = 1;
      }
    });
}
