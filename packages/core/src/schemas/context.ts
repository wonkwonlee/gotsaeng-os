import { z } from "zod";

import { NoteDocumentSchema } from "./note";

export const ExtractedItemKindSchema = z.enum([
  "fact",
  "decision",
  "action",
  "risk",
  "assumption",
  "question",
  "insight"
]);

export type ExtractedItemKind = z.infer<typeof ExtractedItemKindSchema>;

export const ExtractedItemStatusSchema = z.enum(["open", "active", "done", "stale", "unknown"]);

export type ExtractedItemStatus = z.infer<typeof ExtractedItemStatusSchema>;

export const ExtractedItemPrioritySchema = z.enum(["low", "medium", "high"]);

export type ExtractedItemPriority = z.infer<typeof ExtractedItemPrioritySchema>;

export const SourceProvenanceLevelSchema = z.enum(["strong", "moderate", "weak"]);

export type SourceProvenanceLevel = z.infer<typeof SourceProvenanceLevelSchema>;

export const SourceProvenanceSchema = z.object({
  score: z.number().int().min(0).max(100),
  level: SourceProvenanceLevelSchema,
  calibration: z.string().optional(),
  signals: z.array(z.string()),
  warnings: z.array(z.string())
});

export type SourceProvenance = z.infer<typeof SourceProvenanceSchema>;

export const ConfidenceLevelSchema = z.enum(["high", "medium", "low"]);

export type ConfidenceLevel = z.infer<typeof ConfidenceLevelSchema>;

export const ConfidenceMetadataSchema = z.object({
  score: z.number().int().min(0).max(100),
  level: ConfidenceLevelSchema,
  signals: z.array(z.string()),
  warnings: z.array(z.string())
});

export type ConfidenceMetadata = z.infer<typeof ConfidenceMetadataSchema>;

export const ContradictionSignalSchema = z.enum(["explicit_marker", "section_heading", "keyword_cue"]);

export type ContradictionSignal = z.infer<typeof ContradictionSignalSchema>;

export const ContradictionSeveritySchema = z.enum(["review", "watch"]);

export type ContradictionSeverity = z.infer<typeof ContradictionSeveritySchema>;

export const ContradictionCandidateSchema = z.object({
  id: z.string().min(1),
  sourcePath: z.string().min(1),
  sourceTitle: z.string().min(1),
  signal: ContradictionSignalSchema,
  severity: ContradictionSeveritySchema,
  text: z.string().min(1),
  evidence: z.array(z.string()),
  tags: z.array(z.string())
});

export type ContradictionCandidate = z.infer<typeof ContradictionCandidateSchema>;

export const ExtractedItemSchema = z.object({
  id: z.string().min(1),
  sourcePath: z.string().min(1),
  sourceTitle: z.string().min(1),
  kind: ExtractedItemKindSchema,
  text: z.string().min(1),
  status: ExtractedItemStatusSchema.optional(),
  priority: ExtractedItemPrioritySchema.optional(),
  created: z.string().optional(),
  updated: z.string().optional(),
  provenance: SourceProvenanceSchema.optional(),
  confidence: ConfidenceMetadataSchema.optional(),
  tags: z.array(z.string())
});

export type ExtractedItem = z.infer<typeof ExtractedItemSchema>;

