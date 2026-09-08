import {
  assertProviderCallAllowed,
  createProviderAdapter,
  ProviderError,
} from "@thesis/providers";
import {
  AppError,
  errorResponse,
  readConfig,
  readCredential,
  requireSession,
} from "@thesis/security";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireSession(request);
    const config = await readConfig();
    const { id } = await context.params;
    const provider = config.providers.find((p) => p.id === id);
    if (!provider)
      throw new AppError("NOT_FOUND", "Provider configuration not found.", 404);
    assertProviderCallAllowed(
      {
        ...config.network,
        paidAiEnabled: config.ai.paidAiEnabled,
        paperAllowsExternal: true,
      },
      provider,
      "testConnection",
    );
    const {
      id: providerInstanceId,
      localIsolationVerified: _,
      ...fields
    } = provider;
    const adapter = createProviderAdapter(
      {
        ...fields,
        providerInstanceId,
        modelId: provider.modelId || undefined,
        modelRevision: provider.modelRevision || undefined,
        embeddingModelId: provider.embeddingModelId || undefined,
      },
      { fetch },
    );
    const credential = provider.credentialRef
      ? await readCredential(provider.credentialRef)
      : undefined;
    const result = await adapter.testConnection({
      credential,
      signal: AbortSignal.timeout(10000),
    });
    return Response.json(
      {
        data: {
          ...result,
          testType: "metadata-only",
          inferencePerformed: false,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    if (e instanceof ProviderError)
      return errorResponse(
        new AppError(
          e.code,
          e.message,
          e.code === "POLICY_BLOCKED" || e.code === "PROVIDER_DISABLED"
            ? 403
            : 502,
        ),
      );
    return errorResponse(e);
  }
}
