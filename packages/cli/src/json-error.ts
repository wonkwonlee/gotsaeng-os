import type { Command } from "commander";

import { renderCliErrorJson } from "./output";

// Commander rejects invalid invocations (a missing required option or
// positional argument, an --stale-days value that fails parsePositiveInteger)
// while parsing options — before this command's action, and its try/catch
// around --json, ever run. Left alone, Commander writes its own
// human-readable text to stderr and calls process.exit() directly, so a
// --json caller gets unparseable stderr instead of the promised JSON error
// object. Route those pre-action failures through the same JSON error shape
// when --json was requested, and stop Commander from exiting the process
// directly so the caller in index.ts can set the exit code instead.
export function installJsonErrorHandling(command: Command): void {
  command.configureOutput({
    writeErr: (str: string) => {
      if (process.argv.includes("--json")) {
        process.stderr.write(
          renderCliErrorJson({
            title: `GotSaeng OS ${command.name()} failed`,
            reason: str.trim(),
          }),
        );
      } else {
        process.stderr.write(str);
      }
    },
  });
  command.exitOverride();
}
