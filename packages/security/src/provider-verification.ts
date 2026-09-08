import { createHash, randomUUID } from "node:crypto";
import {
  assertModelSelection,
  assertProviderCallAllowed,
  createProviderAdapter,
  getProviderDefinition,
  modelChoices,
  ProviderError,
  providerFailureDiagnostic,
  type AiFunction,
  type FetchImplementation,
  type ModelChoice,
  type ModelInfo,
  type NormalizedUsage,
} from "../../providers/src";
import {
  AppError,
  credentialStatus,
  readConfig,
  readCredential,
  readProviderEvidence,
  resolveTaskModel,
  updateProviderEvidence,
} from "./index";
import {
  validationInputSchema,
  type ProviderValidationState,
  type ValidationReport,
} from "./verification-types";

export type {
  ProviderValidationState,
  ValidationReport,
} from "./verification-types";
export interface ProviderModelCatalog {
  providerId: string;
  fingerprint: string;
  discoveredAt: string | null;
  stale: boolean;
  models: ModelChoice[];
}
export const VALIDATION_MAX_OUTPUT_TOKENS = 512;
function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function contextFor(id: string, operation: AiFunction) {
  const config = await readConfig();
  const provider = config.providers.find((p) => p.id === id);
  if (!provider) throw new AppError("NOT_FOUND", "Provider not found.", 404);
  const credentialRevision = provider.credentialRef
    ? ((await credentialStatus())[provider.credentialRef]?.revision ?? null)
    : null;
  const selection = resolveTaskModel(config, operation, id)!;
  const policy = {
    ...config.network,
    paidAiEnabled: config.ai.paidAiEnabled,
    paperAllowsExternal: true,
    localProviderIsolationVerified: provider.localIsolationVerified,
  };
  const discoveryFingerprint = digest({
    version: 1,
    verificationRevision: config.verificationRevision,
    id: provider.id,
    adapterId: provider.adapterId,
    endpoint: provider.endpoint,
    credentialRef: provider.credentialRef,
    credentialRevision,
  });
  const fingerprint = digest({
    version: 1,
    verificationRevision: config.verificationRevision,
    provider,
    selection,
    policy,
    monthlyBudgetUsd: config.ai.monthlyBudgetUsd,
    credentialRevision,
  });
  return {
    config,
    provider,
    selection,
    policy,
    credentialRevision,
    discoveryFingerprint,
    fingerprint,
  };
}
type Context = Awaited<ReturnType<typeof contextFor>>;

function stateFrom(
  ctx: Context,
  operation: AiFunction,
  reports: { metadata?: ValidationReport; inference?: ValidationReport },
): ProviderValidationState {
  return {
    providerId: ctx.provider.id,
    function: operation,
    fingerprint: ctx.fingerprint,
    metadata:
      reports.metadata?.fingerprint === ctx.fingerprint
        ? reports.metadata
        : null,
    inference:
      reports.inference?.fingerprint === ctx.fingerprint
        ? reports.inference
        : null,
    stale: Object.values(reports).some(
      (r) => r.fingerprint !== ctx.fingerprint,
    ),
  };
}
export async function getProviderValidation(
  id: string,
  operation: AiFunction = "summary",
) {
  const ctx = await contextFor(id, operation);
  return stateFrom(
    ctx,
    operation,
    (await readProviderEvidence(id)).reports[operation],
  );
}
export async function getProviderModels(
  id: string,
): Promise<ProviderModelCatalog> {
  const ctx = await contextFor(id, "summary");
  const discovery = (await readProviderEvidence(id)).discovery;
  const current =
    discovery?.fingerprint === ctx.discoveryFingerprint ? discovery : undefined;
  const configuredIds = [
    ctx.provider.modelId,
    ctx.provider.embeddingModelId,
    ...Object.entries(ctx.config.ai.taskModels).flatMap(
      ([operation, selection]) =>
        ctx.config.ai.defaults[operation as AiFunction] === id && selection
          ? [selection.modelId]
          : [],
    ),
  ];
  return {
    providerId: id,
    fingerprint: ctx.discoveryFingerprint,
    discoveredAt: current?.discoveredAt ?? null,
    stale: !!discovery && !current,
    models: modelChoices(
      ctx.provider.adapterId,
      current?.models,
      configuredIds,
    ),
  };
}

