"use client";
import { useId } from "react";
import {
  choiceIssue,
  functionLabels,
  type AiFunction,
  type ProviderModelCatalog,
  type ReasoningEffort,
} from "../lib/setup-models";
import styles from "./setup.module.css";

export function ModelSelect({
  catalog,
  value,
  reasoningEffort,
  fn,
  onChange,
  label = "모델",
  inheritLabel,
}: {
  catalog: ProviderModelCatalog | null;
  value: string;
  reasoningEffort?: ReasoningEffort;
  fn: AiFunction;
  onChange: (modelId: string, reasoningEffort?: ReasoningEffort) => void;
  label?: string;
  inheritLabel?: string;
}) {
  const id = useId();
  const models = catalog?.models ?? [];
  const selected = models.find((model) => model.id === value);
  const missing = !!value && !selected;
  const issue = selected
    ? choiceIssue(selected, fn)
    : missing
      ? "현재 목록에 없는 기존 모델입니다. 값을 유지했으며, 사용 전 목록과 지원 여부를 확인하세요."
      : null;
  const invalidEffort =
    !!reasoningEffort && !selected?.reasoningEfforts.includes(reasoningEffort);
  return (
    <div className={styles.model}>
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value}
        aria-describedby={`${id}-detail`}
        onChange={(event) => onChange(event.target.value, reasoningEffort)}
      >
        <option value="">{inheritLabel || "모델 선택 안 함"}</option>
        {missing && (
          <option value={value}>{value} · 기존 값 / 목록 미확인</option>
        )}
        {models.map((model) => {
          const reason = choiceIssue(model, fn);
          return (
            <option key={model.id} value={model.id} disabled={!!reason}>
              {model.displayName}
              {model.displayName !== model.id ? ` (${model.id})` : ""}
              {reason
                ? ` · ${reason}`
                : model.available === null
                  ? " · 접근 미확인"
                  : " · 목록 확인됨"}
            </option>
          );
        })}
      </select>
      <div id={`${id}-detail`}>
        {issue && <p className={styles.warning}>{issue}</p>}
        {selected && (
          <div className={styles.modelInfo}>
            <span className={styles.badge}>{selected.protocol}</span>
            <span className={styles.badge}>
              {selected.profileSource === "official"
                ? "공식 지원 프로필"
                : selected.profileSource === "native"
                  ? "로컬 기능 정보"
                  : "지원 미확인"}
            </span>
            <span className={styles.badge}>
              {selected.supportedFunctions
                .map((key) => functionLabels[key])
                .join(" · ") || "지원 기능 미확인"}
            </span>
          </div>
        )}
        {selected?.available === null && (
          <p className="form-hint">
            지원 프로필만 확인된 상태입니다. 계정 접근과 설치 여부는 목록
            새로고침·메타데이터 검증으로 확인하세요.
          </p>
        )}
        {catalog?.stale && (
          <p className={styles.warning}>
            설정 또는 키가 변경되어 이전 목록이 오래된 상태입니다. 저장 후
            목록을 새로고침하세요.
          </p>
        )}
      </div>
      {fn !== "embedding" && (
        <div className={styles.model}>
          <label htmlFor={`${id}-reasoning`}>추론 강도</label>
          <select
            id={`${id}-reasoning`}
            value={reasoningEffort ?? ""}
            disabled={
              (!value && !reasoningEffort) ||
              (!selected?.reasoningEfforts.length && !reasoningEffort)
            }
            onChange={(event) =>
              onChange(
                value,
                (event.target.value || undefined) as
                  ReasoningEffort | undefined,
              )
            }
          >
            <option value="">공급자 기본값 · 지정 안 함</option>
            {invalidEffort && (
              <option value={reasoningEffort}>
                {reasoningEffort} · 지원 미확인 / 기존 값
              </option>
            )}
            {selected?.reasoningEfforts.map((effort) => (
              <option key={effort} value={effort}>
                {effort}
              </option>
            ))}
          </select>
        </div>
      )}
      {invalidEffort && (
        <p className={styles.warning}>
          선택한 모델에서 {reasoningEffort} 지원을 확인할 수 없습니다. 지원되는
          강도를 직접 선택하거나 지정 안 함으로 변경하세요. 기존 값은 자동
          변경하지 않습니다.
        </p>
      )}
      {fn !== "embedding" &&
        !!value &&
        selected &&
        !selected.reasoningEfforts.length &&
        !reasoningEffort && (
          <p className="form-hint">
            이 모델 프로필은 추론 강도 지정 기능을 제공하지 않습니다.
          </p>
        )}
    </div>
  );
}
