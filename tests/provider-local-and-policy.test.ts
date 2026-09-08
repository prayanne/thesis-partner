import { describe, expect, it, vi } from "vitest";
import {
  ProviderError,
  assertProviderCallAllowed,
  createProviderAdapter,
  getProviderDefinition,
  type FetchImplementation,
  type ProviderStreamEvent,
  type RequestIdentity,
} from "@thesis/providers";

const identity: RequestIdentity = {
  logicalCallId: "local-call",
  attempt: 2,
  idempotencyKey: "local-attempt-2",
};
const allowPolicy = {
  localOnly: false,
  allowExternalAi: true,
  allowExternalTranslation: true,
  paidAiEnabled: true,
  paperAllowsExternal: true,
};

async function collect(events: AsyncIterable<ProviderStreamEvent>) {
  const result: ProviderStreamEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
}

describe("local adapters and provider policy", () => {
  it("uses OpenAI-compatible local chat streaming with usage and stable identity", async () => {
    const stream = [
      'data: {"id":"chat-1","choices":[{"delta":{"content":"local"},"finish_reason":null}]}\n\n',
      'data: {"id":"chat-1","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":7,"completion_tokens":2,"total_tokens":9}}\n\n',
      "data: [DONE]\n\n",
    ].join("");
    const fetchMock = vi.fn<FetchImplementation>().mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );
    const adapter = createProviderAdapter(
      {
        adapterId: "ollama",
        providerInstanceId: "ol-1",
        enabled: true,
        endpoint: "http://127.0.0.1:11434/v1",
        modelId: "llama",
        modelRevision: "sha",
        embeddingModelId: "embed",
      },
      { fetch: fetchMock },
    );
    const events = await collect(
      adapter.chat(
        {
          modelId: "llama",
          messages: [{ role: "user", content: "hi" }],
          maxOutputTokens: 20,
          requestIdentity: identity,
        },
        {},
      ),
    );
    expect(events.map((event) => event.type)).toEqual([
      "text",
      "usage",
      "final",
    ]);
    expect(events.at(-1)).toMatchObject({
      type: "final",
      text: "local",
      complete: true,
      requestIdentity: identity,
      usage: { inputTokens: 7, outputTokens: 2 },
    });
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init?.headers as Headers).get("Idempotency-Key")).toBe(
      identity.idempotencyKey,
    );
  });

  it("maps LM Studio native model types to explicit chat/embedding capability", async () => {
    const fetchMock = vi.fn<FetchImplementation>().mockResolvedValue(
      new Response(
        JSON.stringify({
          models: [
            {
              type: "llm",
              key: "chat-model",
              display_name: "Chat",
              capabilities: { vision: false, trained_for_tool_use: true },
              loaded_instances: [],
            },
            {
              type: "embedding",
              key: "embed-model",
              display_name: "Embed",
              loaded_instances: [],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const adapter = createProviderAdapter(
      {
        adapterId: "lmstudio",
        providerInstanceId: "lm-1",
        enabled: true,
        endpoint: "http://host.docker.internal:1234/v1",
        modelRevision: "manual-r1",
      },
      { fetch: fetchMock },
    );
    const models = await adapter.listModels({ credential: "optional-token" });
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      "http://host.docker.internal:1234/api/v1/models",
    );
    expect(models[0]).toMatchObject({
      id: "chat-model",
      revision: "manual-r1",
      executionLocation: "local",
      localOnlyEligible: true,
      capabilitySource: "native",
      capabilities: {
        chat: "supported",
        embedding: "unsupported",
        toolUse: "supported",
      },
    });
    expect(models[1]).toMatchObject({
      id: "embed-model",
      capabilities: { chat: "unsupported", embedding: "supported" },
    });
  });

  it("rejects arbitrary cloud and non-local endpoints", () => {
    const unused = vi.fn<FetchImplementation>();
    expect(() =>
      createProviderAdapter(
        {
          adapterId: "openai",
          providerInstanceId: "oa",
          enabled: true,
          endpoint: "https://proxy.example/v1",
          credentialRef: "ref",
        },
        { fetch: unused },
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_ENDPOINT" }));
    expect(() =>
      createProviderAdapter(
        {
          adapterId: "ollama",
          providerInstanceId: "ol",
          enabled: true,
          endpoint: "http://192.168.1.20:11434/v1",
        },
        { fetch: unused },
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_ENDPOINT" }));
  });

  it("rejects upstream redirects instead of following them", async () => {
    const fetchMock = vi.fn<FetchImplementation>().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "https://example.com/steal" },
      }),
    );
    const adapter = createProviderAdapter(
      {
        adapterId: "openai",
        providerInstanceId: "oa",
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
          maxOutputTokens: 2,
          requestIdentity: identity,
        },
        { credential: "secret" },
      ),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "error",
      error: { code: "REDIRECT_BLOCKED" },
      complete: false,
    });
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ redirect: "error" });
  });

  it("blocks cloud-backed or unverified local models in local-only mode", () => {
    const localOnly = { ...allowPolicy, localOnly: true };
    expect(() =>
      assertProviderCallAllowed(localOnly, "openai", "chat", {
        id: "model",
        executionLocation: "remote",
        localOnlyEligible: false,
      }),
    ).toThrowError(expect.objectContaining({ code: "POLICY_BLOCKED" }));
    expect(() =>
      assertProviderCallAllowed(localOnly, "ollama", "chat", {
        id: "gpt-oss:120b-cloud",
        executionLocation: "remote",
        localOnlyEligible: false,
      }),
    ).toThrowError(expect.objectContaining({ code: "CLOUD_MODEL_BLOCKED" }));
    expect(() =>
      assertProviderCallAllowed(localOnly, "lmstudio", "chat"),
    ).toThrowError(
      expect.objectContaining({ code: "MODEL_LOCALITY_UNVERIFIED" }),
    );
    expect(() =>
      assertProviderCallAllowed(localOnly, "lmstudio", "chat", {
        id: "local-model",
        executionLocation: "local",
        localOnlyEligible: true,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "MODEL_LOCALITY_UNVERIFIED" }),
    );
    expect(() =>
      assertProviderCallAllowed(
        { ...localOnly, localProviderIsolationVerified: true },
        "lmstudio",
        "chat",
        {
          id: "local-model",
          executionLocation: "local",
          localOnlyEligible: true,
        },
      ),
    ).not.toThrow();
  });

  it("allows metadata-only checks while paid inference is disabled", () => {
    const paidDisabled = { ...allowPolicy, paidAiEnabled: false };
    expect(() =>
      assertProviderCallAllowed(paidDisabled, "openai", "listModels"),
    ).not.toThrow();
    expect(() =>
      assertProviderCallAllowed(paidDisabled, "openai", "inspectModel"),
    ).not.toThrow();
    expect(() =>
      assertProviderCallAllowed(paidDisabled, "openai", "testConnection"),
    ).not.toThrow();
    expect(() =>
      assertProviderCallAllowed(paidDisabled, "openai", "chat"),
    ).toThrowError(expect.objectContaining({ code: "POLICY_BLOCKED" }));
    expect(() =>
      assertProviderCallAllowed(paidDisabled, "openai", "embedding"),
    ).toThrowError(expect.objectContaining({ code: "POLICY_BLOCKED" }));
  });

  it("never exposes a credential through provider errors", async () => {
    const credential = "credential-that-must-not-escape";
    const fetchMock = vi
      .fn<FetchImplementation>()
      .mockRejectedValue(new Error(`socket failure ${credential}`));
    const adapter = createProviderAdapter(
      {
        adapterId: "openai",
        providerInstanceId: "oa",
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
          maxOutputTokens: 2,
          requestIdentity: identity,
        },
        { credential },
      ),
    );
    const error = events[0]?.type === "error" ? events[0].error : undefined;
    expect(error).toBeInstanceOf(ProviderError);
    expect(String(error)).not.toContain(credential);
    expect(JSON.stringify(error)).not.toContain(credential);
    expect(error?.cause).toBeUndefined();
  });

  it("publishes registry billing/location as immutable code facts", () => {
    expect(getProviderDefinition("openai")).toMatchObject({
      billingClass: "paid",
      executionLocation: "remote",
      fixedEndpoint: true,
    });
    expect(getProviderDefinition("ollama")).toMatchObject({
      billingClass: "no_api_charge",
      executionLocation: "local",
      fixedEndpoint: false,
    });
    expect(
      getProviderDefinition("google-translate-v2").capabilities,
    ).toMatchObject({ translation: true, chat: false, embedding: false });
    expect(Object.isFrozen(getProviderDefinition("openai"))).toBe(true);
    expect(Object.isFrozen(getProviderDefinition("openai").capabilities)).toBe(
      true,
    );
    expect(Object.isFrozen(getProviderDefinition("openai").configFields)).toBe(
      true,
    );
  });
});
