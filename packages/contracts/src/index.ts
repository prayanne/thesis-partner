import { z } from "zod";
export const uuid = z.string().uuid();
export const expectedRevision = z.number().int().positive();
export const blockSchema = z
  .object({
    blockKey: z.string().min(1).max(100),
    kind: z.enum([
      "markdown",
      "paper_reading",
      "wiki_reading",
      "self_explanation",
      "exercise",
      "checklist",
    ]),
    schemaVersion: z.literal(1).default(1),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();
export const resourceSchema = z
  .object({
    kind: z.enum(["paper", "wiki", "external"]),
    title: z.string().min(1).max(500),
    sourceUrl: z.string().url().nullable().optional(),
    paperId: uuid.nullable().optional(),
    wikiId: uuid.nullable().optional(),
    readingScope: z.record(z.string(), z.unknown()).default({}),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((r, ctx) => {
    if (
      (r.kind === "external" && !r.sourceUrl) ||
      (r.kind === "paper" && !r.paperId) ||
      (r.kind === "wiki" && !r.wikiId)
    )
      ctx.addIssue({ code: "custom", message: "Resource target is required" });
    if (r.sourceUrl && !/^https?:\/\//.test(r.sourceUrl))
      ctx.addIssue({ code: "custom", message: "HTTP(S) resources only" });
  });
export const generationSchema = z.object({
  requestId: uuid,
  cacheMode: z.enum(["use", "refresh"]).default("use"),
  scope: z
    .object({
      type: z.enum(["paper", "page", "segments"]).default("paper"),
      pageNumber: z.number().int().positive().optional(),
      segmentIds: z.array(uuid).max(1000).optional(),
    })
    .default({ type: "paper" }),
  targetLanguage: z.string().min(2).max(20).optional(),
  message: z.string().min(1).max(20000).optional(),
});
export const analysisSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    paperId: uuid,
    paperRevisionId: uuid.nullable(),
    extractionRunId: uuid.nullable(),
    contentHash: z.string().nullable(),
    analysisRevision: z.number().int().positive(),
    status: z.enum(["pending", "partial", "complete", "failed"]),
    generatedAt: z.string(),
    bibliography: z.record(z.string(), z.unknown()),
    coverage: z.object({
      parsedPages: z.number(),
      totalPages: z.number().nullable(),
      aiAnalyzedPages: z.number(),
    }),
    warnings: z.array(z.string()),
  })
  .passthrough();
export type LessonBlock = z.infer<typeof blockSchema>;
export interface OperationInput {
  method: string;
  path: string | string[];
  body?: unknown;
  query?: URLSearchParams;
}
export interface OperationResult<T = unknown> {
  data: T;
  status?: number;
  meta?: Record<string, unknown>;
}