async function adapterFor(
  ctx: Context,
  operation: AiFunction,
  transport: FetchImplementation,
  onInference?: () => void,
  model?: ModelInfo,
) {
  assertProviderCallAllowed(ctx.policy, ctx.provider, "listModels");
  const credential = ctx.provider.credentialRef
    ? await readCredential(ctx.provider.credentialRef, ctx.credentialRevision)
    : undefined;
  if (
    getProviderDefinition(ctx.provider.adapterId).credentialRequired &&
    !credential
  )
    throw new AppError(
      "CREDENTIAL_REQUIRED",
      "Configure the selected provider credential.",
      422,
    );
  const {
    id: providerInstanceId,
    localIsolationVerified: _,
    ...fields
  } = ctx.provider;
  let dispatched = false;
  const guardedFetch: FetchImplementation = async (url, init) => {
    const current = await contextFor(ctx.provider.id, operation);
    if (current.fingerprint !== ctx.fingerprint)
      throw new AppError(
        "INPUT_STALE",
        "Provider configuration or credential changed; verify again.",
        409,
      );
    const pathname = new URL(
      typeof url === "string" ? url : url instanceof URL ? url.href : url.url,
    ).pathname;
    const inference =
      /\/(responses|chat\/completions|messages|embeddings)$/.test(pathname);
    assertProviderCallAllowed(
      current.policy,
      current.provider,
      inference
        ? operation === "embedding"
          ? "embedding"
          : "chat"
        : "inspectModel",
      model,
    );
    if (inference) {
      if (!onInference || dispatched)
        throw new AppError(
          "VALIDATION_RETRY_BLOCKED",
          "A validation action permits only one inference request.",
          409,
        );
      if (
        getProviderDefinition(current.provider.adapterId).billingClass ===
          "paid" &&
        current.config.ai.monthlyBudgetUsd !== null
      )
        throw new AppError(
          "PRICE_REQUIRED",
          "A configured monetary budget requires verified pricing before inference validation.",
          429,
        );
      dispatched = true;
      onInference();
    }
    return transport(url, init);
  };
  return {
    adapter: createProviderAdapter(
      {
        ...fields,
        providerInstanceId,
        reasoningEffort: ctx.selection.reasoningEffort,
        modelId: fields.modelId || undefined,
        modelRevision: fields.modelRevision || undefined,
        embeddingModelId: fields.embeddingModelId || undefined,
      },
      { fetch: guardedFetch },
    ),
    credential,
  };
}

