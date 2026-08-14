import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

// vitest types its asymmetric matchers as `any`; these aliases keep the
// rejection shapes below type-checked while passing the matcher through.
const matchingString = (pattern: RegExp): string => expect.stringMatching(pattern) as string;
const containingString = (value: string): string => expect.stringContaining(value) as string;

describe("cli", () => {
  const cliPath = path.resolve(process.cwd(), "packages/cli/dist/index.js");
  const sampleVault = path.resolve(process.cwd(), "examples/sample-vault");

  // The reported version must track packages/cli/package.json, never a hardcoded
  // constant — see version.ts. Read it here so the assertion cannot silently drift.
  async function cliPackageVersion(): Promise<string> {
    const manifest = JSON.parse(
      await fs.readFile(path.resolve(process.cwd(), "packages/cli/package.json"), "utf8"),
    ) as { version: string };
    return manifest.version;
  }

  async function expectCliFailure(args: string[]): Promise<{ stderr: string; code: number }> {
    try {
      await execFileAsync(process.execPath, [cliPath, ...args]);
    } catch (error) {
      return error as { stderr: string; code: number };
    }
    throw new Error(`expected CLI to fail for args: ${args.join(" ")}`);
  }

  it("runs doctor", async () => {
    const { stdout } = await execFileAsync(process.execPath, [cliPath, "doctor"]);

    expect(stdout).toContain("GotSaeng OS Doctor");
    expect(stdout).toContain(`CLI version: ${await cliPackageVersion()}`);
    expect(stdout).toContain("Write permission: ok");
  });

  it("runs doctor through an npm-style bin symlink", async () => {
    const binDir = await fs.mkdtemp(path.join(os.tmpdir(), "gotsaeng-cli-bin-"));
    const binPath = path.join(binDir, "gotsaeng");
    await fs.symlink(cliPath, binPath);

    const { stdout } = await execFileAsync(binPath, ["doctor"]);

    expect(stdout).toContain("GotSaeng OS Doctor");
    expect(stdout).toContain(`CLI version: ${await cliPackageVersion()}`);
    expect(stdout).toContain("Write permission: ok");
  });

  it("compiles the sample vault", async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "gotsaeng-cli-"));
    const { stdout } = await execFileAsync(process.execPath, [
      cliPath,
      "compile",
      sampleVault,
      "--output",
      outputDir,
      "--project",
      "GotSaeng OS",
    ]);

    expect(stdout).toContain("GotSaeng OS Context Compiler");
    expect(stdout).toContain("Project: GotSaeng OS");

    for (const fileName of [
      "PROJECT_CONTEXT.md",
      "MEMORY_SNAPSHOT.md",
      "DECISION_LOG.md",
      "ACTION_BACKLOG.md",
      "RISK_REGISTER.md",
      "OPEN_QUESTIONS.md",
      "STALE_CONTEXT.md",
      "SOURCE_PROVENANCE.md",
      "CONFIDENCE.md",
      "CONTRADICTIONS.md",
      "MEMORY_DIFF.md",
      "CONTEXT_MANIFEST.json",
      "COMPILE_REPORT.json",
    ]) {
      await expect(fs.stat(path.join(outputDir, fileName))).resolves.toBeDefined();
    }
  });

  it("validates the sample vault with readable warning output", async () => {
    const { stdout } = await execFileAsync(process.execPath, [cliPath, "validate", sampleVault]);

    expect(stdout).toContain("GotSaeng OS Vault Validation");
    expect(stdout).toContain("Mode: compatibility");
    expect(stdout).toContain("Status: valid with warnings");
    expect(stdout).toContain("Warnings (3):");
    expect(stdout).toContain("templates/project.md: Missing updated field.");
    expect(stdout).toContain("Valid.");
  });

  it("keeps strict validation available for schema enforcement", async () => {
    const vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), "gotsaeng-cli-strict-"));
    await fs.writeFile(
      path.join(vaultDir, "wiki.md"),
      ["---", "type: wiki", 'created: <% tp.date.now("YYYY-MM-DD") %>', "---", "", "# Wiki"].join(
        "\n",
      ),
      "utf8",
    );

    const compatibility = await execFileAsync(process.execPath, [cliPath, "validate", vaultDir]);
    expect(compatibility.stdout).toContain("Mode: compatibility");
    expect(compatibility.stdout).toContain("Status: valid with warnings");
    expect(compatibility.stdout).toContain("Custom note type: wiki; mapped to research.");

    await expect(
      execFileAsync(process.execPath, [cliPath, "validate", vaultDir, "--strict"]),
    ).rejects.toMatchObject({
      stdout: matchingString(/Mode: strict[\s\S]*Invalid note type: wiki/),
    });
  });

  it("prints helpful compile errors for missing vault paths", async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "gotsaeng-cli-missing-"));

    await expect(
      execFileAsync(process.execPath, [
        cliPath,
        "compile",
        path.join(outputDir, "missing-vault"),
        "--output",
        outputDir,
        "--project",
        "GotSaeng OS",
      ]),
    ).rejects.toMatchObject({
      stderr: matchingString(
        /GotSaeng OS compile failed[\s\S]*The source vault path exists and is a directory\./,
      ),
    });
  });

  // Regression coverage: Commander rejects an invalid invocation (missing
  // required option/argument, a parseArg that throws) while parsing, before
  // this command's action and its --json handling ever run. Without
  // installJsonErrorHandling, these three cases would print Commander's
  // default human-readable text to stderr even when --json was requested.
  it("emits a JSON error for compile's pre-action failures when --json is set", async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "gotsaeng-cli-json-err-"));

    const missingProject = await expectCliFailure([
      "compile",
      sampleVault,
      "--output",
      outputDir,
      "--json",
    ]);
    expect(missingProject.code).toBe(1);
    expect(JSON.parse(missingProject.stderr)).toMatchObject({
      schemaVersion: 1,
      error: { title: "GotSaeng OS compile failed" },
    });

    const invalidStaleDays = await expectCliFailure([
      "compile",
      sampleVault,
      "--output",
      outputDir,
      "--project",
      "GotSaeng OS",
      "--stale-days",
      "not-a-number",
      "--json",
    ]);
    expect(invalidStaleDays.code).toBe(1);
    expect(JSON.parse(invalidStaleDays.stderr)).toMatchObject({
      schemaVersion: 1,
      error: { title: "GotSaeng OS compile failed" },
    });
  });

  it("emits a JSON error for validate's missing vault argument when --json is set", async () => {
    const result = await expectCliFailure(["validate", "--json"]);

    expect(result.code).toBe(1);
    expect(JSON.parse(result.stderr)).toMatchObject({
      schemaVersion: 1,
      error: { title: "GotSaeng OS validate failed" },
    });
  });

  it("keeps Commander's plain-text error output when --json is not set", async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "gotsaeng-cli-text-err-"));

    await expect(
      execFileAsync(process.execPath, [cliPath, "compile", sampleVault, "--output", outputDir]),
    ).rejects.toMatchObject({
      code: 1,
      stderr: containingString("required option '--project"),
    });
  });
});
