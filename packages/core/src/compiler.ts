import path from "node:path";

import type { FileSystemAdapter } from "./adapters/file-system";
import { extractItems, sortExtractedItems } from "./extractor";
import { parseMarkdownFile } from "./parser";
import { createWarningTriage } from "./quality";
import { applySourceProvenance } from "./provenance";
import { detectContradictionCandidates } from "./contradictions";
import {
  createCompileReport,
  createConfidenceStats,
  createContradictionStats,
  createExtractionStats,
  createProvenanceStats,
  createSourceCoverage,
} from "./report";
import { CompileOptionsSchema, type CompileOptions, type DateProvider } from "./schemas/config";
import { ContextPackSchema, type ContextPack } from "./schemas/context";
import {
  CONTEXT_MANIFEST_FILE,
  MEMORY_DIFF_FILE,
  createContextManifest,
  diffContextManifests,
  readPreviousContextManifest,
  writeContextManifest,
  writeMemoryDiff,
} from "./memory-diff";
import { detectStaleItems } from "./stale";
import { scanMarkdownFiles, scanSourceFiles } from "./scanner";
import { toIsoTimestamp } from "./utils/date";
import { compareStrings } from "./utils/path";
import { writeMarkdownContextPack, type RegisterCaps } from "./exporters/markdown-exporter";
import { writeCompileReport } from "./exporters/json-exporter";
import {
  ARTIFACT_INDEX_FILE,
  buildArtifactIndex,
  writeArtifactIndex,
} from "./exporters/artifact-index";

export async function compileContextPack(
  fsAdapter: FileSystemAdapter,
  options: CompileOptions,
): Promise<ContextPack> {
  const parsedOptions = CompileOptionsSchema.parse(options);
  const dateProvider: DateProvider = options.dateProvider ?? (() => new Date());
  const sourceRoot = path.resolve(parsedOptions.sourceRoot);
  const allFiles = await scanSourceFiles(fsAdapter, sourceRoot, {
    ignoreGlobs: parsedOptions.ignoreGlobs,
  });
  const markdownFiles = await scanMarkdownFiles(fsAdapter, sourceRoot, {
    ignoreGlobs: parsedOptions.ignoreGlobs,
  });
  const notes = [];
  const parseErrors = [];

  for (const filePath of markdownFiles) {
    try {
      notes.push(await parseMarkdownFile(fsAdapter, filePath, sourceRoot));
    } catch (error) {
      parseErrors.push({
        path: path.relative(sourceRoot, filePath),
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  notes.sort((a, b) => compareStrings(a.path, b.path));

  const extractedItems = sortExtractedItems(
    applySourceProvenance(
      notes,
      notes.flatMap((note) =>
        extractItems(note, { maxSectionLineItemsPerHeading: parsedOptions.caps?.perHeading }),
      ),
    ),
  );
  const contradictions = detectContradictionCandidates(notes);
  const staleItems = detectStaleItems({
    notes,
    items: extractedItems,
    staleDays: parsedOptions.staleDays,
    dateProvider,
  });
  const warnings = notes
    .filter((note) => !note.updated)
    .map((note) => `Missing updated field: ${note.path}`)
    .sort();

  const report = createCompileReport({
    filesScanned: allFiles.length,
    markdownFilesParsed: notes.length,
    filesSkipped: allFiles.length - markdownFiles.length + parseErrors.length,
    parseErrors,
    warnings,
    extractionStats: createExtractionStats(notes, extractedItems),
    sourceCoverage: createSourceCoverage(notes),
    provenanceStats: createProvenanceStats(extractedItems),
    confidenceStats: createConfidenceStats(extractedItems),
    contradictionStats: createContradictionStats(contradictions),
    warningTriage: createWarningTriage({
      filesScanned: allFiles.length,
      markdownFilesParsed: notes.length,
      filesSkipped: allFiles.length - markdownFiles.length + parseErrors.length,
      parseErrors,
      warnings,
      generatedFiles: [],
    }),
  });

  const pack = {
    projectName: parsedOptions.projectName.trim(),
    generatedAt: parsedOptions.generatedAt ?? toIsoTimestamp(dateProvider()),
    sourceRoot,
    notes,
    facts: extractedItems.filter((item) => item.kind === "fact"),
    decisions: extractedItems.filter((item) => item.kind === "decision"),
    actions: extractedItems.filter((item) => item.kind === "action"),
    risks: extractedItems.filter((item) => item.kind === "risk"),
    assumptions: extractedItems.filter((item) => item.kind === "assumption"),
    questions: extractedItems.filter((item) => item.kind === "question"),
    insights: extractedItems.filter((item) => item.kind === "insight"),
    contradictions,
    staleItems,
    report,
  };

  return ContextPackSchema.parse(pack);
}

export async function writeContextPack(
  fsAdapter: FileSystemAdapter,
  pack: ContextPack,
  outputDir: string,
  caps: RegisterCaps = {},
): Promise<ContextPack["report"]> {
  const previousManifest = await readPreviousContextManifest(fsAdapter, outputDir);
  const manifest = createContextManifest(pack);
  const memoryDiff = diffContextManifests(previousManifest.manifest, manifest, pack.generatedAt);
  const markdownFiles = await writeMarkdownContextPack(fsAdapter, pack, outputDir, caps);
  await writeMemoryDiff(fsAdapter, memoryDiff, outputDir);
  await writeContextManifest(fsAdapter, manifest, outputDir);

  const warnings = previousManifest.warning
    ? [...pack.report.warnings, previousManifest.warning].sort()
    : pack.report.warnings;
  const generatedFiles = [
    ...markdownFiles,
    MEMORY_DIFF_FILE,
    CONTEXT_MANIFEST_FILE,
    "COMPILE_REPORT.json",
    ARTIFACT_INDEX_FILE,
  ];
  const report = {
    ...pack.report,
    warnings,
    warningTriage: createWarningTriage({
      ...pack.report,
      warnings,
      generatedFiles,
    }),
    generatedFiles,
  };
  pack.report = report;
  await writeCompileReport(fsAdapter, report, outputDir);

  const artifactIndex = await buildArtifactIndex(
    fsAdapter,
    outputDir,
    generatedFiles.filter((name) => name !== ARTIFACT_INDEX_FILE),
    { projectName: pack.projectName, generatedAt: pack.generatedAt },
  );
  await writeArtifactIndex(fsAdapter, artifactIndex, outputDir);
  return report;
}