async function discover(
  ctx: Context,
  operation: AiFunction,
  transport: FetchImplementation,
) {
  const { adapter, credential } = await adapterFor(ctx, operation, transport);
  const callContext = { credential, signal: AbortSignal.timeout(15000) };
  const models = await adapter.listModels(callContext);
  if (ctx.provider.adapterId === "ollama") {
    // Native /api/show reads only metadata; this never loads/downloads a model.
    const selected = models.findIndex((m) => m.id === ctx.selection.modelId);
    const indexes = [
      ...new Set([
        ...(selected >= 0 ? [selected] : []),
        ...models.slice(0, 32).map((_, i) => i),
      ]),
    ];
    for (const index of indexes)
      models[index] = await adapter.inspectModel(
        models[index]!.id,
        callContext,
      );
  }
  const current = await contextFor(ctx.provider.id, operation);
  if (current.fingerprint !== ctx.fingerprint)
    throw new AppError(
      "INPUT_STALE",
      "Provider configuration changed during discovery.",
      409,
    );
  const safeModels = models
    .filter((m) => !credential || !m.id.includes(credential))
    .map(({ details: _, ...model }) => ({
      ...model,
      displayName:
        credential && model.displayName?.includes(credential)
          ? undefined
          : model.displayName,
      revision:
        credential && model.revision?.includes(credential)
          ? undefined
          : model.revision,
    }));
  await updateProviderEvidence(ctx.provider.id, (previous) => ({
    ...previous,
    discovery: {
      fingerprint: ctx.discoveryFingerprint,
      discoveredAt: new Date().toISOString(),
      models: safeModels,
    },
  }));
  return safeModels;
}
export async function refreshProviderModels(
  id: string,
  transport: FetchImplementation = fetch,
) {
  await discover(await contextFor(id, "summary"), "summary", transport);
  return getProviderModels(id);
}
function safeUsage(
  usage: NormalizedUsage | undefined,
): ValidationReport["usage"] {
  if (!usage) return undefined;
  const result: NonNullable<ValidationReport["usage"]> = {};
  for (const key of [
    "inputTokens",
    "outputTokens",
    "totalTokens",
    "reasoningTokens",
    "cacheReadTokens",
  ] as const) {
    const value = usage[key];
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
      result[key] = value;
  }
  return result;
}
function safeRequestId(
  value: string | undefined,
  credential: string | undefined,
) {
  return value &&
    /^[a-zA-Z0-9_-]{1,200}$/.test(value) &&
    (!credential || !value.includes(credential))
    ? value
    : undefined;
}
function failure(
  error: unknown,
  attempted: boolean,
): Pick<ValidationReport, "code" | "message" | "status"> {
  if (error instanceof ProviderError && error.cause instanceof AppError)
    error = error.cause;
  const code =
    error instanceof AppError || error instanceof ProviderError
      ? error.code
      : "VERIFICATION_FAILED";
  const blocked = [
    "POLICY_BLOCKED",
    "PROVIDER_DISABLED",
    "CREDENTIAL_REQUIRED",
    "PAID_CONFIRMATION_REQUIRED",
    "METADATA_REQUIRED",
    "INPUT_STALE",
    "CAPABILITY_UNSUPPORTED",
    "MODEL_LOCALITY_UNVERIFIED",
    "CLOUD_MODEL_BLOCKED",
    "PRICE_REQUIRED",
  ].includes(code);
  const diagnostic = providerFailureDiagnostic(code);
  return {
    code,
    status: attempted ? "incomplete" : blocked ? "blocked" : "failed",
    message: diagnostic
      ? `${diagnostic.message}${attempted ? " Usage may have been incurred." : ""}`
      : blocked
        ? (error as Error).message
        : attempted
          ? "The bounded inference did not complete successfully; usage may have been incurred."
          : "Provider metadata verification failed; inspect credentials, endpoint and model access.",
  };
}

