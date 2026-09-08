import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { defaultConfig, type AppConfig } from "@thesis/security";
import type {
  AiFunction,
  ProviderModelCatalog,
  ProviderValidationState,
  ValidationReport,
} from "../apps/web/src/lib/setup-models";

// Every API request is intercepted. No bootstrap token, live config, or provider is read.
const base = process.env.UI_TEST_URL ?? "http://127.0.0.1:3000";
test.use({ baseURL: base, viewport: { width: 1440, height: 1050 } });
function fixture(): AppConfig {
  const value = defaultConfig();
  value.general.displayName = "보존할 연구 공간";
  value.reading.scale = 1.37;
  value.providers[0] = {
    ...value.providers[0]!,
    modelId: "gpt-5.6-sol",
    reasoningEffort: "high",
    credentialRef: "openai",
    enabled: true,
  };
  value.ai.defaults.summary = "openai";
  value.ai.defaults.chat = "openai";
  return value;
}
async function mockedApi(
  context: BrowserContext,
  initial = fixture(),
  initialAuth = true,
) {
  let config = structuredClone(initial);
  let authenticated = initialAuth;
  let credentialRevision = 1;
  const writes: {
    path: string;
    method: string;
    body: Record<string, unknown>;
  }[] = [];
  const reads: string[] = [];
  const reports = new Map<string, ProviderValidationState>();
  const fingerprint = () => `${config.revision}:${credentialRevision}`;
  const emptyState = (
    providerId: string,
    fn: AiFunction,
  ): ProviderValidationState => ({
    providerId,
    function: fn,
    fingerprint: fingerprint(),
    metadata: null,
    inference: null,
    stale: false,
  });
  await context.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/v1", "");
    const method = request.method();
    const body = method === "GET" ? {} : (request.postDataJSON() ?? {});
    if (method === "GET") reads.push(path);
    else writes.push({ path, method, body });
    const ok = (data: unknown, meta?: unknown) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data, ...(meta ? { meta } : {}) }),
      });
    if (path === "/session") {
      if (method === "POST") authenticated = true;
      if (method === "DELETE") authenticated = false;
      return ok({ authenticated });
    }
    if (path === "/config") {
      if (method === "PATCH") {
        if (body.expectedRevision !== config.revision)
          return route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({
              error: {
                code: "CONFLICT",
                message: "Synthetic revision conflict",
              },
            }),
          });
        config = { ...config, ...body.patch, revision: config.revision + 1 };
      }
      return ok(config, {
        credentials: {
          openai: { configured: true, revision: credentialRevision },
          "google-translation": { configured: true, revision: 2 },
        },
      });
    }
    if (path.startsWith("/credentials/")) {
      credentialRevision += 1;
      return ok({
        configured: method !== "DELETE",
        revision: credentialRevision,
      });
    }
    const match = path.match(/^\/providers\/([^/]+)\/(models|validation)$/);
    if (match) {
      const [, providerId, resource] = match;
      if (resource === "models") {
        const data: ProviderModelCatalog = {
          providerId,
          fingerprint: fingerprint(),
          discoveredAt: method === "POST" ? "2026-09-09T00:00:00.000Z" : null,
          stale: false,
          models:
            providerId === "openai"
              ? [
                  {
                    id: "gpt-5.6-sol",
                    displayName: "GPT-5.6 Sol",
                    available: null,
                    supportedFunctions: ["summary", "chat", "analysis"],
                    reasoningEfforts: [
                      "none",
                      "low",
                      "medium",
                      "high",
                      "xhigh",
                      "max",
                    ],
                    protocol: "responses",
                    profileSource: "official",
                    selectable: true,
                  },
                  {
                    id: "text-embedding-3-small",
                    displayName: "text-embedding-3-small",
                    available: true,
                    supportedFunctions: ["embedding"],
                    reasoningEfforts: [],
                    protocol: "embeddings",
                    profileSource: "official",
                    selectable: true,
                  },
                  {
                    id: "unsupported-discovered-model",
                    displayName: "unsupported-discovered-model",
                    available: true,
                    supportedFunctions: [],
                    reasoningEfforts: [],
                    protocol: "unknown",
                    profileSource: "unknown",
                    selectable: false,
                    reason: "지원 프로필 없음",
                  },
                ]
              : [],
        };
        return ok(data);
      }
      const fn = (body.function ??
        url.searchParams.get("function") ??
        "summary") as AiFunction;
      const key = `${providerId}:${fn}`;
      let state = reports.get(key) ?? emptyState(providerId, fn);
      if (state.fingerprint !== fingerprint())
        state = { ...emptyState(providerId, fn), stale: true };
      if (method === "POST") {
        const stage = body.stage as "metadata" | "inference";
        const report: ValidationReport = {
          id: "synthetic-report",
          stage,
          function: fn,
          fingerprint: fingerprint(),
          checkedAt: "2026-09-09T00:00:00.000Z",
          status: "passed",
          modelId: "gpt-5.6-sol",
          reasoningEffort: "high",
          inferencePerformed: stage === "inference",
          code:
            stage === "metadata" ? "METADATA_VERIFIED" : "INFERENCE_VERIFIED",
          message:
            stage === "metadata"
              ? "합성 메타데이터 확인. 추론 없음."
              : "합성 추론 응답 확인.",
          ...(stage === "inference"
            ? {
                usage: { inputTokens: 3, outputTokens: 4 },
                maxOutputTokens: 512,
                serviceTier: "default" as const,
              }
            : {}),
        };
        state = {
          ...state,
          fingerprint: fingerprint(),
          stale: false,
          [stage]: report,
        };
        reports.set(key, state);
      }
      return ok(state);
    }
    return ok([]);
  });
  return {
    get config() {
      return config;
    },
    writes,
    reads,
  };
}
async function paidCard(page: Page) {
  await page.getByRole("button", { name: "AI 공급자", exact: true }).click();
  await page.getByRole("button", { name: "유료 AI", exact: true }).click();
  return page.getByLabel("OpenAI 공급자", { exact: true });
}

