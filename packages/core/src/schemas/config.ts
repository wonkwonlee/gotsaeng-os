import { z } from "zod";

export type DateProvider = () => Date;

// Overrides for the extraction- and render-time item caps. Undefined fields fall
// back to each module's own default (MAX_SECTION_LINE_ITEMS_PER_HEADING in
// extractor.ts; REGISTER_ITEM_CAP / INSIGHTS_ITEM_CAP in markdown-exporter.ts).
export const CompileCapsSchema = z.object({
  perHeading: z.number().int().positive().optional(),
  register: z.number().int().positive().optional(),
  insights: z.number().int().positive().optional(),
});

export type CompileCaps = z.infer<typeof CompileCapsSchema>;

export const CompileOptionsSchema = z.object({
  sourceRoot: z.string().min(1),
  projectName: z.string().min(1),
  staleDays: z.number().int().positive().default(90),
  generatedAt: z.string().optional(),
  ignoreGlobs: z.array(z.string()).optional(),
  caps: CompileCapsSchema.optional(),
});

export type CompileOptions = z.input<typeof CompileOptionsSchema> & {
  dateProvider?: DateProvider;
};

export type StaleDetectionOptions = {
  staleDays?: number;
  dateProvider?: DateProvider;
};
