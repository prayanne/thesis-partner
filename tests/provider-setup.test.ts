import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, realpath, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  atomicPrivateWrite,
  configSchema,
  createSession,
  defaultConfig,
  readConfig,
  readCredential,
  runtimePaths,
  updateConfig,
  writeCredential,
  issueAccessToken,
  resolveTaskModel,
} from "@thesis/security";
import {
  assertModelSelection,
  createProviderAdapter,
  modelChoices,
  type FetchImplementation,
  type ProviderStreamEvent,
} from "@thesis/providers";
import {
  getProviderModels,
  getProviderValidation,
  refreshProviderModels,
  validateProvider,
} from "../packages/security/src/provider-verification";
import {
  GET as modelsGET,
  POST as modelsPOST,
} from "../apps/web/src/app/api/v1/providers/[id]/models/route";
import {
  GET as validationGET,
  POST as validationPOST,
} from "../apps/web/src/app/api/v1/providers/[id]/validation/route";

const origin = "http://127.0.0.1:3000";
const fakeKey = "sk-synthetic-setup-test-never-valid";
const initialEnv = { ...process.env };
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(
    path.join(await realpath(tmpdir()), "thesis-provider-setup-"),
  );
  process.env.APP_DATA_DIR = directory;
  process.env.APP_ORIGIN = origin;
  delete process.env.CONFIG_DIR;
  delete process.env.MASTER_KEY_FILE;
  delete process.env.CONTAINER_RUNTIME;
  await atomicPrivateWrite(runtimePaths().masterKey, "23".repeat(32));
  await atomicPrivateWrite(runtimePaths().bootstrap, "synthetic-bootstrap");
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Unexpected provider traffic in a synthetic test");
    }),
  );
});
afterEach(async () => {
  process.env = { ...initialEnv };
  vi.unstubAllGlobals();
  await rm(directory, { recursive: true, force: true });
});
async function configured() {
  await writeCredential("openai", fakeKey);
  const config = defaultConfig();
  return updateConfig(
    {
      providers: config.providers.map((p) =>
        p.id === "openai"
          ? {
              ...p,
              enabled: true,
              modelId: "gpt-5.6-sol",
              reasoningEffort: "high",
              credentialRef: "openai",
              embeddingModelId: "text-embedding-3-small",
            }
          : p,
      ),
      network: { localOnly: false, allowExternalAi: true },
      ai: {
        paidAiEnabled: true,
        defaults: { summary: "openai", embedding: "openai" },
      },
    },
    1,
  );
}
function metadata(
  ids = ["gpt-5.6-sol", "text-embedding-3-small", "unknown-future-model"],
) {
  return vi.fn<FetchImplementation>().mockImplementation(async () =>
    Response.json({
      data: ids.map((id) => ({
        id,
        secret: fakeKey,
        nested: { authorization: fakeKey },
      })),
    }),
  );
}
function stream(completed = true) {
  const usage = {
    input_tokens: 12,
    output_tokens: 10,
    total_tokens: 22,
    output_tokens_details: { reasoning_tokens: 8 },
    secret: fakeKey,
  };
  return new Response(
    `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: "OK" })}\n\nevent: ${completed ? "response.completed" : "response.incomplete"}\ndata: ${JSON.stringify({ type: completed ? "response.completed" : "response.incomplete", response: { id: "resp_synthetic", usage } })}\n\n`,
    {
      headers: {
        "content-type": "text/event-stream",
        "x-request-id": "req_synthetic",
      },
    },
  );
}
describe("saved setup defaults and model choices", () => {
  it("defaults old configurations without resetting credentials, preferences or provider state", async () => {
    const config = await configured();
    const { onboarding: _, developer: __, ...old } = config;
    const { taskModels: ___, ...ai } = old.ai;
    await atomicPrivateWrite(
      path.join(runtimePaths().config, "config.json"),
      JSON.stringify({ ...old, ai, reading: { scale: 1.5 } }),
    );
    const migrated = await readConfig();
    expect(migrated.onboarding).toEqual({
      completedAt: null,
      deferredAt: null,
    });
    expect(migrated.developer).toEqual({ enabled: false });
    expect(migrated.ai.taskModels.summary).toBeNull();
    expect(migrated.reading.scale).toBe(1.5);
    expect(migrated.providers[0]?.reasoningEffort).toBe("high");
    expect(await readCredential("openai")).toBe(fakeKey);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects unsupported model/effort/function combinations without substituting a model", async () => {
    const config = await configured();
    await expect(
      updateConfig(
        { ai: { taskModels: { embedding: { modelId: "gpt-5.6-sol" } } } },
        config.revision,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(
      configSchema.safeParse({
        ...config,
        ai: {
          ...config.ai,
          taskModels: {
            ...config.ai.taskModels,
            embedding: {
              modelId: "text-embedding-3-small",
              reasoningEffort: "high",
            },
          },
        },
      }).success,
    ).toBe(false);
    expect(() =>
      assertModelSelection("openai", "future-unknown", "summary", "high"),
    ).toThrow();
    expect(() =>
      assertModelSelection("anthropic", "claude", "embedding"),
    ).toThrow();
    expect(
      modelChoices("openai").find((m) => m.id === "gpt-5.6-sol"),
    ).toMatchObject({
      available: null,
      protocol: "responses",
      reasoningEfforts: expect.arrayContaining(["high"]),
    });
  });
  it("resolves task effort independently and preserves other functional defaults", async () => {
    const config = await configured();
    const next = await updateConfig(
      {
        ai: {
          defaults: { chat: "openai" },
          taskModels: {
            summary: { modelId: "gpt-5.6-sol", reasoningEffort: "low" },
          },
        },
      },
      config.revision,
    );
    expect(resolveTaskModel(next, "summary")?.reasoningEffort).toBe("low");
    expect(resolveTaskModel(next, "chat")?.reasoningEffort).toBe("high");
    expect(resolveTaskModel(next, "embedding")).toMatchObject({
      modelId: "text-embedding-3-small",
      reasoningEffort: undefined,
    });
    expect(resolveTaskModel(next, "summary", "anthropic")).toMatchObject({
      modelId: "",
      reasoningEffort: undefined,
    });
    const explicit = await updateConfig(
      { ai: { taskModels: { summary: { modelId: "gpt-5.6-sol" } } } },
      next.revision,
    );
    expect(
      resolveTaskModel(explicit, "summary")?.reasoningEffort,
    ).toBeUndefined();
  });
});
describe("metadata and explicitly paid inference gates", () => {
  it("GET is entirely local and metadata refresh combines discovery with known capabilities", async () => {
    await configured();
    const before = await getProviderModels("openai");
    expect(
      before.models.find((m) => m.id === "gpt-5.6-sol")?.available,
    ).toBeNull();
    expect((await getProviderValidation("openai")).inference).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    const mock = metadata();
    const catalog = await refreshProviderModels("openai", mock);
    expect(mock).toHaveBeenCalledOnce();
    expect(catalog.models.find((m) => m.id === "gpt-5.6-sol")).toMatchObject({
      available: true,
      selectable: true,
      supportedFunctions: ["summary", "chat", "analysis"],
    });
    expect(
      catalog.models.find((m) => m.id === "unknown-future-model"),
    ).toMatchObject({
      available: true,
      selectable: false,
      profileSource: "unknown",
    });
    expect(
      catalog.models.find((m) => m.id === "text-embedding-3-large")?.available,
    ).toBe(false);
    const result = await validateProvider(
      "openai",
      { stage: "metadata" },
      mock,
    );
    expect(result.metadata).toMatchObject({
      status: "passed",
      inferencePerformed: false,
    });
    expect(result.inference).toBeNull();
    expect((await readConfig()).revision).toBe(2);
    const file = path.join(
      runtimePaths().config,
      "provider-evidence-openai.json",
    );
    expect(await readFile(file, "utf8")).not.toContain(fakeKey);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });
  it("blocks missing model access and local-only policy before inference", async () => {
    const config = await configured();
    const unavailable = await validateProvider(
      "openai",
      { stage: "metadata" },
      metadata(["other"]),
    );
    expect(unavailable.metadata).toMatchObject({
      status: "blocked",
      code: "CAPABILITY_UNSUPPORTED",
      modelId: "gpt-5.6-sol",
    });
    await updateConfig({ network: { localOnly: true } }, config.revision);
    const mock = metadata();
    const blocked = await validateProvider(
      "openai",
      { stage: "metadata" },
      mock,
    );
    expect(blocked.metadata).toMatchObject({
      code: "POLICY_BLOCKED",
      inferencePerformed: false,
    });
    expect(mock).not.toHaveBeenCalled();
  });
  it("requires matching metadata evidence and separate explicit paid consent", async () => {
    await configured();
    const mock = metadata();
    const noMetadata = await validateProvider(
      "openai",
      { stage: "inference", confirmPaid: true },
      mock,
    );
    expect(noMetadata.inference).toMatchObject({
      status: "blocked",
      code: "METADATA_REQUIRED",
      inferencePerformed: false,
    });
    expect(mock).not.toHaveBeenCalled();
    const verified = await validateProvider(
      "openai",
      { stage: "metadata" },
      mock,
    );
    mock.mockClear();
    const noConsent = await validateProvider(
      "openai",
      { stage: "inference", expectedFingerprint: verified.fingerprint },
      mock,
    );
    expect(noConsent.inference?.code).toBe("PAID_CONFIRMATION_REQUIRED");
    expect(mock).not.toHaveBeenCalled();
  });
  it("runs one bounded synthetic Responses request with exact high effort and safe persisted usage", async () => {
    await configured();
    const verified = await validateProvider(
      "openai",
      { stage: "metadata" },
      metadata(),
    );
    const mock = vi.fn<FetchImplementation>().mockResolvedValue(stream());
    const result = await validateProvider(
      "openai",
      {
        stage: "inference",
        confirmPaid: true,
        expectedFingerprint: verified.fingerprint,
      },
      mock,
    );
    expect(mock).toHaveBeenCalledOnce();
    expect(String(mock.mock.calls[0]![0])).toBe(
      "https://api.openai.com/v1/responses",
    );
    const body = JSON.parse(String(mock.mock.calls[0]![1]?.body));
    expect(body).toMatchObject({
      model: "gpt-5.6-sol",
      reasoning: { effort: "high" },
      max_output_tokens: 512,
      service_tier: "default",
      store: false,
    });
    expect(body.input).toEqual([
      {
        role: "user",
        content: "Reply with exactly OK. This is a synthetic setup check.",
      },
    ]);
    expect(result.inference).toMatchObject({
      status: "passed",
      inferencePerformed: true,
      usage: { inputTokens: 12, outputTokens: 10, reasoningTokens: 8 },
    });
    const stored = await readFile(
      path.join(runtimePaths().config, "provider-evidence-openai.json"),
      "utf8",
    );
    expect(stored).not.toContain(fakeKey);
    expect(stored).not.toContain("Reply with exactly");
    expect(stored).not.toContain('"raw"');
  });
  it("preserves partial usage and never retries an incomplete or failed inference", async () => {
    await configured();
    const verified = await validateProvider(
      "openai",
      { stage: "metadata" },
      metadata(),
    );
    const mock = vi.fn<FetchImplementation>().mockResolvedValue(stream(false));
    const result = await validateProvider(
      "openai",
      {
        stage: "inference",
        confirmPaid: true,
        expectedFingerprint: verified.fingerprint,
      },
      mock,
    );
    expect(mock).toHaveBeenCalledOnce();
    expect(result.inference).toMatchObject({
      status: "incomplete",
      inferencePerformed: true,
      usage: { reasoningTokens: 8 },
    });
  });
  it("invalidates relevant config and key revisions, while reading preferences leave evidence current", async () => {
    const config = await configured();
    const verified = await validateProvider(
      "openai",
      { stage: "metadata" },
      metadata(),
    );
    const changed = await updateConfig(
      { reading: { scale: 1.2 } },
      config.revision,
    );
    expect((await getProviderValidation("openai")).metadata?.id).toBe(
      verified.metadata?.id,
    );
    await updateConfig(
      {
        ai: {
          taskModels: {
            summary: { modelId: "gpt-5.6-sol", reasoningEffort: "low" },
          },
        },
      },
      changed.revision,
    );
    const stale = await getProviderValidation("openai");
    expect(stale.stale).toBe(true);
    expect(stale.metadata).toBeNull();
    await validateProvider("openai", { stage: "metadata" }, metadata());
    await writeCredential("openai", "sk-rotated-synthetic-never-valid");
    expect((await getProviderValidation("openai")).metadata).toBeNull();
    expect((await getProviderModels("openai")).stale).toBe(true);
  });
  it("rechecks config changes during a metadata call and never reports stale success", async () => {
    const config = await configured();
    const mock = vi.fn<FetchImplementation>().mockImplementation(async () => {
      await updateConfig({ network: { localOnly: true } }, config.revision);
      return Response.json({ data: [{ id: "gpt-5.6-sol" }] });
    });
    const result = await validateProvider(
      "openai",
      { stage: "metadata" },
      mock,
    );
    expect(result.metadata).toBeNull();
    expect(result.stale).toBe(true);
  });
  it("honors configured monetary budgets before dispatch", async () => {
    const config = await configured();
    await updateConfig({ ai: { monthlyBudgetUsd: 1 } }, config.revision);
    const verified = await validateProvider(
      "openai",
      { stage: "metadata" },
      metadata(),
    );
    const mock = vi.fn<FetchImplementation>().mockResolvedValue(stream());
    const result = await validateProvider(
      "openai",
      {
        stage: "inference",
        confirmPaid: true,
        expectedFingerprint: verified.fingerprint,
      },
      mock,
    );
    expect(result.inference).toMatchObject({
      status: "blocked",
      code: "PRICE_REQUIRED",
      inferencePerformed: false,
    });
    expect(mock).not.toHaveBeenCalled();
  });
  it("does not resurrect reports when a relevant setting changes away and back", async () => {
    const config = await configured();
    await validateProvider("openai", { stage: "metadata" }, metadata());
    const changed = await updateConfig(
      { network: { localOnly: true } },
      config.revision,
    );
    await updateConfig(
      {
        network: { localOnly: false },
        verificationRevision: config.verificationRevision,
      },
      changed.revision,
    );
    const state = await getProviderValidation("openai");
    expect(state.metadata).toBeNull();
    expect(state.stale).toBe(true);
  });
  it("exposes selectable Claude and native local models after metadata discovery", async () => {
    await writeCredential("anthropic", fakeKey);
    const config = defaultConfig();
    await updateConfig(
      {
        network: { localOnly: false, allowExternalAi: true },
        providers: config.providers.map((p) =>
          p.id === "anthropic"
            ? {
                ...p,
                enabled: true,
                modelId: "claude-synthetic",
                credentialRef: "anthropic",
              }
            : p.id === "ollama"
              ? {
                  ...p,
                  enabled: true,
                  modelId: "synthetic-local",
                  localIsolationVerified: true,
                }
              : p,
        ),
      },
      1,
    );
    const claude = await refreshProviderModels(
      "anthropic",
      metadata(["claude-synthetic"]),
    );
    expect(claude.models[0]).toMatchObject({
      id: "claude-synthetic",
      protocol: "messages",
      selectable: true,
      supportedFunctions: ["summary", "chat", "analysis"],
    });
    const mock = vi.fn<FetchImplementation>().mockImplementation(async (url) =>
      String(url).endsWith("api/tags")
        ? Response.json({
            models: [
              { model: "synthetic-local" },
              { model: "synthetic-embedding" },
            ],
          })
        : Response.json({ capabilities: ["completion", "embedding"] }),
    );
    const local = await refreshProviderModels("ollama", mock);
    expect(mock).toHaveBeenCalledTimes(3);
    expect(
      local.models.every((m) => m.selectable && m.profileSource === "native"),
    ).toBe(true);
    expect(local.models[0]?.supportedFunctions).toContain("embedding");
  });
});
describe("session-only endpoint contracts", () => {
  const ctx = { params: Promise.resolve({ id: "openai" }) };
  it("rejects unauthenticated and bearer-token access with no provider traffic", async () => {
    expect(
      (
        await modelsGET(
          new Request(origin + "/api/v1/providers/openai/models"),
          ctx,
        )
      ).status,
    ).toBe(401);
    const token = await issueAccessToken("Synthetic token", ["library:read"]);
    const response = await validationGET(
      new Request(origin + "/api/v1/providers/openai/validation", {
        headers: { authorization: `Bearer ${token.token}` },
      }),
      ctx,
    );
    expect(response.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("GET and explicit POST keep distinct envelopes and require same-origin mutation", async () => {
    await configured();
    const session = await createSession(
      new Request(origin + "/api/v1/session", {
        method: "POST",
        headers: { origin },
      }),
      "synthetic-bootstrap",
    );
    const headers = {
      cookie: `thesis_session=${session}`,
      origin,
      "content-type": "application/json",
    };
    const response = await modelsGET(
      new Request(origin + "/api/v1/providers/openai/models", { headers }),
      ctx,
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect((await response.json()).data.discoveredAt).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    vi.stubGlobal("fetch", metadata());
    const refreshed = await modelsPOST(
      new Request(origin + "/api/v1/providers/openai/models", {
        method: "POST",
        headers,
        body: "{}",
      }),
      ctx,
    );
    expect((await refreshed.json()).data.discoveredAt).toBeTruthy();
    const verified = await validationPOST(
      new Request(origin + "/api/v1/providers/openai/validation", {
        method: "POST",
        headers,
        body: JSON.stringify({ stage: "metadata" }),
      }),
      ctx,
    );
    expect((await verified.json()).data.metadata.inferencePerformed).toBe(
      false,
    );
    const denied = await validationPOST(
      new Request(origin + "/api/v1/providers/openai/validation", {
        method: "POST",
        headers: { ...headers, origin: "https://untrusted.invalid" },
        body: JSON.stringify({ stage: "inference", confirmPaid: true }),
      }),
      ctx,
    );
    expect(denied.status).toBe(403);
  });
});

it("adapter rejects incompatible reasoning instead of silently omitting it", async () => {
  const mock = vi.fn<FetchImplementation>();
  const adapter = createProviderAdapter(
    {
      adapterId: "lmstudio",
      providerInstanceId: "local",
      endpoint: "http://127.0.0.1:1234/v1",
      enabled: true,
      reasoningEffort: "high",
    },
    { fetch: mock },
  );
  const events: ProviderStreamEvent[] = [];
  for await (const event of adapter.chat(
    {
      modelId: "local-model",
      maxOutputTokens: 10,
      messages: [{ role: "user", content: "x" }],
      requestIdentity: {
        logicalCallId: "synthetic",
        idempotencyKey: "synthetic",
        attempt: 1,
      },
    },
    {},
  ))
    events.push(event);
  expect(events[0]).toMatchObject({
    type: "error",
    error: { code: "CAPABILITY_UNSUPPORTED" },
  });
  expect(mock).not.toHaveBeenCalled();
});
