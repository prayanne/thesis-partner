import { ProviderError, isAbortError } from "./errors";
import { assertModelSelection } from "./model-profiles";
import {
  appendPath,
  fetchChecked,
  jsonHeaders,
  nativeRoot,
  readJson,
} from "./http";
import { isKnownCloudModel } from "./policy";
import {
  normalizeOpenAiUsage,
  safeDetails,
  unknownModelCapabilities,
} from "./model-utils";
import { getProviderDefinition } from "./registry";
import { parseSse } from "./sse";
import type {
  AiAdapterId,
  FetchImplementation,
  ModelInfo,
  NormalizedUsage,
  ProviderAdapter,
  ProviderCallContext,
  ProviderConfig,
  ProviderStreamEvent,
} from "./types";

type LocalAdapterId = Extract<AiAdapterId, "ollama" | "lmstudio">;

export class OpenAiCompatibleAdapter implements ProviderAdapter {
  readonly definition;

  constructor(
    readonly config: Readonly<ProviderConfig>,
    private readonly fetch: FetchImplementation,
  ) {
    if (config.adapterId !== "ollama" && config.adapterId !== "lmstudio")
      throw new ProviderError({
        code: "INVALID_CONFIG",
        message: "OpenAI-compatible adapter requires a local provider.",
      });
    this.definition = getProviderDefinition(config.adapterId);
  }

  private get adapterId(): LocalAdapterId {
    return this.config.adapterId as LocalAdapterId;
  }

  private headers(context: ProviderCallContext): Headers {
    return jsonHeaders(context.credential);
  }

  async listModels(context: ProviderCallContext): Promise<ModelInfo[]> {
    if (this.adapterId === "ollama") {
      const response = await fetchChecked({
        fetch: this.fetch,
        adapterId: this.adapterId,
        url: appendPath(nativeRoot(this.config.endpoint), "api/tags"),
        init: { headers: this.headers(context) },
        context,
      });
      const value = await readJson(response, this.adapterId);
      const models = Array.isArray(value.models) ? value.models : [];
      return models.flatMap((entry): ModelInfo[] => {
        if (!entry || typeof entry !== "object") return [];
        const object = entry as Record<string, unknown>;
        const modelId =
          typeof object.model === "string"
            ? object.model
            : typeof object.name === "string"
              ? object.name
              : undefined;
        if (!modelId) return [];
        const cloud = isKnownCloudModel("ollama", modelId);
        return [
          {
            id: modelId,
            revision:
              typeof object.digest === "string" ? object.digest : undefined,
            executionLocation: cloud ? "remote" : "local",
            localOnlyEligible: !cloud,
            capabilities: unknownModelCapabilities(),
            capabilitySource: "unknown",
            details: safeDetails(object),
          },
        ];
      });
    }

    const response = await fetchChecked({
      fetch: this.fetch,
      adapterId: this.adapterId,
      url: appendPath(nativeRoot(this.config.endpoint), "api/v1/models"),
      init: { headers: this.headers(context) },
      context,
    });
    const value = await readJson(response, this.adapterId);
    const models = Array.isArray(value.models) ? value.models : [];
    return models.flatMap((entry): ModelInfo[] => {
      if (!entry || typeof entry !== "object") return [];
      const object = entry as Record<string, unknown>;
      if (
        typeof object.key !== "string" ||
        (object.type !== "llm" && object.type !== "embedding")
      )
        return [];
      const type = object.type;
      const nativeCapabilities =
        object.capabilities && typeof object.capabilities === "object"
          ? (object.capabilities as Record<string, unknown>)
          : undefined;
      return [
        {
          id: object.key,
          displayName:
            typeof object.display_name === "string"
              ? object.display_name
              : undefined,
          revision: this.config.modelRevision,
          executionLocation: "local",
          localOnlyEligible: true,
          capabilities: unknownModelCapabilities({
            chat: type === "llm" ? "supported" : "unsupported",
            embedding: type === "embedding" ? "supported" : "unsupported",
            streaming: type === "llm" ? "supported" : "unsupported",
            vision:
              type === "llm"
                ? nativeCapabilities?.vision === true
                  ? "supported"
                  : nativeCapabilities?.vision === false
                    ? "unsupported"
                    : "unknown"
                : "unsupported",
            toolUse:
              type === "llm"
                ? nativeCapabilities?.trained_for_tool_use === true
                  ? "supported"
                  : nativeCapabilities?.trained_for_tool_use === false
                    ? "unsupported"
                    : "unknown"
                : "unsupported",
          }),
          capabilitySource: "native",
          details: safeDetails(object),
        },
      ];
    });
  }

