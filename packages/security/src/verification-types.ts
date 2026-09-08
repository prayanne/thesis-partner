import { z } from "zod";
import { reasoningEffortSchema } from "../../providers/src/registry";
export const aiFunctionSchema = z.enum([
  "summary",
  "chat",
  "analysis",
  "embedding",
]);
const token = z.number().int().nonnegative();
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
export const validationReportSchema = z
  .object({
    id: z.string().uuid(),
    stage: z.enum(["metadata", "inference"]),
    function: aiFunctionSchema,
    fingerprint,
    checkedAt: z.iso.datetime(),
    status: z.enum(["passed", "blocked", "failed", "incomplete"]),
    modelId: z.string().max(200),
    reasoningEffort: reasoningEffortSchema.optional(),
    inferencePerformed: z.boolean(),
    code: z.string().max(80),
    message: z.string().max(400),
    maxOutputTokens: token.max(512).optional(),
    serviceTier: z.literal("default").optional(),
    providerRequestId: z.string().max(200).optional(),
    usage: z
      .object({
        inputTokens: token.optional(),
        outputTokens: token.optional(),
        totalTokens: token.optional(),
        reasoningTokens: token.optional(),
        cacheReadTokens: token.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type ValidationReport = z.infer<typeof validationReportSchema>;
export interface ProviderValidationState {
  providerId: string;
  function: z.infer<typeof aiFunctionSchema>;
  fingerprint: string;
  metadata: ValidationReport | null;
  inference: ValidationReport | null;
  stale: boolean;
}
const support = z.enum(["supported", "unsupported", "unknown"]);
const modelSchema = z
  .object({
    id: z.string().min(1).max(200),
    displayName: z.string().max(200).optional(),
    revision: z.string().max(200).optional(),
    executionLocation: z.enum(["local", "remote", "unknown"]),
    localOnlyEligible: z.boolean(),
    capabilities: z
      .object({
        chat: support,
        embedding: support,
        streaming: support,
        structuredOutput: support,
        vision: support,
        toolUse: support,
      })
      .strict(),
    capabilitySource: z.enum(["native", "provider", "unknown"]),
  })
  .strip();
export const providerEvidenceSchema = z
  .object({
    discovery: z
      .object({
        fingerprint,
        discoveredAt: z.iso.datetime(),
        models: z.array(modelSchema).max(2000),
      })
      .strict()
      .optional(),
    reports: z
      .record(
        aiFunctionSchema,
        z
          .object({
            metadata: validationReportSchema.optional(),
            inference: validationReportSchema.optional(),
          })
          .strict(),
      )
      .default({ summary: {}, chat: {}, analysis: {}, embedding: {} }),
  })
  .strict();
export type ProviderEvidence = z.infer<typeof providerEvidenceSchema>;
export const validationInputSchema = z
  .object({
    stage: z.enum(["metadata", "inference"]),
    function: aiFunctionSchema.default("summary"),
    confirmPaid: z.boolean().default(false),
    expectedFingerprint: fingerprint.optional(),
  })
  .strict();
