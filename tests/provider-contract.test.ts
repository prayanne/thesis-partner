import { describe, expect, it, vi } from "vitest";
import {
  createProviderAdapter,
  getProviderDefinition,
  type FetchImplementation,
  type ProviderStreamEvent,
  type RequestIdentity,
} from "@thesis/providers";

const identity: RequestIdentity = {
  logicalCallId: "call-1",
  attempt: 1,
  idempotencyKey: "attempt-1",
};

function sseResponse(text: string, splitAt: readonly number[] = []): Response {
  const bytes = new TextEncoder().encode(text);
  let previous = 0;
  const chunks = [...splitAt, bytes.length]
    .filter(
      (value, index, values) =>
        value > previous &&
        value <= bytes.length &&
        values.indexOf(value) === index,
    )
    .map((end) => {
      const chunk = bytes.slice(previous, end);
      previous = end;
      return chunk;
    });
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
    {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-request-id": "upstream-1",
      },
    },
  );
}

async function collect(
  events: AsyncIterable<ProviderStreamEvent>,
): Promise<ProviderStreamEvent[]> {
  const result: ProviderStreamEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
}

describe("native provider adapter contracts", () => {
  it("sends a native stateless OpenAI Responses payload and normalizes split SSE", async () => {
    const fetchMock = vi
      .fn<FetchImplementation>()
      .mockResolvedValue(
        sseResponse(
          [
            'event: response.output_text.delta\r\ndata: {"type":"response.output_text.delta","delta":"안"}\r\n\r\n',
            'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"녕"}\n\n',
            'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_1","usage":{"input_tokens":4,"output_tokens":2,"total_tokens":6}}}\n\n',
          ].join(""),
          [1, 2, 7, 19, 31, 32, 54, 79, 103, 141],
        ),
      );
    const adapter = createProviderAdapter(
      {
        adapterId: "openai",
        providerInstanceId: "oa-1",
        enabled: true,
        endpoint: "https://api.openai.com/v1",
        modelId: "model-a",
        credentialRef: "openai-key",
      },
      { fetch: fetchMock },
    );
    const events = await collect(
      adapter.chat(
        {
          modelId: "model-a",
          messages: [
            { role: "system", content: "cite sources" },
            { role: "user", content: "hello" },
          ],
          maxOutputTokens: 100,
          requestIdentity: identity,
        },
        { credential: "super-secret" },
      ),
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://api.openai.com/v1/responses");
    expect((init?.headers as Headers).get("Authorization")).toBe(
      "Bearer super-secret",
    );
    expect((init?.headers as Headers).get("Idempotency-Key")).toBe(
      identity.idempotencyKey,
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "model-a",
      input: [{ role: "user", content: "hello" }],
      instructions: "cite sources",
      max_output_tokens: 100,
      stream: true,
      store: false,
    });
    expect(events.map((event) => event.type)).toEqual([
      "text",
      "text",
      "usage",
      "final",
    ]);
    expect(events.at(-1)).toMatchObject({
      type: "final",
      text: "안녕",
      complete: true,
      requestIdentity: identity,
      providerRequestId: "upstream-1",
      usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
    });
  });

  it("uses native Anthropic headers/payload and does not sum cumulative stream usage", async () => {
    const stream = [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","usage":{"input_tokens":10,"output_tokens":1,"cache_read_input_tokens":3}}}\n\n',
      'event: ping\ndata: {"type":"ping"}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":5}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ].join("");
    const fetchMock = vi
      .fn<FetchImplementation>()
      .mockResolvedValue(sseResponse(stream, [3, 11, 29, 77, 155, 223]));
    const adapter = createProviderAdapter(
      {
        adapterId: "anthropic",
        providerInstanceId: "an-1",
        enabled: true,
        endpoint: "https://api.anthropic.com/v1",
        modelId: "claude",
        credentialRef: "anthropic-key",
      },
      { fetch: fetchMock },
    );
    const events = await collect(
      adapter.chat(
        {
          modelId: "claude",
          messages: [
            { role: "system", content: "be brief" },
            { role: "user", content: "hello" },
          ],
          maxOutputTokens: 50,
          temperature: 0.2,
          requestIdentity: identity,
        },
        { credential: "anthropic-secret" },
      ),
    );

    const [, init] = fetchMock.mock.calls[0]!;
    expect((init?.headers as Headers).get("x-api-key")).toBe(
      "anthropic-secret",
    );
    expect((init?.headers as Headers).get("anthropic-version")).toBe(
      "2023-06-01",
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "claude",
      max_tokens: 50,
      messages: [{ role: "user", content: "hello" }],
      system: "be brief",
      stream: true,
    });
    expect(events.at(-1)).toMatchObject({
      type: "final",
      text: "Hi",
      complete: true,
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        cacheReadTokens: 3,
      },
    });
    expect(adapter.embed).toBeUndefined();
    expect(getProviderDefinition("anthropic").capabilities.embedding).toBe(
      false,
    );
  });

  it("does not emit a cacheable final event after an SSE error or incomplete stream", async () => {
    const errorFetch = vi
      .fn<FetchImplementation>()
      .mockResolvedValue(
        sseResponse(
          'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n',
        ),
      );
    const adapter = createProviderAdapter(
      {
        adapterId: "anthropic",
        providerInstanceId: "an-1",
        enabled: true,
        endpoint: "https://api.anthropic.com/v1",
        credentialRef: "ref",
      },
      { fetch: errorFetch },
    );
    const events = await collect(
      adapter.chat(
        {
          modelId: "claude",
          messages: [{ role: "user", content: "x" }],
          maxOutputTokens: 5,
          requestIdentity: identity,
        },
        { credential: "secret" },
      ),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "error", complete: false });
    expect(events.some((event) => event.type === "final")).toBe(false);

    const incompleteFetch = vi
      .fn<FetchImplementation>()
      .mockResolvedValue(
        sseResponse(
          'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"partial"}\n\n',
        ),
      );
    const openai = createProviderAdapter(
      {
        adapterId: "openai",
        providerInstanceId: "oa-1",
        enabled: true,
        endpoint: "https://api.openai.com/v1",
        credentialRef: "ref",
      },
      { fetch: incompleteFetch },
    );
    const incomplete = await collect(
      openai.chat(
        {
          modelId: "model",
          messages: [{ role: "user", content: "x" }],
          maxOutputTokens: 5,
          requestIdentity: identity,
        },
        { credential: "secret" },
      ),
    );
    expect(incomplete.map((event) => event.type)).toEqual(["text", "error"]);
    expect(incomplete.at(-1)).toMatchObject({
      type: "error",
      error: { code: "INCOMPLETE_STREAM" },
    });
  });

  it("preserves terminal usage for cost settlement even when OpenAI fails", async () => {
    const fetchMock = vi
      .fn<FetchImplementation>()
      .mockResolvedValue(
        sseResponse(
          'event: response.failed\ndata: {"type":"response.failed","response":{"usage":{"input_tokens":12,"output_tokens":3,"total_tokens":15}}}\n\n',
        ),
      );
    const adapter = createProviderAdapter(
      {
        adapterId: "openai",
        providerInstanceId: "oa-1",
        enabled: true,
        endpoint: "https://api.openai.com/v1",
        credentialRef: "ref",
      },
      { fetch: fetchMock },
    );
    const events = await collect(
      adapter.chat(
        {
          modelId: "model",
          messages: [{ role: "user", content: "x" }],
          maxOutputTokens: 5,
          requestIdentity: identity,
        },
        { credential: "secret" },
      ),
    );
    expect(events.map((event) => event.type)).toEqual(["usage", "error"]);
    expect(events[0]).toMatchObject({
      type: "usage",
      usage: { inputTokens: 12, outputTokens: 3, totalTokens: 15 },
    });
    expect(events.some((event) => event.type === "final")).toBe(false);
  });

  it("implements the separate OpenAI embeddings capability", async () => {
    const fetchMock = vi.fn<FetchImplementation>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ index: 0, embedding: [0.25, -0.5] }],
          usage: { prompt_tokens: 3, total_tokens: 3 },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-request-id": "embed-request",
          },
        },
      ),
    );
    const adapter = createProviderAdapter(
      {
        adapterId: "openai",
        providerInstanceId: "oa-1",
        enabled: true,
        endpoint: "https://api.openai.com/v1",
        credentialRef: "ref",
        embeddingModelId: "embed-model",
      },
      { fetch: fetchMock },
    );
    const result = await adapter.embed!(
      { modelId: "embed-model", input: ["a"], requestIdentity: identity },
      { credential: "secret" },
    );
    expect(result).toMatchObject({
      vectors: [[0.25, -0.5]],
      complete: true,
      providerRequestId: "embed-request",
      usage: { inputTokens: 3, totalTokens: 3 },
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://api.openai.com/v1/embeddings");
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "embed-model",
      input: ["a"],
    });
  });

  it("normalizes abort without a final result", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi
      .fn<FetchImplementation>()
      .mockResolvedValue(
        sseResponse(
          'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"never"}\n\n',
        ),
      );
    const adapter = createProviderAdapter(
      {
        adapterId: "openai",
        providerInstanceId: "oa-1",
        enabled: true,
        endpoint: "https://api.openai.com/v1",
        credentialRef: "ref",
      },
      { fetch: fetchMock },
    );
    const events = await collect(
      adapter.chat(
        {
          modelId: "model",
          messages: [{ role: "user", content: "x" }],
          maxOutputTokens: 5,
          requestIdentity: identity,
        },
        { credential: "secret", signal: controller.signal },
      ),
    );
    expect(events).toEqual([
      {
        type: "abort",
        complete: false,
        requestIdentity: identity,
        providerRequestId: "upstream-1",
      },
    ]);
  });
});
