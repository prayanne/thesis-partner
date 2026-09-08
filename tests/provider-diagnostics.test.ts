import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createProviderAdapter,
  ProviderError,
  type FetchImplementation,
  type ProviderStreamEvent,
} from "@thesis/providers";
import {
  atomicPrivateWrite,
  defaultConfig,
  runtimePaths,
  updateConfig,
  writeCredential,
} from "@thesis/security";
import {
  getProviderValidation,
  validateProvider,
} from "../packages/security/src/provider-verification";

const fakeKey = "sk-synthetic-diagnostic-test-never-valid";
const privateText = "synthetic-private-upstream-body";
const identity = {
  logicalCallId: "diagnostic-call",
  attempt: 1,
  idempotencyKey: "diagnostic-call",
};
const knownCodes = [
  ["invalid_api_key", "UPSTREAM_AUTHENTICATION_ERROR", "authentication"],
  ["insufficient_quota", "UPSTREAM_QUOTA_EXCEEDED", "billing"],
  ["rate_limit_exceeded", "UPSTREAM_RATE_LIMITED", "rate limit"],
  ["model_not_found", "UPSTREAM_MODEL_ACCESS_DENIED", "model access"],
  ["permission_denied", "UPSTREAM_MODEL_ACCESS_DENIED", "permissions"],
  ["server_error", "UPSTREAM_SERVER_ERROR", "internal server error"],
  ["invalid_request_error", "UPSTREAM_INVALID_REQUEST", "invalid request"],
] as const;

function stream(
  event: unknown,
  eventName?: string,
  requestId = "req_synthetic",
) {
  return new Response(
    `${eventName ? `event: ${eventName}\n` : ""}data: ${JSON.stringify(event)}\n\n`,
    {
      headers: {
        "content-type": "text/event-stream",
        "x-request-id": requestId,
      },
    },
  );
}
async function collect(response: Response) {
  const transport = vi.fn<FetchImplementation>().mockResolvedValue(response);
  const adapter = createProviderAdapter(
    {
      adapterId: "openai",
      providerInstanceId: "openai",
      enabled: true,
      endpoint: "https://api.openai.com/v1",
      credentialRef: "openai",
      modelId: "gpt-5.6-sol",
      reasoningEffort: "high",
    },
    { fetch: transport },
  );
  const events: ProviderStreamEvent[] = [];
  for await (const event of adapter.chat(
    {
      modelId: "gpt-5.6-sol",
      messages: [{ role: "user", content: "OK" }],
      maxOutputTokens: 512,
      serviceTier: "default",
      requestIdentity: identity,
    },
    { credential: fakeKey },
  ))
    events.push(event);
  expect(transport).toHaveBeenCalledOnce();
  expect(events.some((event) => event.type === "final")).toBe(false);
  const terminal = events.at(-1);
  expect(terminal?.type).toBe("error");
  if (terminal?.type !== "error") throw new Error("Expected a terminal error");
  expect(terminal.complete).toBe(false);
  expect(terminal.requestIdentity).toEqual(identity);
  expect(terminal.error.cause).toBeUndefined();
  expect(terminal.error.message).not.toContain(fakeKey);
  expect(terminal.error.message).not.toContain(privateText);
  return { events, error: terminal.error };
}

