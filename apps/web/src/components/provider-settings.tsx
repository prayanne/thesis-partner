"use client";
import { useEffect, useRef, useState } from "react";
import type { AppConfig, ProviderConfig } from "@thesis/security";
import { RefreshCw } from "lucide-react";
import { api, errorText, send, useResource } from "../lib/api";
import {
  canRunInference,
  functionLabels,
  isPaidProvider,
  providerLabels,
  reportLabel,
  type AiFunction,
  type ProviderModelCatalog,
  type ProviderValidationState,
  type ValidationReport,
} from "../lib/setup-models";
import { ModelSelect } from "./model-select";
import { CredentialInput, Toggle, type CredentialStatus } from "./setup-fields";
import styles from "./setup.module.css";

type Props = { config: AppConfig; change: (config: AppConfig) => void };
export function ProviderSettings({
  config,
  change,
  credentials,
  refreshCredentials,
  dirty,
}: Props & {
  credentials: CredentialStatus;
  refreshCredentials: () => Promise<void>;
  dirty: boolean;
}) {
  const [tab, setTab] = useState("local");
  return (
    <>
      <div className="tabs" role="group" aria-label="AI 공급자 종류">
        {[
          ["local", "무료 · 로컬 AI"],
          ["paid", "유료 AI"],
        ].map(([key, label]) => (
          <button
            type="button"
            key={key}
            aria-pressed={tab === key}
            className={tab === key ? "active" : ""}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "paid" && (
        <>
          <div className={styles.callout}>
            OpenAI API는 ChatGPT·Codex 구독과 별도 요금입니다. 요청 모델은{" "}
            <strong>gpt-5.6-sol / high</strong>이며, 접근할 수 없으면 그대로
            실패를 표시합니다. 계정 접근을 확인하지 않고 다른 모델로 바꾸지
            않습니다.
          </div>
          <Toggle
            title="유료 AI 사용 허용"
            description="별도의 외부 AI 연결 허용과 공급자 활성화가 필요합니다."
            checked={config.ai.paidAiEnabled}
            onChange={(value) =>
              change({ ...config, ai: { ...config.ai, paidAiEnabled: value } })
            }
          />
        </>
      )}
      {tab === "local" && (
        <p className="form-hint">
          이미 실행 중인 Ollama·LM Studio의 모델을 선택합니다. 목록을
          새로고침해도 모델 다운로드나 설치를 실행하지 않습니다.
        </p>
      )}
      {config.providers
        .filter((provider) => isPaidProvider(provider) === (tab === "paid"))
        .map((provider) => (
          <ProviderCard
            key={provider.id}
            provider={provider}
            revision={config.revision}
            status={credentials[provider.credentialRef ?? provider.id]}
            change={(next) =>
              change({
                ...config,
                providers: config.providers.map((value) =>
                  value.id === provider.id ? next : value,
                ),
              })
            }
            refreshCredentials={refreshCredentials}
            dirty={dirty}
          />
        ))}
    </>
  );
}

function ProviderCard({
  provider: p,
  revision,
  status,
  change,
  refreshCredentials,
  dirty,
}: {
  provider: ProviderConfig;
  revision: number;
  status?: { configured: boolean; revision: number };
  change: (provider: ProviderConfig) => void;
  refreshCredentials: () => Promise<void>;
  dirty: boolean;
}) {
  const catalog = useResource<ProviderModelCatalog>(
    `/providers/${encodeURIComponent(p.id)}/models`,
  );
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    catalog.reload();
  }, [revision, status?.revision, catalog.reload]);
  async function refresh() {
    setRefreshing(true);
    setError("");
    try {
      catalog.setData(
        await send<ProviderModelCatalog>(
          `/providers/${encodeURIComponent(p.id)}/models`,
          "POST",
          {},
        ),
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setRefreshing(false);
    }
  }
  return (
    <div
      className="provider-card"
      role="group"
      aria-label={`${providerLabels[p.adapterId]} 공급자`}
    >
      <header>
        <h3>{providerLabels[p.adapterId]}</h3>
        <span className="status-pill">
          {p.enabled ? "사용 설정됨" : "사용 안 함"}
        </span>
      </header>
      <Toggle
        title="이 공급자 사용"
        description="공급자와 모델을 저장한 뒤 필요한 기능에 지정하세요."
        checked={p.enabled}
        onChange={(enabled) => change({ ...p, enabled })}
      />
      <label>
        연결 주소
        <input
          value={p.endpoint}
          readOnly={isPaidProvider(p)}
          onChange={(event) =>
            change({
              ...p,
              endpoint: event.target.value,
              localIsolationVerified: false,
            })
          }
        />
      </label>
      {!isPaidProvider(p) && (
        <Toggle
          title="호스트 AI의 원격 실행이 꺼진 것을 확인했습니다"
          description="Cloud 모델과 LM Link 등 원격 실행을 호스트에서 직접 확인하세요. 사용자 확인 항목이며 자동 검증이 아닙니다."
          checked={p.localIsolationVerified ?? false}
          onChange={(value) => change({ ...p, localIsolationVerified: value })}
        />
      )}
      <div className={styles.actions}>
        <button
          className="button small"
          type="button"
          disabled={dirty || refreshing}
          onClick={() => void refresh()}
        >
          <RefreshCw size={12} />
          {refreshing ? "목록 조회 중…" : "모델 목록 새로고침"}
        </button>
        <small>
          {catalog.data?.discoveredAt
            ? `마지막 조회 ${new Date(catalog.data.discoveredAt).toLocaleString("ko-KR")}`
            : "아직 공급자 목록을 조회하지 않았습니다."}
        </small>
      </div>
      {dirty && (
        <p className={styles.warning}>
          변경한 설정을 먼저 저장하세요. 목록 새로고침과 검증은 저장된
          설정으로만 실행합니다.
        </p>
      )}
      {(error || catalog.error) && (
        <p role="alert" className="inline-error">
          {error || errorText(catalog.error)}
        </p>
      )}
      {catalog.loading && (
        <p role="status" className="form-hint">
          저장된 모델 목록과 지원 프로필을 읽고 있습니다…
        </p>
      )}
      <ModelSelect
        catalog={catalog.data}
        value={p.modelId}
        reasoningEffort={p.reasoningEffort}
        fn="summary"
        label="기본 생성 모델"
        onChange={(modelId, reasoningEffort) =>
          change({ ...p, modelId, reasoningEffort })
        }
      />
      <ModelSelect
        catalog={catalog.data}
        value={p.embeddingModelId}
        fn="embedding"
        label="임베딩 모델"
        onChange={(embeddingModelId) => change({ ...p, embeddingModelId })}
      />
      <details>
        <summary>모델 버전 정보</summary>
        <label>
          모델 버전
          <input
            value={p.modelRevision}
            placeholder="기존 revision 또는 버전 표기"
            onChange={(event) =>
              change({ ...p, modelRevision: event.target.value })
            }
          />
        </label>
      </details>
      <CredentialInput
        id={p.credentialRef ?? p.id}
        status={status}
        done={async () => {
          if (!p.credentialRef) change({ ...p, credentialRef: p.id });
          await refreshCredentials();
        }}
      />
      <ProviderVerification
        provider={p}
        revision={revision}
        credentialRevision={status?.revision ?? 0}
        dirty={dirty}
        onMetadata={catalog.reload}
      />
    </div>
  );
}

export function ProviderVerification({
  provider,
  revision,
  credentialRevision,
  dirty,
  onMetadata,
}: {
  provider: ProviderConfig;
  revision: number;
  credentialRevision: number;
  dirty: boolean;
  onMetadata: () => void;
}) {
  const [fn, setFunction] = useState<AiFunction>("summary");
  const [state, setState] = useState<ProviderValidationState | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [consent, setConsent] = useState(false);
  const paid = isPaidProvider(provider);
  const requestContext = `${provider.id}:${revision}:${credentialRevision}:${fn}`;
  const currentContext = useRef(requestContext);
  useEffect(() => {
    currentContext.current = requestContext;
  }, [requestContext]);
  useEffect(() => {
    const controller = new AbortController();
    setState(null);
    setConsent(false);
    setError("");
    setLoading(true);
    api<ProviderValidationState>(
      `/providers/${encodeURIComponent(provider.id)}/validation?function=${fn}`,
      { signal: controller.signal },
    )
      .then((value) => {
        if (!controller.signal.aborted) setState(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorText(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [provider.id, revision, credentialRevision, fn]);
  useEffect(() => {
    setConsent(false);
  }, [dirty]);
  async function validate(stage: "metadata" | "inference") {
    if (stage === "inference" && !canRunInference(state, dirty, paid, consent))
      return;
    setBusy(true);
    setError("");
    const startedContext = currentContext.current;
    try {
      const value = await send<ProviderValidationState>(
        `/providers/${encodeURIComponent(provider.id)}/validation`,
        "POST",
        {
          stage,
          function: fn,
          ...(stage === "inference"
            ? {
                expectedFingerprint: state?.fingerprint,
                ...(paid ? { confirmPaid: true } : {}),
              }
            : {}),
        },
      );
      if (currentContext.current === startedContext) {
        setState(value);
        if (stage === "metadata") onMetadata();
      }
    } catch (e) {
      if (currentContext.current === startedContext) setError(errorText(e));
    } finally {
      setBusy(false);
      setConsent(false);
    }
  }
  const evidence = dirty ? null : state;
  return (
    <section
      className={styles.gates}
      aria-label={`${providerLabels[provider.adapterId]} 검증`}
    >
      <h4>연결과 실제 추론 확인</h4>
      <label>
        검증할 기능
        <select
          value={fn}
          disabled={busy}
          onChange={(event) => setFunction(event.target.value as AiFunction)}
        >
          {Object.entries(functionLabels).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <p className="form-hint">
        선택한 기능의 저장된 모델·추론 강도·키·정책을 확인합니다. 설정이나 키를
        바꾸면 이전 검증 결과를 다시 사용할 수 없습니다.
      </p>
      {(dirty || state?.stale) && (
        <p className={styles.warning}>
          설정 변경 전의 검증 결과는 무효화되었습니다. 저장된 현재 설정으로 각
          단계를 다시 확인하세요.
        </p>
      )}
      <div className={styles.gate}>
        <strong>1. 정책·키·모델·지원 매개변수</strong>
        <ValidationResult
          report={evidence?.metadata ?? null}
          stage="metadata"
        />
        <button
          type="button"
          className="button small"
          disabled={dirty || busy || loading}
          onClick={() => void validate("metadata")}
        >
          메타데이터 검증 · 추론 없음
        </button>
      </div>
      <div className={styles.gate}>
        <strong>2. 실제 {paid ? "유료 " : "로컬 "}추론</strong>
        <ValidationResult
          report={evidence?.inference ?? null}
          stage="inference"
        />
        <p>
          짧은 합성 입력 1회 · 최대 출력 512토큰 · 자동 재시도 없음
          {provider.adapterId === "openai" ? " · 표준 서비스 등급" : ""}. 논문
          본문은 보내지 않습니다.
        </p>
        {paid && (
          <label className={styles.consent}>
            <input
              type="checkbox"
              checked={consent}
              disabled={
                dirty || busy || evidence?.metadata?.status !== "passed"
              }
              onChange={(event) => setConsent(event.target.checked)}
            />
            <span>
              API 비용이 발생할 수 있는 추론 검증 1회 실행에 동의합니다.
              ChatGPT·Codex 구독과 별도 청구입니다.
            </span>
          </label>
        )}
        <button
          type="button"
          className="button small"
          disabled={
            busy || loading || !canRunInference(evidence, dirty, paid, consent)
          }
          onClick={() => void validate("inference")}
        >
          {paid ? "유료 추론 1회 실행" : "로컬 추론 1회 실행"}
        </button>
        {evidence?.metadata?.status !== "passed" && (
          <p className="form-hint">
            현재 설정의 메타데이터 검증이 통과해야 실행할 수 있습니다.
          </p>
        )}
      </div>
      {loading && (
        <p role="status" className="form-hint">
          저장된 검증 상태를 확인하고 있습니다…
        </p>
      )}
      {busy && (
        <p role="status" className="form-hint">
          요청한 검증을 실행하고 있습니다…
        </p>
      )}
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
    </section>
  );
}

function ValidationResult({
  report,
  stage,
}: {
  report: ValidationReport | null;
  stage: "metadata" | "inference";
}) {
  return (
    <div role="status">
      <p>
        <strong>{reportLabel(report, stage)}</strong>
      </p>
      {report && (
        <>
          <p>{report.message}</p>
          <p>
            {report.modelId}
            {report.reasoningEffort
              ? ` / ${report.reasoningEffort}`
              : ""} · {new Date(report.checkedAt).toLocaleString("ko-KR")}
          </p>
          {report.usage && (
            <p>
              사용량: 입력 {report.usage.inputTokens ?? "—"} · 출력{" "}
              {report.usage.outputTokens ?? "—"} · 추론{" "}
              {report.usage.reasoningTokens ?? "—"} 토큰
            </p>
          )}
        </>
      )}
    </div>
  );
}

export function FunctionDefaults({ config, change }: Props) {
  return (
    <div>
      {(Object.keys(functionLabels) as AiFunction[]).map((fn) => (
        <FunctionDefault key={fn} fn={fn} config={config} change={change} />
      ))}
    </div>
  );
}
function FunctionDefault({ fn, config, change }: Props & { fn: AiFunction }) {
  const providerId = config.ai.defaults[fn];
  const provider = config.providers.find((value) => value.id === providerId);
  const catalog = useResource<ProviderModelCatalog>(
    provider ? `/providers/${encodeURIComponent(provider.id)}/models` : null,
  );
  useEffect(() => {
    catalog.reload();
  }, [config.revision, catalog.reload]);
  const override = config.ai.taskModels?.[fn];
  return (
    <div className={styles.task}>
      <h3>{functionLabels[fn]}</h3>
      <label>
        {functionLabels[fn]} 공급자
        <select
          value={providerId ?? ""}
          onChange={(event) =>
            change({
              ...config,
              ai: {
                ...config.ai,
                defaults: {
                  ...config.ai.defaults,
                  [fn]: event.target.value || null,
                },
                ...(event.target.value
                  ? {}
                  : { taskModels: { ...config.ai.taskModels, [fn]: null } }),
              },
            })
          }
        >
          <option value="">선택 안 함 · 나중에 설정</option>
          {providerId && !provider && (
            <option value={providerId}>{providerId} · 기존 공급자 없음</option>
          )}
          {config.providers.map((value) => (
            <option key={value.id} value={value.id}>
              {providerLabels[value.adapterId]} ({value.id})
              {value.enabled ? "" : " · 비활성"}
            </option>
          ))}
        </select>
      </label>
      {provider && (
        <>
          <ModelSelect
            catalog={catalog.data}
            fn={fn}
            value={override?.modelId ?? ""}
            reasoningEffort={override?.reasoningEffort}
            label={`${functionLabels[fn]} 모델`}
            inheritLabel={`공급자 기본값 사용 · ${(fn === "embedding" ? provider.embeddingModelId : provider.modelId) || "미선택"}${fn !== "embedding" && provider.reasoningEffort ? ` / ${provider.reasoningEffort}` : ""}`}
            onChange={(modelId, reasoningEffort) =>
              change({
                ...config,
                ai: {
                  ...config.ai,
                  taskModels: {
                    ...config.ai.taskModels,
                    [fn]: modelId
                      ? {
                          modelId,
                          ...(fn !== "embedding" && reasoningEffort
                            ? { reasoningEffort }
                            : {}),
                        }
                      : null,
                  },
                },
              })
            }
          />
          {!provider.enabled && (
            <p className={styles.warning}>
              이 공급자는 비활성 상태입니다. 공급자 단계에서 직접 활성화해야 이
              기능을 사용할 수 있습니다.
            </p>
          )}
          {catalog.error && (
            <p className="inline-error" role="alert">
              {errorText(catalog.error)}
            </p>
          )}
        </>
      )}
    </div>
  );
}