export const CompileReportSchema = z.object({
  filesScanned: z.number().int().nonnegative(),
  markdownFilesParsed: z.number().int().nonnegative(),
  filesSkipped: z.number().int().nonnegative(),
  parseErrors: z.array(
    z.object({
      path: z.string(),
      message: z.string()
    })
  ),
  warnings: z.array(z.string()),
  extractionStats: z
    .object({
      totalItems: z.number().int().nonnegative(),
      byKind: z.record(z.number().int().nonnegative()),
      byStatus: z.record(z.number().int().nonnegative()),
      notesWithItems: z.number().int().nonnegative(),
      notesWithoutItems: z.number().int().nonnegative()
    })
    .optional(),
  sourceCoverage: z
    .object({
      noteTypes: z.record(z.number().int().nonnegative()),
      notesWithUpdated: z.number().int().nonnegative(),
      notesMissingUpdated: z.number().int().nonnegative()
    })
    .optional(),
  warningTriage: z
    .object({
      totalWarnings: z.number().int().nonnegative(),
      totalParseErrors: z.number().int().nonnegative(),
      items: z.array(
        z.object({
          label: z.string(),
          count: z.number().int().nonnegative(),
          severity: z.enum(["info", "warning", "error"]),
          examples: z.array(z.string())
        })
      )
    })
    .optional(),
  provenanceStats: z
    .object({
      averageScore: z.number().min(0).max(100),
      byLevel: z.record(z.number().int().nonnegative()),
      weakItems: z.number().int().nonnegative(),
      moderateItems: z.number().int().nonnegative(),
      strongItems: z.number().int().nonnegative()
    })
    .optional(),
  confidenceStats: z
    .object({
      averageScore: z.number().min(0).max(100),
      byLevel: z.record(z.number().int().nonnegative()),
      lowItems: z.number().int().nonnegative(),
      highItems: z.number().int().nonnegative()
    })
    .optional(),
  contradictionStats: z
    .object({
      totalCandidates: z.number().int().nonnegative(),
      bySignal: z.record(z.number().int().nonnegative()),
      reviewItems: z.number().int().nonnegative(),
      watchItems: z.number().int().nonnegative()
    })
    .optional(),
  generatedFiles: z.array(z.string())
});

export type CompileReport = z.infer<typeof CompileReportSchema>;

export const ContextManifestItemSchema = ExtractedItemSchema.extend({
  stale: z.boolean()
});

export type ContextManifestItem = z.infer<typeof ContextManifestItemSchema>;

export const ContextManifestSchema = z.object({
  projectName: z.string().min(1),
  generatedAt: z.string().min(1),
  sourceRoot: z.string().min(1),
  itemCount: z.number().int().nonnegative(),
  items: z.array(ContextManifestItemSchema)
});

export type ContextManifest = z.infer<typeof ContextManifestSchema>;

export const MemoryDiffChangedFieldSchema = z.object({
  field: z.string().min(1),
  previous: z.string(),
  current: z.string()
});

export type MemoryDiffChangedField = z.infer<typeof MemoryDiffChangedFieldSchema>;

export const MemoryDiffChangedItemSchema = z.object({
  previous: ContextManifestItemSchema,
  current: ContextManifestItemSchema,
  changes: z.array(MemoryDiffChangedFieldSchema)
});

export type MemoryDiffChangedItem = z.infer<typeof MemoryDiffChangedItemSchema>;

export const MemoryDiffResolvedItemSchema = z.object({
  item: ContextManifestItemSchema,
  reason: z.enum(["now_done", "removed_or_rewritten", "no_longer_stale"])
});

export type MemoryDiffResolvedItem = z.infer<typeof MemoryDiffResolvedItemSchema>;

export const MemoryDiffSchema = z.object({
  projectName: z.string().min(1),
  generatedAt: z.string().min(1),
  previousGeneratedAt: z.string().optional(),
  currentGeneratedAt: z.string().min(1),
  previousManifestFound: z.boolean(),
  summary: z.object({
    newlyAdded: z.number().int().nonnegative(),
    changed: z.number().int().nonnegative(),
    newlyStale: z.number().int().nonnegative(),
    resolved: z.number().int().nonnegative()
  }),
  newlyAdded: z.array(ContextManifestItemSchema),
  changed: z.array(MemoryDiffChangedItemSchema),
  newlyStale: z.array(ContextManifestItemSchema),
  resolved: z.array(MemoryDiffResolvedItemSchema)
});

export type MemoryDiff = z.infer<typeof MemoryDiffSchema>;

export const ContextPackSchema = z.object({
  projectName: z.string().min(1),
  generatedAt: z.string().min(1),
  sourceRoot: z.string().min(1),
  notes: z.array(NoteDocumentSchema),
  facts: z.array(ExtractedItemSchema),
  decisions: z.array(ExtractedItemSchema),
  actions: z.array(ExtractedItemSchema),
  risks: z.array(ExtractedItemSchema),
  assumptions: z.array(ExtractedItemSchema),
  questions: z.array(ExtractedItemSchema),
  insights: z.array(ExtractedItemSchema),
  contradictions: z.array(ContradictionCandidateSchema),
  staleItems: z.array(ExtractedItemSchema),
  report: CompileReportSchema
});

export type ContextPack = z.infer<typeof ContextPackSchema>;
