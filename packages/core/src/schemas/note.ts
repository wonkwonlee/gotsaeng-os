import { z } from "zod";

export const NoteTypeSchema = z.enum([
  "project",
  "decision",
  "daily",
  "weekly-review",
  "research",
  "chat-export",
  "template",
  "unknown"
]);

export type NoteType = z.infer<typeof NoteTypeSchema>;

export const NoteDocumentSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  title: z.string().min(1),
  body: z.string(),
  frontmatter: z.record(z.unknown()),
  noteType: NoteTypeSchema,
  tags: z.array(z.string()),
  created: z.string().optional(),
  updated: z.string().optional(),
  raw: z.string()
});

export type NoteDocument = z.infer<typeof NoteDocumentSchema>;
