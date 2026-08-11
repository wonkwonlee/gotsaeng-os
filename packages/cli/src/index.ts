import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Command, CommanderError } from "commander";

import { createCompileCommand } from "./commands/compile";
import { createDoctorCommand } from "./commands/doctor";
import { createValidateCommand } from "./commands/validate";
import { CLI_VERSION } from "./version";

export function createProgram(): Command {
  const program = new Command();

  program
    .name("gotsaeng")
    .description("GotSaeng OS local-first context compiler.")
    .version(CLI_VERSION);

  program.addCommand(createCompileCommand());
  program.addCommand(createValidateCommand());
  program.addCommand(createDoctorCommand());

  return program;
}

function isDirectCliExecution(argvPath: string | undefined, moduleUrl: string): boolean {
  if (!argvPath) {
    return false;
  }

  try {
    return realpathSync(argvPath) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

if (isDirectCliExecution(process.argv[1], import.meta.url)) {
  try {
    await createProgram().parseAsync(process.argv);
  } catch (error) {
    // compile/validate call exitOverride() so their JSON error handling (see
    // json-error.ts) can run instead of Commander calling process.exit()
    // directly; that override makes parse-time failures throw here instead.
    if (error instanceof CommanderError) {
      process.exitCode = error.exitCode;
    } else {
      throw error;
    }
  }
}