describe("allowlisted OpenAI stream failure diagnostics", () => {
  for (const shape of ["top-level", "nested", "failed"] as const) {
    it.each(knownCodes)(
      `classifies explicit %s in ${shape} errors without echoing messages`,
      async (upstreamCode, localCode, messagePart) => {
        const error = {
          code: upstreamCode,
          message: `${fakeKey} ${privateText}`,
          param: fakeKey,
          extra: privateText,
        };
        const event =
          shape === "top-level"
            ? { type: "error", ...error }
            : shape === "nested"
              ? { type: "error", error }
              : { type: "response.failed", response: { error } };
        const result = await collect(stream(event));
        expect(result.error.code).toBe(localCode);
        expect(result.error.message).toContain(messagePart);
        expect(JSON.stringify(result.events)).not.toContain(fakeKey);
        expect(JSON.stringify(result.events)).not.toContain(privateText);
      },
    );
  }

  it("uses the SSE event name when the JSON type is omitted", async () => {
    const { error } = await collect(
      stream({ code: "insufficient_quota", message: fakeKey }, "error"),
    );
    expect(error.code).toBe("UPSTREAM_QUOTA_EXCEEDED");
  });

  it("reports an explicit output limit and preserves terminal usage", async () => {
    const { events, error } = await collect(
      stream({
        type: "response.incomplete",
        response: {
          incomplete_details: { reason: "max_output_tokens", message: fakeKey },
          usage: {
            input_tokens: 10,
            output_tokens: 512,
            total_tokens: 522,
            output_tokens_details: { reasoning_tokens: 512 },
          },
        },
      }),
    );
    expect(events.map((event) => event.type)).toEqual(["usage", "error"]);
    expect(events[0]).toMatchObject({
      usage: { inputTokens: 10, outputTokens: 512, reasoningTokens: 512 },
    });
    expect(error.code).toBe("MAX_OUTPUT_TOKENS");
    expect(error.message).toContain("reasoning tokens");
  });

  it.each([
    undefined,
    null,
    429,
    {},
    ["insufficient_quota"],
    "future_error",
    "__proto__",
    "constructor",
    "toString",
    "INSUFFICIENT_QUOTA",
    " insufficient_quota ",
    `insufficient_quota ${fakeKey}`,
    fakeKey,
  ])(
    "does not infer a diagnosis from unknown code %j or free text",
    async (code) => {
      const { error } = await collect(
        stream({
          type: "error",
          code,
          message: `insufficient_quota invalid_api_key max_output_tokens ${fakeKey}`,
          param: "model_not_found",
          error: { type: "rate_limit_exceeded", message: privateText },
        }),
      );
      expect(error.code).toBe("UPSTREAM_STREAM_ERROR");
      expect(error.message).toContain("no recognized failure reason");
    },
  );

  it.each([
    undefined,
    null,
    512,
    {},
    ["max_output_tokens"],
    "content_filter",
    "max_tokens",
    fakeKey,
  ])("keeps an incomplete response generic for reason %j", async (reason) => {
    const { error } = await collect(
      stream({
        type: "response.incomplete",
        response: {
          incomplete_details: { reason, message: "max_output_tokens" },
          usage: { output_tokens: 512 },
        },
      }),
    );
    expect(error.code).toBe("UPSTREAM_STREAM_ERROR");
  });

  it.each([null, [], fakeKey, 512])(
    "handles malformed event objects %j safely",
    async (event) => {
      const { error } = await collect(stream(event, "error"));
      expect(error.code).toBe("UPSTREAM_STREAM_ERROR");
    },
  );

  it("handles malformed JSON without retaining the parse error or raw data", async () => {
    const { error } = await collect(
      new Response(`event: error\ndata: ${fakeKey}\n\n`),
    );
    expect(error.code).toBe("UPSTREAM_STREAM_ERROR");
  });
});

