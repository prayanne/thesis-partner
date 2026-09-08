"use client";
import { useState } from "react";
import { KeyRound, Trash2 } from "lucide-react";
import type { AppConfig } from "@thesis/security";
import { send, errorText } from "../lib/api";
import styles from "./setup.module.css";

export type CredentialStatus = Record<
  string,
  { configured: boolean; revision: number }
>;
type ConfigFields = { config: AppConfig; change: (next: AppConfig) => void };

export function Toggle({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="toggle-row">
      <span>
        {title}
        <small>{description}</small>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
export function CredentialInput({
  id,
  status,
  done,
}: {
  id: string;
  status?: { configured: boolean; revision: number };
  done: () => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function write() {
    const secret = value;
    setValue("");
    setBusy(true);
    setMessage("");
    try {
      await send(`/credentials/${id}`, "PUT", { value: secret });
      await done();
      setMessage("자격 증명을 저장했습니다. 비밀값은 다시 표시하지 않습니다.");
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="credential-form">
      <label>
        <span>
          <KeyRound size={12} /> 자격 증명{" "}
          <small>· {status?.configured ? "저장됨" : "미등록"}</small>
        </span>
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          placeholder={
            status?.configured ? "교체할 값만 입력" : "새 자격 증명 입력"
          }
        />
      </label>
      <div className="form-actions">
        <button
          type="button"
          className="button small"
          disabled={busy || !value.trim()}
          onClick={() => void write()}
        >
          비밀값 저장
        </button>
        {status?.configured && (
          <button
            type="button"
            className="button small danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await send(`/credentials/${id}`, "DELETE");
                await done();
                setMessage("자격 증명을 삭제했습니다.");
              } catch (e) {
                setMessage(errorText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Trash2 size={11} />
            삭제
          </button>
        )}
      </div>
      <small>
        서버의 암호화 저장소에만 저장합니다. 설정 파일에는 참조 ID만 기록합니다.
      </small>
      {message && (
        <p className="form-hint" role="status">
          {message}
        </p>
      )}
    </div>
  );
}

export function ReadingFields({ config, change }: ConfigFields) {
  return (
    <div className={styles.fields}>
      <label>
        작업 공간 이름
        <input
          value={config.general.displayName}
          onChange={(e) =>
            change({
              ...config,
              general: { ...config.general, displayName: e.target.value },
            })
          }
          placeholder="나의 연구 작업 공간"
        />
      </label>
      <div className="form-row">
        <label>
          언어
          <select
            value={config.general.language}
            onChange={(e) =>
              change({
                ...config,
                general: { ...config.general, language: e.target.value },
              })
            }
          >
            {!["ko", "en"].includes(config.general.language) && (
              <option value={config.general.language}>
                {config.general.language} · 기존 값
              </option>
            )}
            <option value="ko">한국어</option>
            <option value="en">English (본문 설정)</option>
          </select>
        </label>
        <label>
          시간대
          <input
            value={config.general.timeZone}
            onChange={(e) =>
              change({
                ...config,
                general: { ...config.general, timeZone: e.target.value },
              })
            }
          />
        </label>
      </div>
      <label>
        PDF 기본 확대
        <select
          value={config.reading.scale}
          onChange={(e) =>
            change({
              ...config,
              reading: { ...config.reading, scale: Number(e.target.value) },
            })
          }
        >
          {[...new Set([0.5, 0.75, 1, 1.25, 1.5, 2, config.reading.scale])]
            .sort((a, b) => a - b)
            .map((value) => (
              <option key={value} value={value}>
                {Math.round(value * 100)}%
              </option>
            ))}
        </select>
      </label>
      <p className="form-hint">
        논문 원본은 연결된 라이브러리에 그대로 보관됩니다. 이 화면에서는 읽기
        기본값만 변경합니다.
      </p>
    </div>
  );
}

export function PrivacyFields({ config, change }: ConfigFields) {
  return (
    <div className={styles.fields}>
      <div className={styles.callout}>
        논문 읽기는 API 키 없이 시작할 수 있습니다. 외부 AI 사용 시 요청한
        내용이 공급자에게 전송되며, OpenAI API 요금은 ChatGPT·Codex 구독과
        별도로 청구됩니다.
      </div>
      <div>
        {(
          [
            [
              "localOnly",
              "로컬 전용 모드",
              "켜면 외부 AI·번역·메타데이터 요청을 차단합니다.",
            ],
            [
              "allowExternalAi",
              "외부 AI 연결 허용",
              "요약·질문·분석을 요청할 때 필요한 본문을 공급자에게 보낼 수 있습니다.",
            ],
            [
              "allowExternalTranslation",
              "외부 번역 연결 허용",
              "번역을 요청할 때 원문을 Google Translation에 보낼 수 있습니다.",
            ],
            [
              "allowExternalMetadata",
              "외부 메타데이터 조회 허용",
              "명시적으로 요청한 서지 정보 조회에 사용합니다.",
            ],
          ] as const
        ).map(([key, title, description]) => (
          <Toggle
            key={key}
            title={title}
            description={description}
            checked={config.network[key]}
            onChange={(value) =>
              change({
                ...config,
                network: { ...config.network, [key]: value },
              })
            }
          />
        ))}
        <Toggle
          title="유료 AI 사용 허용"
          description="공급자 활성화와 외부 AI 허용도 필요합니다. 설정을 여는 것만으로 요청하지 않습니다."
          checked={config.ai.paidAiEnabled}
          onChange={(value) =>
            change({ ...config, ai: { ...config.ai, paidAiEnabled: value } })
          }
        />
      </div>
      {config.network.localOnly &&
        (config.network.allowExternalAi ||
          config.network.allowExternalTranslation ||
          config.network.allowExternalMetadata) && (
          <p className="form-hint">
            외부 허용값이 저장되어 있어도 로컬 전용 모드가 켜져 있는 동안 외부
            요청은 차단됩니다.
          </p>
        )}
      <div className="form-row">
        <label>
          최대 출력 토큰
          <input
            type="number"
            min={1}
            max={32768}
            value={config.ai.maxOutputTokens}
            onChange={(e) =>
              change({
                ...config,
                ai: { ...config.ai, maxOutputTokens: Number(e.target.value) },
              })
            }
          />
        </label>
        <label>
          월 예산 상한 (USD)
          <input
            type="number"
            min={0}
            step="0.01"
            value={config.ai.monthlyBudgetUsd ?? ""}
            placeholder="상한 미설정"
            onChange={(e) =>
              change({
                ...config,
                ai: {
                  ...config.ai,
                  monthlyBudgetUsd:
                    e.target.value === "" ? null : Number(e.target.value),
                },
              })
            }
          />
        </label>
      </div>
    </div>
  );
}

export function TranslationFields({
  config,
  change,
  credentials,
  refreshCredentials,
}: ConfigFields & {
  credentials: CredentialStatus;
  refreshCredentials: () => Promise<void>;
}) {
  return (
    <div className={styles.fields}>
      <p className="form-hint">
        Google Translation은 로컬 AI와 별도의 외부 서비스입니다. 실제 번역은
        문서에서 요청할 때만 실행합니다.
      </p>
      <Toggle
        title="번역 사용"
        description="외부 번역 허용과 자격 증명이 필요하며 공급자 요금이 발생할 수 있습니다."
        checked={config.translation.enabled}
        onChange={(enabled) =>
          change({ ...config, translation: { ...config.translation, enabled } })
        }
      />
      <div className="form-row">
        <label>
          번역 목표 언어
          <input
            value={config.translation.targetLanguage}
            onChange={(e) =>
              change({
                ...config,
                translation: {
                  ...config.translation,
                  targetLanguage: e.target.value,
                },
              })
            }
          />
        </label>
        <label>
          월 문자 수 상한
          <input
            type="number"
            min={0}
            value={config.translation.monthlyCharacterLimit ?? ""}
            placeholder="상한 미설정"
            onChange={(e) =>
              change({
                ...config,
                translation: {
                  ...config.translation,
                  monthlyCharacterLimit:
                    e.target.value === "" ? null : Number(e.target.value),
                },
              })
            }
          />
        </label>
      </div>
      <CredentialInput
        id="google-translation"
        status={credentials["google-translation"]}
        done={refreshCredentials}
      />
    </div>
  );
}