  async inspectModel(
    modelId: string,
    context: ProviderCallContext,
  ): Promise<ModelInfo> {
    if (this.adapterId === "ollama") {
      const response = await fetchChecked({
        fetch: this.fetch,
        adapterId: this.adapterId,
        url: appendPath(nativeRoot(this.config.endpoint), "api/show"),
        init: {
          method: "POST",
          headers: this.headers(context),
          body: JSON.stringify({ model: modelId }),
        },
        context,
      });
      const value = await readJson(response, this.adapterId);
      const capabilities = Array.isArray(value.capabilities)
        ? value.capabilities.filter(
            (item): item is string => typeof item === "string",
          )
        : [];
      const cloud = isKnownCloudModel("ollama", modelId);
      return {
        id: modelId,
        revision:
          typeof value.digest === "string"
            ? value.digest
            : this.config.modelRevision,
        executionLocation: cloud ? "remote" : "local",
        localOnlyEligible: !cloud,
        capabilities: unknownModelCapabilities({
          chat: capabilities.includes("completion") ? "supported" : "unknown",
          embedding: capabilities.includes("embedding")
            ? "supported"
            : "unknown",
          streaming: capabilities.includes("completion")
            ? "supported"
            : "unknown",
          vision: capabilities.includes("vision") ? "supported" : "unknown",
          toolUse: capabilities.includes("tools") ? "supported" : "unknown",
        }),
        capabilitySource: capabilities.length ? "native" : "unknown",
        details: safeDetails(value),
      };
    }
    const model = (await this.listModels(context)).find(
      (candidate) => candidate.id === modelId,
    );
    if (!model)
      throw new ProviderError({
        code: "INVALID_UPSTREAM_RESPONSE",
        adapterId: this.adapterId,
        message: "LM Studio model was not found in native model inventory.",
      });
    return model;
  }