describe("persisted validation failure diagnostics", () => {
  let directory: string;
  let fingerprint: string;
  beforeEach(async () => {
    directory = await mkdtemp(
      path.join(await realpath(tmpdir()), "thesis-diagnostics-"),
    );
    vi.stubEnv("APP_DATA_DIR", directory);
    vi.stubEnv("CONFIG_DIR", undefined);
    vi.stubEnv("MASTER_KEY_FILE", undefined);
    vi.stubEnv("CONTAINER_RUNTIME", undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("Unexpected network traffic");
      }),
    );
    await atomicPrivateWrite(runtimePaths().masterKey, "45".repeat(32));
    await writeCredential("openai", fakeKey);
    const config = defaultConfig();
    await updateConfig(
      {
        providers: config.providers.map((provider) =>
          provider.id === "openai"
            ? {
                ...provider,
                enabled: true,
                credentialRef: "openai",
                modelId: "gpt-5.6-sol",
                reasoningEffort: "high",
              }
            : provider,
        ),
        network: { localOnly: false, allowExternalAi: true },
        ai: { paidAiEnabled: true, defaults: { summary: "openai" } },
      },
      1,
    );
    const metadata = vi
      .fn<FetchImplementation>()
      .mockResolvedValue(Response.json({ data: [{ id: "gpt-5.6-sol" }] }));
    const verified = await validateProvider(
      "openai",
      { stage: "metadata" },
      metadata,
    );
    expect(verified.metadata?.status).toBe("passed");
    fingerprint = verified.fingerprint;
  });
  afterEach(async () => {
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  async function validate(response: Response) {
    const transport = vi.fn<FetchImplementation>().mockResolvedValue(response);
    const state = await validateProvider(
      "openai",
      {
        stage: "inference",
        confirmPaid: true,
        expectedFingerprint: fingerprint,
      },
      transport,
    );
    expect(transport).toHaveBeenCalledOnce();
    expect(JSON.parse(String(transport.mock.calls[0]![1]?.body))).toMatchObject(
      {
        model: "gpt-5.6-sol",
        reasoning: { effort: "high" },
        max_output_tokens: 512,
        service_tier: "default",
        store: false,
      },
    );
    expect(state.inference).toMatchObject({
      status: "incomplete",
      inferencePerformed: true,
      maxOutputTokens: 512,
      serviceTier: "default",
    });
    const stored = await readFile(
      path.join(runtimePaths().config, "provider-evidence-openai.json"),
      "utf8",
    );
    for (const forbidden of [
      fakeKey,
      privateText,
      '"raw"',
      '"incomplete_details"',
      '"error"',
      '"output_text"',
    ])
      expect(stored).not.toContain(forbidden);
    const report = JSON.parse(stored).reports.summary.inference;
    expect(report).toEqual(state.inference);
    expect((await getProviderValidation("openai")).inference).toEqual(report);
    expect(report.message).toContain("Usage may have been incurred.");
    return report;
  }

  it.each(knownCodes)(
    "persists a useful fixed diagnostic for %s with no usage",
    async (code, localCode, messagePart) => {
      const report = await validate(
        stream({
          type: "response.failed",
          response: { error: { code, message: `${fakeKey} ${privateText}` } },
        }),
      );
      expect(report.code).toBe(localCode);
      expect(report.message).toContain(messagePart);
      expect(report.usage).toBeUndefined();
      expect(report.providerRequestId).toBe("req_synthetic");
    },
  );

  it("persists the output-limit diagnosis and only safe numeric usage", async () => {
    const report = await validate(
      stream({
        type: "response.incomplete",
        response: {
          incomplete_details: { reason: "max_output_tokens", message: fakeKey },
          output: [{ text: privateText }],
          usage: {
            input_tokens: 10,
            output_tokens: 512,
            total_tokens: 522,
            output_tokens_details: { reasoning_tokens: 512, message: fakeKey },
            secret: fakeKey,
          },
        },
      }),
    );
    expect(report.code).toBe("MAX_OUTPUT_TOKENS");
    expect(report.message).toContain("reasoning tokens");
    expect(report.usage).toEqual({
      inputTokens: 10,
      outputTokens: 512,
      totalTokens: 522,
      reasoningTokens: 512,
    });
  });

  it.each(["error", "response.failed", "response.incomplete"])(
    "persists a generic %s diagnostic and drops secret-echo request IDs",
    async (type) => {
      const report = await validate(
        stream(
          {
            type,
            code: fakeKey,
            message: privateText,
            response: {
              error: { code: fakeKey, message: privateText },
              incomplete_details: { reason: fakeKey },
            },
          },
          undefined,
          `req_${fakeKey}`,
        ),
      );
      expect(report.code).toBe("UPSTREAM_STREAM_ERROR");
      expect(report.message).toContain("no recognized failure reason");
      expect(report.providerRequestId).toBeUndefined();
      expect(report.usage).toBeUndefined();
    },
  );

  it("does not trust the message of an otherwise recognized ProviderError", async () => {
    const transport = vi.fn<FetchImplementation>().mockRejectedValue(
      new ProviderError({
        code: "UPSTREAM_QUOTA_EXCEEDED",
        message: `${fakeKey} ${privateText}`,
        adapterId: "openai",
      }),
    );
    const result = await validateProvider(
      "openai",
      {
        stage: "inference",
        confirmPaid: true,
        expectedFingerprint: fingerprint,
      },
      transport,
    );
    expect(transport).toHaveBeenCalledOnce();
    expect(result.inference?.message).toContain("billing");
    const stored = await readFile(
      path.join(runtimePaths().config, "provider-evidence-openai.json"),
      "utf8",
    );
    expect(stored).not.toContain(fakeKey);
    expect(stored).not.toContain(privateText);
  });
});
