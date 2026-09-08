import { ProviderError, isAbortError } from "./errors";
import {
  appendPath,
  fetchChecked,
  jsonHeaders,
  readJson,
  requireCredential,
} from "./http";
import {
  mergeUsage,
  normalizeAnthropicUsage,
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

export class AnthropicMessagesAdapter implements ProviderAdapter {
  readonly definition = getProviderDefinition("anthropic");

  constructor(
    readonly config: Readonly<ProviderConfig>,
    private readonly fetch: FetchImplementation,
  ) {}

  async listModels(context: ProviderCallContext): Promise<ModelInfo[]> {
    requireCredential("anthropic", context);
    const response = await fetchChecked({
      fetch: this.fetch,
      adapterId: "anthropic",
      url: appendPath(this.config.endpoint, "models"),
      init: { headers: jsonHeaders(context.credential, "anthropic") },
      context,
    });
    const value = await readJson(response, "anthropic");
    const data = Array.isArray(value.data) ? value.data : [];
    return data.flatMap((entry): ModelInfo[] => {
      if (
        !entry ||
        typeof entry !== "object" ||
        typeof (entry as Record<string, unknown>).id !== "string"
      )
        return [];
      const object = entry as Record<string, unknown>;
      return [
        {
          id: object.id as string,
          displayName:
            typeof object.display_name === "string"
              ? object.display_name
              : undefined,
          executionLocation: "remote",
          localOnlyEligible: false,
          capabilities: unknownModelCapabilities({
            chat: "supported",
            embedding: "unsupported",
            streaming: "supported",
          }),
          capabilitySource: "provider",
          details: safeDetails(object),
        },
      ];
    });
  }

  async inspectModel(
    modelId: string,
    context: ProviderCallContext,
  ): Promise<ModelInfo> {
    requireCredential("anthropic", context);
    const response = await fetchChecked({
      fetch: this.fetch,
      adapterId: "anthropic",
      url: appendPath(
        this.config.endpoint,
        `models/${encodeURIComponent(modelId)}`,
      ),
      init: { headers: jsonHeaders(context.credential, "anthropic") },
      context,
    });
    const value = await readJson(response, "anthropic");
    if (typeof value.id !== "string")
      throw new ProviderError({
        code: "INVALID_UPSTREAM_RESPONSE",
        adapterId: "anthropic",
        message: "Anthropic returned an invalid model response.",
      });
    return {
      id: value.id,
      displayName:
        typeof value.display_name === "string" ? value.display_name : undefined,
      executionLocation: "remote",
      localOnlyEligible: false,
      capabilities: unknownModelCapabilities({
        chat: "supported",
        embedding: "unsupported",
        streaming: "supported",
      }),
      capabilitySource: "provider",
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
      requireCredential("anthropic", context);
      const system = request.messages
        .filter((message) => message.role === "system")
        .map((message) => message.content)
        .join("\n\n");
      const messages = request.messages
        .filter((message) => message.role !== "system")
        .map((message) => ({ role: message.role, content: message.content }));
      const body: Record<string, unknown> = {
        model: request.modelId,
        max_tokens: request.maxOutputTokens,
        messages,
        stream: true,
      };
      if (system) body.system = system;
      // Temperature is intentionally omitted: current models may reject it.
      const headers = jsonHeaders(context.credential, "anthropic");
      headers.set("Accept", "text/event-stream");
      const response = await fetchChecked({
        fetch: this.fetch,
        adapterId: "anthropic",
        url: appendPath(this.config.endpoint, "messages"),
        init: { method: "POST", headers, body: JSON.stringify(body) },
        context,
        requestIdentity: request.requestIdentity,
      });
      providerRequestId = response.headers.get("request-id") ?? undefined;
      if (!response.body)
        throw new ProviderError({
          code: "INVALID_UPSTREAM_RESPONSE",
          adapterId: "anthropic",
          message: "Anthropic returned an empty stream.",
          requestIdentity: request.requestIdentity,
          providerRequestId,
        });
      for await (const message of parseSse(response.body, context.signal)) {
        if (!message.data) continue;
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(message.data) as Record<string, unknown>;
        } catch {
          throw new ProviderError({
            code: "UPSTREAM_STREAM_ERROR",
            adapterId: "anthropic",
            message: "Anthropic returned malformed stream data.",
            requestIdentity: request.requestIdentity,
            providerRequestId,
          });
        }
        const type =
          typeof event.type === "string" ? event.type : message.event;
        if (type === "message_start") {
          const start =
            event.message && typeof event.message === "object"
              ? (event.message as Record<string, unknown>)
              : undefined;
          providerRequestId ??=
            start && typeof start.id === "string" ? start.id : undefined;
          usage = mergeUsage(usage, normalizeAnthropicUsage(start?.usage));
        } else if (type === "content_block_delta") {
          const delta =
            event.delta && typeof event.delta === "object"
              ? (event.delta as Record<string, unknown>)
              : undefined;
          if (delta?.type === "text_delta" && typeof delta.text === "string") {
            text += delta.text;
            yield {
              type: "text",
              delta: delta.text,
              requestIdentity: request.requestIdentity,
              providerRequestId,
            };
          }
        } else if (type === "message_delta") {
          // Anthropic's message_delta usage is cumulative, so replace/merge fields; never sum events.
          usage = mergeUsage(usage, normalizeAnthropicUsage(event.usage));
        } else if (type === "message_stop") {
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
        } else if (type === "error") {
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
              adapterId: "anthropic",
              message: "Anthropic reported a stream error.",
              requestIdentity: request.requestIdentity,
              providerRequestId,
              retryable: true,
            }),
          };
          return;
        }
        // ping and unknown forward-compatible events are ignored.
      }
      yield {
        type: "error",
        complete: false,
        requestIdentity: request.requestIdentity,
        providerRequestId,
        error: new ProviderError({
          code: "INCOMPLETE_STREAM",
          adapterId: "anthropic",
          message: "Anthropic stream ended before message_stop.",
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
              adapterId: "anthropic",
              message: "Anthropic stream failed.",
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

  async testConnection(context: ProviderCallContext) {
    const models = await this.listModels(context);
    return {
      ok: true as const,
      modelCount: models.length,
      verification: "network" as const,
    };
  }
}