test("first authenticated launch performs no provider POST and deferred setup persists", async ({
  context,
  page,
}) => {
  const state = await mockedApi(context, fixture(), false);
  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { name: "내 작업 공간 열기" }),
  ).toBeVisible();
  expect(state.reads).not.toContain("/config");
  await page
    .getByLabel("접속 토큰", { exact: true })
    .fill("synthetic-login-token");
  await page
    .getByRole("button", { name: "작업 공간 열기", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "연구 공간 첫 설정" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /공급자·API 키/ }).click();
  await dialog.getByRole("button", { name: "유료 AI", exact: true }).click();
  await expect(
    dialog
      .getByLabel("OpenAI 공급자", { exact: true })
      .getByLabel("기본 생성 모델", { exact: true }),
  ).toHaveValue("gpt-5.6-sol");
  await dialog.getByRole("button", { name: /읽기 환경/ }).click();
  await dialog.getByLabel("작업 공간 이름").fill("저장하지 않을 편집");
  expect(
    state.writes.filter((write) => write.path.startsWith("/providers/")),
  ).toEqual([]);
  await dialog
    .getByRole("button", { name: "나중에 설정", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  expect(state.config.general.displayName).toBe("보존할 연구 공간");
  expect(state.config.onboarding.completedAt).toBeNull();
  expect(state.config.onboarding.deferredAt).toBeTruthy();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "첫 설정 계속하기" }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(state.config.network.localOnly).toBe(true);
  expect(state.config.ai.paidAiEnabled).toBe(false);
  expect(
    state.writes.filter((write) => write.path.startsWith("/providers/")),
  ).toEqual([]);
});

