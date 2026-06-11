import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  compileContextPack,
  CONTEXT_MANIFEST_FILE,
  GENERATED_MARKDOWN_FILES,
  MEMORY_DIFF_FILE,
  renderCompileReport,
  renderMarkdownFiles,
  writeContextPack
} from "../src/index";

describe("compiler", () => {
  const sampleVault = path.resolve(process.cwd(), "examples/sample-vault");
  const clock = () => new Date("2026-06-06T00:00:00.000Z");

  it("generates a valid ContextPack from the sample vault", async () => {
    const pack = await compileContextPack({
      sourceRoot: sampleVault,
      projectName: "GotSaeng OS",
      generatedAt: "2026-06-06T00:00:00.000Z",
      dateProvider: clock
    });

    expect(pack.projectName).toBe("GotSaeng OS");
    expect(pack.report.filesScanned).toBe(8);
    expect(pack.report.markdownFilesParsed).toBe(8);
    expect(pack.facts.length).toBeGreaterThan(0);
    expect(pack.decisions.length).toBeGreaterThan(0);
    expect(pack.actions.length).toBeGreaterThan(0);
    expect(pack.risks.length).toBeGreaterThan(0);
    expect(pack.assumptions.length).toBeGreaterThan(0);
    expect(pack.questions.length).toBeGreaterThan(0);
    expect(pack.insights.length).toBeGreaterThan(0);
    expect(pack.contradictions.length).toBeGreaterThan(0);
    expect(pack.staleItems.length).toBeGreaterThan(0);
    expect(pack.report.extractionStats).toMatchObject({
      notesWithItems: 5,
      notesWithoutItems: 3
    });
    expect(pack.report.sourceCoverage).toMatchObject({
      notesWithUpdated: 5,
      notesMissingUpdated: 3
    });
    expect(pack.report.warnings).toEqual([
      "Missing updated field: templates/decision.md",
      "Missing updated field: templates/project.md",
      "Missing updated field: templates/weekly-review.md"
    ]);
    expect(pack.report.warningTriage).toMatchObject({
      totalWarnings: 3,
      totalParseErrors: 0,
      items: [
        {
          label: "Notes missing updated dates",
          count: 3,
          severity: "warning"
        }
      ]
    });
    expect(pack.report.provenanceStats).toMatchObject({
      averageScore: expect.any(Number),
      strongItems: expect.any(Number),
      weakItems: expect.any(Number)
    });
    expect(pack.report.confidenceStats).toMatchObject({
      averageScore: expect.any(Number),
      highItems: expect.any(Number),
      lowItems: expect.any(Number)
    });
    expect(pack.report.contradictionStats).toMatchObject({
      totalCandidates: expect.any(Number),
      reviewItems: expect.any(Number),
      watchItems: expect.any(Number)
    });
    expect(pack.actions[0]?.provenance).toMatchObject({
      score: expect.any(Number),
      level: expect.stringMatching(/strong|moderate|weak/)
    });
    expect(pack.actions[0]?.confidence).toMatchObject({
      score: expect.any(Number),
      level: expect.stringMatching(/high|medium|low/)
    });
  });

  it("renders all generated Markdown files with source paths", async () => {
    const pack = await compileContextPack({
      sourceRoot: sampleVault,
      projectName: "GotSaeng OS",
      generatedAt: "2026-06-06T00:00:00.000Z",
      dateProvider: clock
    });
    const files = renderMarkdownFiles(pack);

    expect(Object.keys(files)).toEqual([...GENERATED_MARKDOWN_FILES]);
    expect(files["PROJECT_CONTEXT.md"]).toContain("01_projects/gotsaeng-os.md");
    expect(files["PROJECT_CONTEXT.md"]).toContain("Ship the v0.1 local-first context compiler");
    expect(files["MEMORY_SNAPSHOT.md"]).toContain("## Assumptions");
    expect(files["MEMORY_SNAPSHOT.md"]).toContain("## Source Provenance");
    expect(files["MEMORY_SNAPSHOT.md"]).toContain("## Confidence Metadata");
    expect(files["MEMORY_SNAPSHOT.md"]).toContain("## Warning Triage");
    expect(files["STALE_CONTEXT.md"]).toContain("03_logs/weekly-review-2026-W23.md");
    expect(files["SOURCE_PROVENANCE.md"]).toContain("# Source Provenance: GotSaeng OS");
    expect(files["CONFIDENCE.md"]).toContain("# Confidence Metadata: GotSaeng OS");
    expect(files["CONTRADICTIONS.md"]).toContain("# Contradiction Candidates: GotSaeng OS");
  });

  it("writes Markdown files and JSON report", async () => {
    const pack = await compileContextPack({
      sourceRoot: sampleVault,
      projectName: "GotSaeng OS",
      generatedAt: "2026-06-06T00:00:00.000Z",
      dateProvider: clock
    });
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "gotsaeng-core-"));
    const report = await writeContextPack(pack, outputDir);

    for (const fileName of [...GENERATED_MARKDOWN_FILES, MEMORY_DIFF_FILE, CONTEXT_MANIFEST_FILE, "COMPILE_REPORT.json"]) {
      await expect(fs.stat(path.join(outputDir, fileName))).resolves.toBeDefined();
    }

    expect(report.generatedFiles).toEqual([
      ...GENERATED_MARKDOWN_FILES,
      MEMORY_DIFF_FILE,
      CONTEXT_MANIFEST_FILE,
      "COMPILE_REPORT.json"
    ]);
    const parsedReport = JSON.parse(await fs.readFile(path.join(outputDir, "COMPILE_REPORT.json"), "utf8")) as {
      generatedFiles: string[];
    };
    expect(parsedReport.generatedFiles).toContain("COMPILE_REPORT.json");
    expect(await fs.readFile(path.join(outputDir, MEMORY_DIFF_FILE), "utf8")).toContain("establishes the local memory diff baseline");
    expect(JSON.parse(await fs.readFile(path.join(outputDir, CONTEXT_MANIFEST_FILE), "utf8"))).toMatchObject({
      projectName: "GotSaeng OS",
      itemCount: pack.report.extractionStats?.totalItems
    });
  });

  it("ignores the generated output folder on recompile via ignoreGlobs", async () => {
    const vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), "gotsaeng-ignore-"));
    await fs.mkdir(path.join(vaultDir, "notes"), { recursive: true });
    await fs.writeFile(
      path.join(vaultDir, "notes/project.md"),
      [
        "---",
        "type: project",
        "title: Ignore Globs Project",
        "updated: 2026-06-05",
        "---",
        "",
        "# Ignore Globs Project",
        "",
        "- fact: The compiler runs locally.",
        "- decision: Ship the v0.1 local-first compiler.",
        "- todo: Write the scanner ignore test. status: active priority: high",
        "- question: Which folders should be excluded from scans?"
      ].join("\n"),
      "utf8"
    );

    const firstPack = await compileContextPack({
      sourceRoot: vaultDir,
      projectName: "GotSaeng OS",
      generatedAt: "2026-06-06T00:00:00.000Z",
      dateProvider: clock
    });

    // A clean compile of a vault with a properly dated note produces no warnings.
    expect(firstPack.report.warnings).toEqual([]);

    // Simulate the plugin writing its visible output folder back inside the vault.
    const rendered = renderMarkdownFiles(firstPack);
    const outputFolder = "Gotsaeng/Context Pack";
    await fs.mkdir(path.join(vaultDir, outputFolder), { recursive: true });
    for (const fileName of GENERATED_MARKDOWN_FILES) {
      await fs.writeFile(path.join(vaultDir, outputFolder, fileName), rendered[fileName], "utf8");
    }

    // Without ignoreGlobs the generated files are re-scanned and pollute the report.
    const pollutedPack = await compileContextPack({
      sourceRoot: vaultDir,
      projectName: "GotSaeng OS",
      generatedAt: "2026-06-06T00:00:00.000Z",
      dateProvider: clock
    });
    expect(pollutedPack.report.warnings.some((warning) => warning.includes(outputFolder))).toBe(true);

    // With ignoreGlobs the generated output folder is excluded entirely.
    const ignoredPack = await compileContextPack({
      sourceRoot: vaultDir,
      projectName: "GotSaeng OS",
      generatedAt: "2026-06-06T00:00:00.000Z",
      dateProvider: clock,
      ignoreGlobs: [`${outputFolder}/**`]
    });

    expect(ignoredPack.report.warnings.filter((warning) => warning.includes(outputFolder))).toEqual([]);
    expect(ignoredPack.report.warnings).toEqual(firstPack.report.warnings);
    expect(ignoredPack.report.filesScanned).toBe(firstPack.report.filesScanned);
    expect(ignoredPack.report.markdownFilesParsed).toBe(firstPack.report.markdownFilesParsed);
    expect(ignoredPack.report.extractionStats?.totalItems).toBe(firstPack.report.extractionStats?.totalItems);
    expect(ignoredPack.facts.length).toBe(firstPack.facts.length);
    expect(ignoredPack.decisions.length).toBe(firstPack.decisions.length);
    expect(ignoredPack.actions.length).toBe(firstPack.actions.length);
    expect(ignoredPack.questions.length).toBe(firstPack.questions.length);
  });

  it("renders a stable JSON compile report", () => {
    const json = renderCompileReport({
      filesScanned: 1,
      markdownFilesParsed: 1,
      filesSkipped: 0,
      parseErrors: [],
      warnings: [],
      extractionStats: {
        totalItems: 0,
        byKind: {},
        byStatus: {},
        notesWithItems: 0,
        notesWithoutItems: 1
      },
      sourceCoverage: {
        noteTypes: {
          unknown: 1
        },
        notesWithUpdated: 0,
        notesMissingUpdated: 1
      },
      generatedFiles: ["PROJECT_CONTEXT.md", "COMPILE_REPORT.json"]
    });

    expect(JSON.parse(json)).toEqual({
      filesScanned: 1,
      markdownFilesParsed: 1,
      filesSkipped: 0,
      parseErrors: [],
      warnings: [],
      extractionStats: {
        totalItems: 0,
        byKind: {},
        byStatus: {},
        notesWithItems: 0,
        notesWithoutItems: 1
      },
      sourceCoverage: {
        noteTypes: {
          unknown: 1
        },
        notesWithUpdated: 0,
        notesMissingUpdated: 1
      },
      generatedFiles: ["PROJECT_CONTEXT.md", "COMPILE_REPORT.json"]
    });
  });
});
