import { ProviderError, isAbortError } from "./errors";
import {
  appendPath,
  fetchChecked,
  jsonHeaders,
  readJson,
  requireCredential,
} from "./http";
import {
  normalizeOpenAiUsage,
  parseOpenAiModelList,
  safeDetails,
  unknownModelCapabilities,
} from "./model-utils";
import { getProviderDefinition } from "./registry";
import { parseSse } from "./sse";
import type {
  FetchImplementation,
  ModelInfo,
  NormalizedUsage,
  ProviderAdapter,
  ProviderCallContext,
  ProviderConfig,
  ProviderStreamEvent,
} from "./types";

export class OpenAiResponsesAdapter implements ProviderAdapter {
  readonly definition = getProviderDefinition("openai");

  constructor(
    readonly config: Readonly<ProviderConfig>,
    private readonly fetch: FetchImplementation,
  ) {}

  async listModels(context: ProviderCallContext): Promise<ModelInfo[]> {
    requireCredential("openai", context);
    const response = await fetchChecked({
      fetch: this.fetch,
      adapterId: "openai",
      url: appendPath(this.config.endpoint, "models"),
      init: { headers: jsonHeaders(context.credential) },
      context,
    });
    return parseOpenAiModelList(await readJson(response, "openai"), "remote");
  }

  async inspectModel(
    modelId: string,
    context: ProviderCallContext,
  ): Promise<ModelInfo> {
    requireCredential("openai", context);
    const response = await fetchChecked({
      fetch: this.fetch,
      adapterId: "openai",
      url: appendPath(
        this.config.endpoint,
        `models/${encodeURIComponent(modelId)}`,
      ),
      init: { headers: jsonHeaders(context.credential) },
      context,
    });
    const value = await readJson(response, "openai");
    if (typeof value.id !== "string")
      throw new ProviderError({
        code: "INVALID_UPSTREAM_RESPONSE",
        adapterId: "openai",
        message: "OpenAI returned an invalid model response.",
      });
    return {
      id: value.id,
      executionLocation: "remote",
      localOnlyEligible: false,
      capabilities: unknownModelCapabilities(),
      capabilitySource: "unknown",
      details: safeDetails(value),
    };
  }

  async *chat(
    request: Parameters<ProviderAdapter["chat"]>[0],
    context: ProviderCallContext,
  ): AsyncIterable<ProviderStreamEvent> {
    let providerRequestId: string | undefined;
    let text = "";
    let usage: NormalizedUsage | undefined;
    try {
      requireCredential("openai", context);
      const system = request.messages
        .filter((message) => message.role === "system")
        .map((message) => message.content)
        .join("\n\n");
      const input = request.messages
        .filter((message) => message.role !== "system")
        .map((message) => ({ role: message.role, content: message.content }));
      const body: Record<string, unknown> = {
        model: request.modelId,
        input,
        max_output_tokens: request.maxOutputTokens,
        stream: true,
        store: false,
      };
      if (system) body.instructions = system;
      if (request.temperature !== undefined)
        body.temperature = request.temperature;
      const headers = jsonHeaders(context.credential);
      headers.set("Idempotency-Key", request.requestIdentity.idempotencyKey);
      headers.set("Accept", "text/event-stream");
      const response = await fetchChecked({
        fetch: this.fetch,
        adapterId: "openai",
        url: appendPath(this.config.endpoint, "responses"),
        init: { method: "POST", headers, body: JSON.stringify(body) },
        context,
        requestIdentity: request.requestIdentity,
      });
      providerRequestId = response.headers.get("x-request-id") ?? undefined;
      if (!response.body)
        throw new ProviderError({
          code: "INVALID_UPSTREAM_RESPONSE",
          adapterId: "openai",
          message: "OpenAI returned an empty stream.",
          requestIdentity: request.requestIdentity,
          providerRequestId,
        });
      for await (const message of parseSse(response.body, context.signal)) {
        if (!message.data || message.data === "[DONE]") continue;
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(message.data) as Record<string, unknown>;
        } catch {
          throw new ProviderError({
            code: "UPSTREAM_STREAM_ERROR",
            adapterId: "openai",
            message: "OpenAI returned malformed stream data.",
            requestIdentity: request.requestIdentity,
            providerRequestId,
          });
        }
        const type =
          typeof event.type === "string" ? event.type : message.event;
        if (
          type === "response.output_text.delta" &&
          typeof event.delta === "string"
        ) {
          text += event.delta;
          yield {
            type: "text",
            delta: event.delta,
            requestIdentity: request.requestIdentity,
            providerRequestId,
          };
        } else if (type === "response.completed") {
          const completed =
            event.response && typeof event.response === "object"
              ? (event.response as Record<string, unknown>)
              : undefined;
          providerRequestId ??=
            completed && typeof completed.id === "string"
              ? completed.id
              : undefined;
          usage = normalizeOpenAiUsage(completed?.usage);
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
        } else if (
          type === "error" ||
          type === "response.failed" ||
          type === "response.incomplete"
        ) {
          const failed =
            event.response && typeof event.response === "object"
              ? (event.response as Record<string, unknown>)
              : undefined;
          usage = normalizeOpenAiUsage(failed?.usage) ?? usage;
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
              adapterId: "openai",
              message: "OpenAI did not complete the response stream.",
              requestIdentity: request.requestIdentity,
              providerRequestId,
            }),
          };
          return;
        }
      }
      yield {
        type: "error",
        complete: false,
        requestIdentity: request.requestIdentity,
        providerRequestId,
        error: new ProviderError({
          code: "INCOMPLETE_STREAM",
          adapterId: "openai",
          message: "OpenAI stream ended before completion.",
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
              adapterId: "openai",
              message: "OpenAI stream failed.",
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
    requireCredential("openai", context);
    const headers = jsonHeaders(context.credential);
    headers.set("Idempotency-Key", request.requestIdentity.idempotencyKey);
    const response = await fetchChecked({
      fetch: this.fetch,
      adapterId: "openai",
      url: appendPath(this.config.endpoint, "embeddings"),
      init: {
        method: "POST",
        headers,
        body: JSON.stringify({ model: request.modelId, input: request.input }),
      },
      context,
      requestIdentity: request.requestIdentity,
    });
    const value = await readJson(response, "openai");
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
        adapterId: "openai",
        message: "OpenAI returned invalid embeddings.",
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
