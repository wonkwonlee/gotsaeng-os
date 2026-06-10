import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  compileContextPack,
  CONTEXT_MANIFEST_FILE,
  createContextManifest,
  GENERATED_MARKDOWN_FILES,
  MEMORY_DIFF_FILE,
  renderCompileReport,
  renderMarkdownFiles,
} from "../src/index";

describe("generated output snapshots", () => {
  const sampleVault = path.resolve(process.cwd(), "examples/sample-vault");
  const sampleOutput = path.resolve(process.cwd(), "examples/sample-output");
  const generatedAt = "2026-06-06T00:00:00.000Z";
  const clock = () => new Date(generatedAt);

  it("matches the checked sample Markdown output", async () => {
    const pack = await compileContextPack({
      sourceRoot: sampleVault,
      projectName: "GotSaeng OS",
      generatedAt,
      dateProvider: clock,
    });
    const renderedFiles = renderMarkdownFiles(pack);

    for (const fileName of GENERATED_MARKDOWN_FILES) {
      const expected = await fs.readFile(path.join(sampleOutput, fileName), "utf8");
      expect(renderedFiles[fileName], fileName).toBe(expected);
    }
  });

  it("matches the checked sample compile report", async () => {
    const pack = await compileContextPack({
      sourceRoot: sampleVault,
      projectName: "GotSaeng OS",
      generatedAt,
      dateProvider: clock,
    });
    const renderedReport = renderCompileReport({
      ...pack.report,
      generatedFiles: [
        ...GENERATED_MARKDOWN_FILES,
        MEMORY_DIFF_FILE,
        CONTEXT_MANIFEST_FILE,
        "COMPILE_REPORT.json",
      ],
    });

    const expected = await fs.readFile(path.join(sampleOutput, "COMPILE_REPORT.json"), "utf8");
    expect(renderedReport).toBe(expected);
  });

  it("matches the checked sample context manifest except for the local source root", async () => {
    const pack = await compileContextPack({
      sourceRoot: sampleVault,
      projectName: "GotSaeng OS",
      generatedAt,
      dateProvider: clock,
    });
    const manifest = createContextManifest(pack);
    const expectedManifest = JSON.parse(
      await fs.readFile(path.join(sampleOutput, CONTEXT_MANIFEST_FILE), "utf8"),
    ) as typeof manifest;

    expectedManifest.sourceRoot = sampleVault;
    expect(`${JSON.stringify(manifest, null, 2)}
`).toBe(`${JSON.stringify(expectedManifest, null, 2)}
`);
  });
});
