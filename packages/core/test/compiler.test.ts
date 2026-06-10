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