test("local-only completion retains values across pages and developer replay uses the same wizard", async ({
  context,
  page,
}) => {
  const initial = fixture();
  initial.network = {
    localOnly: false,
    allowExternalAi: true,
    allowExternalTranslation: true,
    allowExternalMetadata: true,
  };
  initial.ai.paidAiEnabled = true;
  const state = await mockedApi(context, initial);
  await page.goto("/settings");
  const dialog = page.getByRole("dialog", { name: "연구 공간 첫 설정" });
  await dialog.getByRole("button", { name: "로컬 전용으로 완료" }).click();
  await expect(dialog).not.toBeVisible();
  expect(state.config.providers).toEqual(initial.providers);
  expect(state.config.ai.defaults).toEqual(initial.ai.defaults);
  expect(state.config.network).toEqual({
    localOnly: true,
    allowExternalAi: false,
    allowExternalTranslation: false,
    allowExternalMetadata: false,
  });
  expect(state.config.ai.paidAiEnabled).toBe(false);
  const completedAt = state.config.onboarding.completedAt;
  const secondPage = await context.newPage();
  await secondPage.goto("/settings");
  await expect(
    secondPage.getByRole("heading", { name: "나의 읽기 환경" }),
  ).toBeVisible();
  await expect(secondPage.getByRole("dialog")).toHaveCount(0);
  await expect(
    secondPage.getByRole("button", { name: "첫 설정 다시 열기" }),
  ).toHaveCount(0);
  await secondPage.getByLabel("개발자 모드 사용").check();
  await expect(
    secondPage.getByRole("button", { name: "첫 설정 다시 열기" }),
  ).toBeDisabled();
  await secondPage
    .getByRole("button", { name: "변경 저장", exact: true })
    .click();
  await secondPage.getByRole("button", { name: "첫 설정 다시 열기" }).click();
  const replay = secondPage.getByRole("dialog", { name: "연구 공간 첫 설정" });
  await expect(replay).toBeVisible();
  await replay.getByRole("button", { name: /읽기 환경/ }).click();
  await expect(replay.getByLabel("작업 공간 이름")).toHaveValue(
    initial.general.displayName,
  );
  await expect(replay.getByLabel("PDF 기본 확대")).toHaveValue("1.37");
  await replay
    .getByRole("button", { name: "나중에 설정", exact: true })
    .click();
  expect(state.config.onboarding.completedAt).toBe(completedAt);
  expect(state.config.providers).toEqual(initial.providers);
  expect(
    state.writes.filter(
      (write) =>
        write.path.startsWith("/providers/") ||
        write.path.startsWith("/credentials/"),
    ),
  ).toEqual([]);
  await secondPage.close();
});

