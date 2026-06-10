import { z } from "zod";

export type DateProvider = () => Date;

export const CompileOptionsSchema = z.object({
  sourceRoot: z.string().min(1),
  projectName: z.string().min(1),
  staleDays: z.number().int().positive().default(90),
  generatedAt: z.string().optional()
});

export type CompileOptions = z.input<typeof CompileOptionsSchema> & {
  dateProvider?: DateProvider;
};

export type StaleDetectionOptions = {
  staleDays?: number;
  dateProvider?: DateProvider;
};
