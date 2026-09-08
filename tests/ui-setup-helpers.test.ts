import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultConfig } from "@thesis/security";
import { ModelSelect } from "../apps/web/src/components/model-select";
import {
  canRunInference,
  choiceIssue,
  finishSetup,
  reportLabel,
  setupStatus,
  type ModelChoice,
  type ProviderValidationState,
  type ValidationReport,
} from "../apps/web/src/lib/setup-models";

const model: ModelChoice = {
  id: "gpt-5.6-sol",
  displayName: "GPT-5.6 Sol",
  available: null,
  supportedFunctions: ["summary", "chat", "analysis"],
  reasoningEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
  protocol: "responses",
  profileSource: "official",
  selectable: true,
};
const report: ValidationReport = {
  id: "synthetic-report",
  stage: "metadata",
  function: "summary",
  fingerprint: "current",
  checkedAt: "2026-09-09T00:00:00.000Z",
  status: "passed",
  modelId: model.id,
  reasoningEffort: "high",
  inferencePerformed: false,
  code: "METADATA_VERIFIED",
  message: "Synthetic metadata only",
};
const validation: ProviderValidationState = {
  providerId: "openai",
  function: "summary",
  fingerprint: "current",
  metadata: report,
  inference: null,
  stale: false,
};

describe("setup completion and preservation", () => {
  it("keeps first launch pending until an explicit completion or defer action", () => {
    const config = defaultConfig();
    expect(setupStatus(config)).toBe("pending");
    expect(config.network.localOnly).toBe(true);
    expect(config.developer.enabled).toBe(false);
  });
  it("defers without overwriting existing policy, provider, task model or reading values", () => {
    const config = defaultConfig();
    config.network.localOnly = false;
    config.ai.paidAiEnabled = true;
    config.reading.scale = 1.37;
    config.providers[0] = {
      ...config.providers[0]!,
      modelId: model.id,
      reasoningEffort: "high",
      credentialRef: "existing-key",
    };
    config.ai.defaults.summary = "openai";
    config.ai.taskModels.chat = { modelId: model.id, reasoningEffort: "high" };
    const result = finishSetup(config, "deferred", report.checkedAt);
    expect(setupStatus(result)).toBe("deferred");
    expect(result.onboarding.completedAt).toBeNull();
    expect(result.onboarding.deferredAt).toBe(report.checkedAt);
    expect(result.providers).toEqual(config.providers);
    expect(result.ai).toEqual(config.ai);
    expect(result.reading).toEqual(config.reading);
    expect(result.network).toEqual(config.network);
    expect(setupStatus(config)).toBe("pending");
  });
  it("local-only completion blocks cloud without clearing keys or model/default selections", () => {
    const config = defaultConfig();
    config.network = {
      localOnly: false,
      allowExternalAi: true,
      allowExternalTranslation: true,
      allowExternalMetadata: true,
    };
    config.ai.paidAiEnabled = true;
    config.providers[0] = {
      ...config.providers[0]!,
      enabled: true,
      modelId: model.id,
      reasoningEffort: "high",
      credentialRef: "retained-key",
    };
    config.ai.defaults.summary = "openai";
    const result = finishSetup(config, "local-only", report.checkedAt);
    expect(result.network).toEqual({
      localOnly: true,
      allowExternalAi: false,
      allowExternalTranslation: false,
      allowExternalMetadata: false,
    });
    expect(result.ai.paidAiEnabled).toBe(false);
    expect(result.ai.defaults).toEqual(config.ai.defaults);
    expect(result.providers).toEqual(config.providers);
    expect(setupStatus(JSON.parse(JSON.stringify(result)))).toBe("completed");
  });
  it("completion clears defer and replay/defer does not erase previous completion", () => {
    const first = finishSetup(defaultConfig(), "deferred", report.checkedAt);
    const complete = finishSetup(first, "completed", report.checkedAt);
    expect(complete.onboarding.deferredAt).toBeNull();
    expect(setupStatus(complete)).toBe("completed");
    const replay = finishSetup(complete, "deferred");
    expect(replay.onboarding.completedAt).toBe(complete.onboarding.completedAt);
    expect(setupStatus(replay)).toBe("completed");
  });
});

describe("model support and separate verification gates", () => {
  it("supports exact requested model/high but does not infer embedding or account access", () => {
    expect(choiceIssue(model, "summary")).toBeNull();
    expect(choiceIssue(model, "embedding")).toContain("지원하지");
    expect(choiceIssue({ ...model, available: false }, "summary")).toContain(
      "찾을 수",
    );
    expect(
      choiceIssue(
        { ...model, selectable: false, reason: "Unknown protocol" },
        "summary",
      ),
    ).toBe("Unknown protocol");
    const html = renderToStaticMarkup(
      createElement(ModelSelect, {
        catalog: {
          providerId: "openai",
          fingerprint: "x",
          discoveredAt: null,
          stale: false,
          models: [model],
        },
        value: model.id,
        reasoningEffort: "high",
        fn: "summary",
        onChange: () => {},
      }),
    );
    expect(html).toContain('value="gpt-5.6-sol" selected=""');
    expect(html).toContain('value="high" selected=""');
    expect(html).toContain("접근 미확인");
  });
  it("preserves unknown existing IDs and efforts with an explanatory warning", () => {
    const html = renderToStaticMarkup(
      createElement(ModelSelect, {
        catalog: null,
        value: "legacy-model",
        reasoningEffort: "high",
        fn: "summary",
        onChange: () => {},
      }),
    );
    expect(html).toContain('value="legacy-model" selected=""');
    expect(html).toContain('value="high" selected=""');
    expect(html).toContain("기존 모델");
    expect(html).toContain("자동 변경하지");
  });
  it("requires current metadata evidence and explicit paid consent", () => {
    expect(canRunInference(null, false, true, true)).toBe(false);
    expect(canRunInference(validation, false, true, false)).toBe(false);
    expect(canRunInference(validation, true, true, true)).toBe(false);
    expect(
      canRunInference(
        { ...validation, stale: true, metadata: null },
        false,
        true,
        true,
      ),
    ).toBe(false);
    expect(
      canRunInference(
        { ...validation, fingerprint: "changed" },
        false,
        true,
        true,
      ),
    ).toBe(false);
    expect(
      canRunInference(
        { ...validation, metadata: { ...report, status: "blocked" } },
        false,
        true,
        true,
      ),
    ).toBe(false);
    expect(canRunInference(validation, false, true, true)).toBe(true);
    expect(
      canRunInference({ ...validation, stale: true }, false, true, true),
    ).toBe(true);
    expect(canRunInference(validation, false, false, false)).toBe(true);
  });
  it("never labels metadata-only or incomplete reports as successful inference", () => {
    expect(reportLabel(report, "metadata")).toContain("추론 미실행");
    expect(reportLabel(report, "inference")).toBe("추론 실행 증거 없음");
    expect(
      reportLabel(
        { ...report, status: "incomplete", inferencePerformed: true },
        "inference",
      ),
    ).toContain("성공 아님");
    expect(
      reportLabel(
        { ...report, stage: "inference", inferencePerformed: true },
        "inference",
      ),
    ).toBe("실제 추론 확인 완료");
  });
});
