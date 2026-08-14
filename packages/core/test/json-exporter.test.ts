import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { renderCompileReport, writeCompileReport, type CompileReport } from "../src/index";
import { createNodeFileSystemAdapter } from "./helpers/node-file-system";

const fsAdapter = createNodeFileSystemAdapter();

describe("renderCompileReport", () => {
  it("renders a schema-valid report as pretty-printed JSON with a trailing newline", () => {
    const report = createReport();

    const rendered = renderCompileReport(report);

    expect(rendered.endsWith("\n")).toBe(true);
    expect(JSON.parse(rendered)).toEqual(report);
    // Pretty-printed with 2-space indent, not minified.
    expect(rendered).toContain('\n  "filesScanned": 4');
  });

  it("throws instead of silently emitting an invalid report", () => {
    // Downstream consumers rely on renderCompileReport's `.parse()` call to
    // fail loudly on a malformed report rather than writing bad JSON to disk.
    const malformed: CompileReport = { ...createReport(), filesScanned: -1 };

    expect(() => renderCompileReport(malformed)).toThrow();
  });
});

describe("writeCompileReport", () => {
  it("creates the output directory (recursively) and writes COMPILE_REPORT.json", async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "gotsaeng-json-exporter-"));
    const outputDir = path.join(baseDir, "nested", "output");
    const report = createReport();

    await writeCompileReport(fsAdapter, report, outputDir);

    const written = await fs.readFile(path.join(outputDir, "COMPILE_REPORT.json"), "utf8");
    expect(written).toBe(renderCompileReport(report));
    expect(JSON.parse(written)).toEqual(report);
  });
});

function createReport(): CompileReport {
  return {
    filesScanned: 4,
    markdownFilesParsed: 3,
    filesSkipped: 1,
    parseErrors: [],
    warnings: ["Missing updated field: note.md"],
    generatedFiles: ["PROJECT_CONTEXT.md"],
  };
}