  async *chat(
    request: Parameters<ProviderAdapter["chat"]>[0],
    context: ProviderCallContext,
  ): AsyncIterable<ProviderStreamEvent> {
    let providerRequestId: string | undefined;
    let text = "";
    let usage: NormalizedUsage | undefined;
    let sawFinishReason = false;
    try {
      assertModelSelection(
        this.adapterId,
        request.modelId,
        "chat",
        request.reasoningEffort ?? this.config.reasoningEffort,
        undefined,
        false,
      );
      const body: Record<string, unknown> = {
        model: request.modelId,
        messages: request.messages,
        max_tokens: request.maxOutputTokens,
        stream: true,
        stream_options: { include_usage: true },
      };
      if (request.temperature !== undefined)
        body.temperature = request.temperature;
      const headers = this.headers(context);
      headers.set("Idempotency-Key", request.requestIdentity.idempotencyKey);
      headers.set("Accept", "text/event-stream");
      const response = await fetchChecked({
        fetch: this.fetch,
        adapterId: this.adapterId,
        url: appendPath(this.config.endpoint, "chat/completions"),
        init: { method: "POST", headers, body: JSON.stringify(body) },
        context,
        requestIdentity: request.requestIdentity,
      });
      providerRequestId = response.headers.get("x-request-id") ?? undefined;
      if (!response.body)
        throw new ProviderError({
          code: "INVALID_UPSTREAM_RESPONSE",
          adapterId: this.adapterId,
          message: "Local provider returned an empty stream.",
          requestIdentity: request.requestIdentity,
          providerRequestId,
        });
      for await (const message of parseSse(response.body, context.signal)) {
        if (message.data === "[DONE]") {
          if (!sawFinishReason) {
            yield {
              type: "error",
              complete: false,
              requestIdentity: request.requestIdentity,
              providerRequestId,
              error: new ProviderError({
                code: "INCOMPLETE_STREAM",
                adapterId: this.adapterId,
                message: "Local provider ended before a finish reason.",
                requestIdentity: request.requestIdentity,
                providerRequestId,
              }),
            };
            return;
          }
          if (usage)
            yield {
              type: "usage",
              usage,
              requestIdentity: request.requestIdentity,
              providerRequestId,
            };
          yield {
            type: "final",
            text,
            usage,
            complete: true,
            requestIdentity: request.requestIdentity,
            providerRequestId,
          };
          return;
        }
        if (!message.data) continue;
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(message.data) as Record<string, unknown>;
        } catch {
          throw new ProviderError({
            code: "UPSTREAM_STREAM_ERROR",
            adapterId: this.adapterId,
            message: "Local provider returned malformed stream data.",
            requestIdentity: request.requestIdentity,
            providerRequestId,
          });
        }
        if (event.error) {
          if (usage)
            yield {
              type: "usage",
              usage,
              requestIdentity: request.requestIdentity,
              providerRequestId,
            };
          yield {
            type: "error",
            complete: false,
            requestIdentity: request.requestIdentity,
            providerRequestId,
            error: new ProviderError({
              code: "UPSTREAM_STREAM_ERROR",
              adapterId: this.adapterId,
              message: "Local provider reported a stream error.",
              requestIdentity: request.requestIdentity,
              providerRequestId,
            }),
          };
          return;
        }
        providerRequestId ??=
          typeof event.id === "string" ? event.id : undefined;
        usage = normalizeOpenAiUsage(event.usage) ?? usage;
        const choices = Array.isArray(event.choices) ? event.choices : [];
        for (const choice of choices) {
          if (!choice || typeof choice !== "object") continue;
          const object = choice as Record<string, unknown>;
          if (typeof object.finish_reason === "string") sawFinishReason = true;
          const delta =
            object.delta && typeof object.delta === "object"
              ? (object.delta as Record<string, unknown>)
              : undefined;
          if (typeof delta?.content === "string") {
            text += delta.content;
            yield {
              type: "text",
              delta: delta.content,
              requestIdentity: request.requestIdentity,
              providerRequestId,
            };
          }
        }
      }
      yield {
        type: "error",
        complete: false,
        requestIdentity: request.requestIdentity,
        providerRequestId,
        error: new ProviderError({
          code: "INCOMPLETE_STREAM",
          adapterId: this.adapterId,
          message: "Local provider stream ended before [DONE].",
          requestIdentity: request.requestIdentity,
          providerRequestId,
        }),
      };
    } catch (error) {
      if (isAbortError(error) || context.signal?.aborted) {
        if (usage)
          yield {
            type: "usage",
            usage,
            requestIdentity: request.requestIdentity,
            providerRequestId,
          };
        yield {
          type: "abort",
          complete: false,
          requestIdentity: request.requestIdentity,
          providerRequestId,
        };
        return;
      }
      if (usage)
        yield {
          type: "usage",
          usage,
          requestIdentity: request.requestIdentity,
          providerRequestId,
        };
      const providerError =
        error instanceof ProviderError
          ? error
          : new ProviderError({
              code: "UPSTREAM_STREAM_ERROR",
              adapterId: this.adapterId,
              message: "Local provider stream failed.",
              requestIdentity: request.requestIdentity,
              providerRequestId,
              cause: error,
            });
      yield {
        type: "error",
        error: providerError,
        complete: false,
        requestIdentity: request.requestIdentity,
        providerRequestId,
      };
    }
  }

  embed = async (
    request: Parameters<NonNullable<ProviderAdapter["embed"]>>[0],
    context: ProviderCallContext,
  ) => {
    const headers = this.headers(context);
    headers.set("Idempotency-Key", request.requestIdentity.idempotencyKey);
    const response = await fetchChecked({
      fetch: this.fetch,
      adapterId: this.adapterId,
      url: appendPath(this.config.endpoint, "embeddings"),
      init: {
        method: "POST",
        headers,
        body: JSON.stringify({ model: request.modelId, input: request.input }),
      },
      context,
      requestIdentity: request.requestIdentity,
    });
    const value = await readJson(response, this.adapterId);
    const data = Array.isArray(value.data) ? value.data : [];
    const vectors = data.map((entry) =>
      entry &&
      typeof entry === "object" &&
      Array.isArray((entry as Record<string, unknown>).embedding)
        ? (entry as Record<string, unknown>).embedding
        : null,
    );
    if (
      vectors.some(
        (vector) =>
          !vector ||
          !(vector as unknown[]).every((number) => typeof number === "number"),
      )
    )
      throw new ProviderError({
        code: "INVALID_UPSTREAM_RESPONSE",
        adapterId: this.adapterId,
        message: "Local provider returned invalid embeddings.",
        requestIdentity: request.requestIdentity,
      });
    return {
      vectors: vectors as number[][],
      usage: normalizeOpenAiUsage(value.usage),
      requestIdentity: request.requestIdentity,
      providerRequestId: response.headers.get("x-request-id") ?? undefined,
      complete: true as const,
    };
  };

  async testConnection(context: ProviderCallContext) {
    const models = await this.listModels(context);
    return {
      ok: true as const,
      modelCount: models.length,
      verification: "network" as const,
    };
  }
}
