import type { AppConfig, ProviderConfig } from "@thesis/security";

import type { AiFunction, ModelChoice } from "@thesis/providers";
import type {
  ProviderValidationState,
  ValidationReport,
} from "../../../../packages/security/src/verification-types";
export type {
  AiFunction,
  ModelChoice,
  ReasoningEffort,
} from "@thesis/providers";
export type { ProviderModelCatalog } from "../../../../packages/security/src/provider-verification";
export type {
  ProviderValidationState,
  ValidationReport,
} from "../../../../packages/security/src/verification-types";
export const functionLabels: Record<AiFunction, string> = {
  summary: "요약",
  chat: "질문",
  analysis: "분석",
  embedding: "임베딩",
};
export const providerLabels = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  ollama: "Ollama",
  lmstudio: "LM Studio",
};
export function isPaidProvider(provider: ProviderConfig) {
  return provider.adapterId === "openai" || provider.adapterId === "anthropic";
}
export function choiceIssue(model: ModelChoice, fn: AiFunction) {
  if (!model.selectable)
    return model.reason || "지원 프로필이 확인되지 않았습니다.";
  if (!model.supportedFunctions.includes(fn))
    return `${functionLabels[fn]} 기능을 지원하지 않습니다.`;
  if (model.available === false)
    return "현재 계정 또는 로컬 설치에서 찾을 수 없습니다.";
  return null;
}
export function canRunInference(
  state: ProviderValidationState | null,
  dirty: boolean,
  paid: boolean,
  consent: boolean,
) {
  return (
    !dirty &&
    (!paid || consent) &&
    !!state &&
    state.metadata?.status === "passed" &&
    state.metadata.fingerprint === state.fingerprint
  );
}
export function reportLabel(
  report: ValidationReport | null,
  stage: "metadata" | "inference",
) {
  if (!report) return "미검증";
  if (report.status === "passed")
    return stage === "inference"
      ? report.inferencePerformed
        ? "실제 추론 확인 완료"
        : "추론 실행 증거 없음"
      : "메타데이터 확인 완료 · 추론 미실행";
  return {
    blocked: "정책·설정 확인 필요",
    failed: "검증 실패",
    incomplete: "응답 미완료 · 추론 성공 아님",
  }[report.status];
}
export function setupStatus(
  config: AppConfig,
): "pending" | "deferred" | "completed" {
  if (config.onboarding?.completedAt) return "completed";
  if (config.onboarding?.deferredAt) return "deferred";
  return "pending";
}
export function finishSetup(
  config: AppConfig,
  mode: "completed" | "local-only" | "deferred",
  now = new Date().toISOString(),
): AppConfig {
  if (mode === "deferred")
    return { ...config, onboarding: { ...config.onboarding, deferredAt: now } };
  return {
    ...config,
    onboarding: { ...config.onboarding, completedAt: now, deferredAt: null },
    ...(mode === "local-only"
      ? {
          network: {
            ...config.network,
            localOnly: true,
            allowExternalAi: false,
            allowExternalTranslation: false,
            allowExternalMetadata: false,
          },
          ai: { ...config.ai, paidAiEnabled: false },
        }
      : {}),
  };
}