test("normal completion persists reading edits and does not auto-enable paid services", async ({
  context,
  page,
}) => {
  const state = await mockedApi(context);
  await page.goto("/settings");
  const dialog = page.getByRole("dialog", { name: "연구 공간 첫 설정" });
  for (let step = 0; step < 3; step++)
    await dialog.getByRole("button", { name: "다음", exact: true }).click();
  await dialog.getByLabel("작업 공간 이름").fill("완료한 연구 공간");
  await dialog.getByLabel("PDF 기본 확대").selectOption("1.5");
  await dialog.getByRole("button", { name: "설정 완료", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await expect(page.getByLabel("작업 공간 이름")).toHaveValue(
    "완료한 연구 공간",
  );
  expect(state.config.onboarding.completedAt).toBeTruthy();
  expect(state.config.reading.scale).toBe(1.5);
  expect(state.config.ai.paidAiEnabled).toBe(false);
  expect(
    state.writes.filter((write) => write.path.startsWith("/providers/")),
  ).toEqual([]);
});

test("catalog selection and paid inference require separate current metadata and consent; key changes invalidate evidence", async ({
  context,
  page,
}) => {
  const initial = fixture();
  initial.onboarding.completedAt = "2026-09-09T00:00:00.000Z";
  const state = await mockedApi(context, initial);
  await page.goto("/settings");
  const card = await paidCard(page);
  await expect(card.getByLabel("기본 생성 모델", { exact: true })).toHaveValue(
    "gpt-5.6-sol",
  );
  await expect(card.getByLabel("추론 강도", { exact: true })).toHaveValue(
    "high",
  );
  await expect(
    card
      .getByLabel("기본 생성 모델", { exact: true })
      .locator('option[value="unsupported-discovered-model"]'),
  ).toBeDisabled();
  await expect(
    card
      .getByLabel("임베딩 모델", { exact: true })
      .locator('option[value="gpt-5.6-sol"]'),
  ).toBeDisabled();
  const infer = card.getByRole("button", { name: "유료 추론 1회 실행" });
  await expect(infer).toBeDisabled();
  expect(state.writes).toEqual([]);
  await card
    .getByRole("button", { name: "메타데이터 검증 · 추론 없음" })
    .click();
  await expect(
    card.getByText("메타데이터 확인 완료 · 추론 미실행", { exact: true }),
  ).toBeVisible();
  await expect(infer).toBeDisabled();
  await card.getByLabel(/API 비용이 발생할 수 있는 추론 검증/).check();
  await expect(infer).toBeEnabled();
  await infer.click();
  await expect(
    card.getByText("실제 추론 확인 완료", { exact: true }),
  ).toBeVisible();
  const requests = state.writes.filter((write) =>
    write.path.endsWith("/validation"),
  );
  expect(requests).toHaveLength(2);
  expect(requests[0].body).toEqual({ stage: "metadata", function: "summary" });
  expect(requests[1].body).toEqual({
    stage: "inference",
    function: "summary",
    expectedFingerprint: "1:1",
    confirmPaid: true,
  });
  await expect(
    card.locator('.credential-form input[type="password"]'),
  ).toHaveValue("");
  await card
    .locator('.credential-form input[type="password"]')
    .fill("synthetic-replacement-key");
  await card.getByRole("button", { name: "비밀값 저장", exact: true }).click();
  await expect(
    card.locator('.credential-form input[type="password"]'),
  ).toHaveValue("");
  await expect(
    card.getByText("실제 추론 확인 완료", { exact: true }),
  ).toHaveCount(0);
  await expect(infer).toBeDisabled();
  await card.getByLabel("추론 강도", { exact: true }).selectOption("medium");
  await expect(
    card.getByRole("button", { name: "메타데이터 검증 · 추론 없음" }),
  ).toBeDisabled();
  await expect(
    card.getByRole("button", { name: "모델 목록 새로고침" }),
  ).toBeDisabled();
  expect(state.config.providers[0].reasoningEffort).toBe("high");
});

test("per-function model edits and deselection retain the other function and provider defaults", async ({
  context,
  page,
}) => {
  const initial = fixture();
  initial.onboarding.completedAt = "2026-09-09T00:00:00.000Z";
  initial.ai.taskModels.chat = {
    modelId: "gpt-5.6-sol",
    reasoningEffort: "high",
  };
  const state = await mockedApi(context, initial);
  await page.goto("/settings");
  await page.getByRole("button", { name: "AI 공급자", exact: true }).click();
  const summarySelect = page.getByRole("combobox", {
    name: "요약 모델",
    exact: true,
  });
  await summarySelect.selectOption("gpt-5.6-sol");
  const summarySection = summarySelect.locator("xpath=../..");
  await summarySection
    .getByRole("combobox", { name: "추론 강도", exact: true })
    .selectOption("medium");
  await page.getByRole("button", { name: "변경 저장", exact: true }).click();
  await expect(
    page.getByText("설정을 저장했습니다. 생성 요청은 실행하지 않았습니다.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(state.config.ai.taskModels.summary).toEqual({
    modelId: "gpt-5.6-sol",
    reasoningEffort: "medium",
  });
  expect(state.config.ai.taskModels.chat).toEqual(initial.ai.taskModels.chat);
  expect(state.config.providers).toEqual(initial.providers);
  await page
    .getByRole("combobox", { name: "요약 공급자", exact: true })
    .selectOption("");
  await page.getByRole("button", { name: "변경 저장", exact: true }).click();
  await expect(
    page.getByText("설정을 저장했습니다. 생성 요청은 실행하지 않았습니다.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(state.config.ai.defaults.summary).toBeNull();
  expect(state.config.ai.taskModels.summary).toBeNull();
  expect(state.config.ai.taskModels.chat).toEqual(initial.ai.taskModels.chat);
  expect(
    state.writes.filter((write) => write.path.startsWith("/providers/")),
  ).toEqual([]);
});

test("revision conflicts preserve the draft and Later safely retains newer saved settings", async ({
  context,
  page,
}) => {
  const state = await mockedApi(context);
  await page.goto("/settings");
  const dialog = page.getByRole("dialog", { name: "연구 공간 첫 설정" });
  await dialog.getByRole("button", { name: /읽기 환경/ }).click();
  await dialog.getByLabel("작업 공간 이름").fill("보존할 초안");
  state.config.revision += 1;
  state.config.general.displayName = "다른 세션의 최신 값";
  await dialog.getByRole("button", { name: "설정 완료", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Synthetic revision conflict",
  );
  await expect(dialog.getByLabel("작업 공간 이름")).toHaveValue("보존할 초안");
  await dialog
    .getByRole("button", { name: "나중에 설정", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  expect(state.config.general.displayName).toBe("다른 세션의 최신 값");
  expect(state.config.onboarding.deferredAt).toBeTruthy();
});