export async function validateProvider(
  id: string,
  input: unknown,
  transport: FetchImplementation = fetch,
): Promise<ProviderValidationState> {
  const parsed = validationInputSchema.safeParse(input);
  if (!parsed.success)
    throw new AppError(
      "VALIDATION_ERROR",
      "Invalid provider validation request.",
      422,
    );
  const action = parsed.data;
  const ctx = await contextFor(id, action.function);
  const evidence = await readProviderEvidence(id);
  const report: ValidationReport = {
    id: randomUUID(),
    stage: action.stage,
    function: action.function,
    fingerprint: ctx.fingerprint,
    checkedAt: new Date().toISOString(),
    status: "blocked",
    modelId: ctx.selection.modelId,
    reasoningEffort: ctx.selection.reasoningEffort,
    inferencePerformed: false,
    code: "NOT_VERIFIED",
    message: "Verification has not completed.",
  };
  try {
    if (!ctx.selection.modelId)
      throw new AppError(
        "CAPABILITY_UNSUPPORTED",
        "Select a model for this function before verification.",
        422,
      );
    if (action.stage === "metadata") {
      const inventory = await discover(ctx, action.function, transport);
      assertModelSelection(
        ctx.provider.adapterId,
        ctx.selection.modelId,
        action.function,
        ctx.selection.reasoningEffort,
        inventory,
      );
      Object.assign(report, {
        status: "passed",
        code: "METADATA_VERIFIED",
        message:
          "Configuration, policy, credential, model availability and supported profile verified; inference was not performed.",
      });
    } else {
      const metadata = evidence.reports[action.function].metadata;
      if (
        action.expectedFingerprint !== ctx.fingerprint ||
        metadata?.fingerprint !== ctx.fingerprint ||
        metadata.status !== "passed"
      )
        throw new AppError(
          "METADATA_REQUIRED",
          "Run metadata verification for the current saved configuration first.",
          409,
        );
      if (
        getProviderDefinition(ctx.provider.adapterId).billingClass === "paid" &&
        !action.confirmPaid
      )
        throw new AppError(
          "PAID_CONFIRMATION_REQUIRED",
          "Explicit confirmation is required for this billable synthetic inference.",
          422,
        );
      if (
        getProviderDefinition(ctx.provider.adapterId).billingClass === "paid" &&
        ctx.config.ai.monthlyBudgetUsd !== null
      )
        throw new AppError(
          "PRICE_REQUIRED",
          "A configured monetary budget requires verified pricing before inference validation.",
          429,
        );
      const inventory =
        evidence.discovery?.fingerprint === ctx.discoveryFingerprint
          ? evidence.discovery.models
          : undefined;
      assertModelSelection(
        ctx.provider.adapterId,
        ctx.selection.modelId,
        action.function,
        ctx.selection.reasoningEffort,
        inventory,
      );
      const model = inventory?.find((m) => m.id === ctx.selection.modelId);
      assertProviderCallAllowed(
        ctx.policy,
        ctx.provider,
        action.function === "embedding" ? "embedding" : "chat",
        model,
      );
      const { adapter, credential } = await adapterFor(
        ctx,
        action.function,
        transport,
        () => {
          report.inferencePerformed = true;
        },
        model,
      );
      const context = { credential, signal: AbortSignal.timeout(45000) };
      const requestIdentity = {
        logicalCallId: report.id,
        attempt: 1,
        idempotencyKey: report.id,
      };
      report.maxOutputTokens = VALIDATION_MAX_OUTPUT_TOKENS;
      if (ctx.provider.adapterId === "openai") report.serviceTier = "default";
      if (action.function === "embedding") {
        if (!adapter.embed)
          throw new AppError(
            "CAPABILITY_UNSUPPORTED",
            "This adapter does not support embeddings.",
            422,
          );
        const result = await adapter.embed(
          {
            modelId: ctx.selection.modelId,
            input: "Synthetic setup verification.",
            requestIdentity,
          },
          context,
        );
        report.usage = safeUsage(result.usage);
        report.providerRequestId = safeRequestId(
          result.providerRequestId,
          credential,
        );
        if (
          result.vectors.length !== 1 ||
          !result.vectors[0]?.length ||
          !result.vectors[0].every(Number.isFinite)
        )
          throw new AppError(
            "INVALID_UPSTREAM_RESPONSE",
            "The embedding validation returned no valid vector.",
            502,
          );
      } else {
        let complete = false;
        for await (const event of adapter.chat(
          {
            modelId: ctx.selection.modelId,
            reasoningEffort: ctx.selection.reasoningEffort,
            maxOutputTokens: VALIDATION_MAX_OUTPUT_TOKENS,
            serviceTier:
              ctx.provider.adapterId === "openai" ? "default" : undefined,
            messages: [
              {
                role: "user",
                content:
                  "Reply with exactly OK. This is a synthetic setup check.",
              },
            ],
            requestIdentity,
          },
          context,
        )) {
          report.providerRequestId =
            safeRequestId(event.providerRequestId, credential) ??
            report.providerRequestId;
          if (event.type === "usage") report.usage = safeUsage(event.usage);
          if (event.type === "final") {
            report.usage = safeUsage(event.usage) ?? report.usage;
            complete = event.text.trim() === "OK";
          }
          if (event.type === "error") throw event.error;
          if (event.type === "abort")
            throw new AppError(
              "INCOMPLETE_STREAM",
              "The validation request was interrupted.",
              502,
            );
        }
        if (!complete)
          throw new AppError(
            "INCOMPLETE_STREAM",
            "The synthetic validation did not return its expected completed output.",
            502,
          );
      }
      Object.assign(report, {
        status: "passed",
        code: "INFERENCE_VERIFIED",
        message:
          "The explicitly requested bounded synthetic inference completed successfully.",
      });
    }
  } catch (error) {
    Object.assign(report, failure(error, report.inferencePerformed));
  }
  // Request IDs are the sole retained upstream strings, and must not echo the key.
  if (
    report.providerRequestId &&
    !/^[a-zA-Z0-9_-]{1,200}$/.test(report.providerRequestId)
  )
    delete report.providerRequestId;
  await updateProviderEvidence(id, (previous) => ({
    ...previous,
    reports: {
      ...previous.reports,
      [action.function]: {
        ...previous.reports[action.function],
        [action.stage]: report,
      },
    },
  }));
  return getProviderValidation(id, action.function);
}
