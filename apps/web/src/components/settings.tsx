"use client";
import { useEffect, useState, type ReactNode } from "react";
import { Save, KeyRound, Trash2, ShieldCheck } from "lucide-react";
import type { AppConfig, ProviderConfig } from "@thesis/security";
import {
  apiEnvelope,
  send,
  errorText,
  useResource,
  listOf,
  dateLabel,
} from "../lib/api";
import { ErrorState, Loading, Notice, PageHeading } from "./ui";
type CredentialStatus = Record<
  string,
  { configured: boolean; revision: number }
>;
export function SettingsPage() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [credentials, setCredentials] = useState<CredentialStatus>({});
  const [section, setSection] = useState("general");
  const [tab, setTab] = useState("local");
  const [error, setError] = useState<Error | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  async function load() {
    setError(null);
    try {
      const value = await apiEnvelope<AppConfig>("/config");
      setConfig(value.data);
      setCredentials((value.meta?.credentials ?? {}) as CredentialStatus);
      setDirty(false);
    } catch (e) {
      setError(e as Error);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  function edit(next: AppConfig) {
    setConfig(next);
    setDirty(true);
    setNotice("");
  }
  async function save() {
    if (!config) return;
    setBusy(true);
    setNotice("");
    setError(null);
    const { revision, schemaVersion, ...patch } = config;
    try {
      const next = await send<AppConfig>("/config", "PATCH", {
        expectedRevision: revision,
        patch,
      });
      setConfig(next);
      setDirty(false);
      setNotice("설정을 저장했습니다. 생성 요청은 실행하지 않았습니다.");
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  }
  if (!config)
    return (
      <div className="page">
        {error ? <ErrorState error={error} retry={load} /> : <Loading />}
      </div>
    );
  const tabs: [[string, string], [string, string]] = [
    ["local", "무료 · 로컬 AI"],
    ["paid", "유료 AI"],
  ];
  return (
    <div className="page">
      <PageHeading
        eyebrow="A WORKSPACE THAT FITS YOU"
        title="환경 설정"
        description="읽기 환경과 연결을 직접 관리하세요. 외부 호출은 허용한 작업에서만 사용합니다."
        actions={
          <button
            className="button primary"
            disabled={busy || !dirty}
            onClick={() => void save()}
          >
            <Save size={14} />
            {busy ? "저장 중…" : "변경 저장"}
          </button>
        }
      />
      {notice && <Notice>{notice}</Notice>}
      {error && <ErrorState error={error} retry={load} />}
      <div className="settings-grid">
        <nav className="settings-nav" aria-label="설정 메뉴">
          {[
            ["general", "일반 · 읽기"],
            ["providers", "AI 공급자"],
            ["translation", "번역"],
            ["network", "연결 · 사용 한도"],
            ["access", "접근 토큰"],
          ].map(([key, label]) => (
            <button
              key={key}
              className={section === key ? "active" : ""}
              onClick={() => setSection(key)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div>
          {section === "general" && (
            <section className="settings-section">
              <h2>나의 읽기 환경</h2>
              <p>편안하게 집중할 수 있는 기본값을 정하세요.</p>
              <div style={{ display: "grid", gap: 19 }}>
                <label>
                  작업 공간 이름
                  <input
                    value={config.general.displayName}
                    onChange={(e) =>
                      edit({
                        ...config,
                        general: {
                          ...config.general,
                          displayName: e.target.value,
                        },
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
                        edit({
                          ...config,
                          general: {
                            ...config.general,
                            language: e.target.value,
                          },
                        })
                      }
                    >
                      <option value="ko">한국어</option>
                      <option value="en">English (본문 설정)</option>
                    </select>
                  </label>
                  <label>
                    시간대
                    <input
                      value={config.general.timeZone}
                      onChange={(e) =>
                        edit({
                          ...config,
                          general: {
                            ...config.general,
                            timeZone: e.target.value,
                          },
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
                      edit({
                        ...config,
                        reading: { scale: Number(e.target.value) },
                      })
                    }
                  >
                    {[0.5, 0.75, 1, 1.25, 1.5, 2].map((v) => (
                      <option key={v} value={v}>
                        {v * 100}%
                      </option>
                    ))}
                  </select>
                </label>
                <div className="notice">
                  라이브러리 폴더는 실행 환경의 <code>PAPERS_DIR</code>로
                  연결합니다. 앱에서는 폴더 안의 PDF만 선택할 수 있습니다.
                </div>
              </div>
            </section>
          )}
          {section === "providers" && (
            <>
              <section className="settings-section">
                <h2>AI 공급자</h2>
                <p>
                  공급자와 모델을 선택한 뒤, 작업별 기본 공급자를 지정하세요.
                </p>
                <div className="tabs">
                  {tabs.map(([key, label]) => (
                    <button
                      key={key}
                      className={tab === key ? "active" : ""}
                      onClick={() => setTab(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {tab === "paid" && (
                  <Toggle
                    checked={config.ai.paidAiEnabled}
                    onChange={(v) =>
                      edit({
                        ...config,
                        ai: { ...config.ai, paidAiEnabled: v },
                      })
                    }
                    title="유료 AI 사용 허용"
                    description="OpenAI 또는 Anthropic의 요청에 비용이 발생할 수 있습니다. 별도의 외부 AI 허용도 필요합니다."
                  />
                )}
                {config.providers
                  .filter(
                    (p) =>
                      ["openai", "anthropic"].includes(p.adapterId) ===
                      (tab === "paid"),
                  )
                  .map((p) => (
                    <ProviderCard
                      key={p.id}
                      provider={p}
                      status={credentials[p.credentialRef ?? p.id]}
                      change={(next) =>
                        edit({
                          ...config,
                          providers: config.providers.map((v) =>
                            v.id === p.id ? next : v,
                          ),
                        })
                      }
                      refreshStatus={async () => {
                        const v = await apiEnvelope<AppConfig>("/config");
                        setCredentials(
                          (v.meta?.credentials ?? {}) as CredentialStatus,
                        );
                      }}
                    />
                  ))}
              </section>
              <section className="settings-section">
                <h2>작업별 기본 공급자</h2>
                <p>
                  자동으로 다른 공급자로 전환하지 않습니다. 모델과 활성 상태를
                  확인하세요.
                </p>
                <div className="form-row">
                  {(
                    [
                      ["summary", "요약"],
                      ["chat", "질문"],
                      ["analysis", "분석"],
                      ["embedding", "임베딩"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <select
                        value={config.ai.defaults[key] ?? ""}
                        onChange={(e) =>
                          edit({
                            ...config,
                            ai: {
                              ...config.ai,
                              defaults: {
                                ...config.ai.defaults,
                                [key]: e.target.value || null,
                              },
                            },
                          })
                        }
                      >
                        <option value="">선택 안 함</option>
                        {config.providers.map((p) => (
                          <option value={p.id} key={p.id}>
                            {p.id}
                            {p.enabled ? "" : " · 비활성"}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              </section>
            </>
          )}
          {section === "translation" && (
            <section className="settings-section">
              <h2>문서 번역</h2>
              <p>Google Translation 연결과 번역 목표 언어를 관리합니다.</p>
              <Toggle
                title="번역 사용"
                description="번역 버튼을 누를 때만 요청합니다. 외부 번역 허용과 자격 증명이 필요합니다."
                checked={config.translation.enabled}
                onChange={(v) =>
                  edit({
                    ...config,
                    translation: { ...config.translation, enabled: v },
                  })
                }
              />
              <div style={{ display: "grid", gap: 18, marginTop: 20 }}>
                <label>
                  번역 목표 언어
                  <input
                    value={config.translation.targetLanguage}
                    onChange={(e) =>
                      edit({
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
                    onChange={(e) =>
                      edit({
                        ...config,
                        translation: {
                          ...config.translation,
                          monthlyCharacterLimit:
                            e.target.value === ""
                              ? null
                              : Number(e.target.value),
                        },
                      })
                    }
                    placeholder="상한 미설정"
                  />
                </label>
                <CredentialInput
                  id="google-translation"
                  status={credentials["google-translation"]}
                  done={async () => {
                    const v = await apiEnvelope<AppConfig>("/config");
                    setCredentials(
                      (v.meta?.credentials ?? {}) as CredentialStatus,
                    );
                  }}
                />
              </div>
            </section>
          )}
          {section === "network" && (
            <>
              <section className="settings-section">
                <h2>연결 허용</h2>
                <p>허용 상태를 바꾸어도 작업이 자동으로 시작되지 않습니다.</p>
                {(
                  [
                    [
                      "localOnly",
                      "로컬 전용 모드",
                      "켜면 외부 AI · 번역 · 메타데이터 호출을 차단합니다.",
                    ],
                    [
                      "allowExternalAi",
                      "외부 AI 연결 허용",
                      "외부 공급자에게 요청에 필요한 본문을 보낼 수 있습니다.",
                    ],
                    [
                      "allowExternalTranslation",
                      "외부 번역 연결 허용",
                      "번역할 원문이 번역 공급자에게 전달됩니다.",
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
                    onChange={(v) =>
                      edit({
                        ...config,
                        network: { ...config.network, [key]: v },
                      })
                    }
                  />
                ))}
              </section>
              <section className="settings-section">
                <h2>출력과 예산</h2>
                <p>예상 비용은 공급자의 실제 청구와 다를 수 있습니다.</p>
                <div className="form-row">
                  <label>
                    최대 출력 토큰
                    <input
                      type="number"
                      min={1}
                      max={32768}
                      value={config.ai.maxOutputTokens}
                      onChange={(e) =>
                        edit({
                          ...config,
                          ai: {
                            ...config.ai,
                            maxOutputTokens: Number(e.target.value),
                          },
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
                        edit({
                          ...config,
                          ai: {
                            ...config.ai,
                            monthlyBudgetUsd:
                              e.target.value === ""
                                ? null
                                : Number(e.target.value),
                          },
                        })
                      }
                    />
                  </label>
                </div>
              </section>
            </>
          )}
          {section === "access" && <AccessTokens />}
        </div>
      </div>
    </div>
  );
}
function Toggle({
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
function ProviderCard({
  provider: p,
  status,
  change,
  refreshStatus,
}: {
  provider: ProviderConfig;
  status?: { configured: boolean; revision: number };
  change: (p: ProviderConfig) => void;
  refreshStatus: () => Promise<void>;
}) {
  const [test, setTest] = useState("");
  const [testing, setTesting] = useState(false);
  return (
    <div className="provider-card">
      <header>
        <h3>
          {
            {
              openai: "OpenAI",
              anthropic: "Anthropic",
              ollama: "Ollama",
              lmstudio: "LM Studio",
            }[p.adapterId]
          }
        </h3>
        <span className="status-pill">
          {p.enabled ? "사용 설정됨" : "사용 안 함"}
        </span>
      </header>
      <Toggle
        title="이 공급자 사용"
        description="모델과 작업별 기본 공급자를 함께 지정하세요."
        checked={p.enabled}
        onChange={(v) => change({ ...p, enabled: v })}
      />
      <label>
        연결 주소
        <input
          value={p.endpoint}
          readOnly={["openai", "anthropic"].includes(p.adapterId)}
          onChange={(e) =>
            change({
              ...p,
              endpoint: e.target.value,
              localIsolationVerified: false,
            })
          }
        />
      </label>
      <div className="form-row">
        <label>
          채팅 모델 ID
          <input
            value={p.modelId}
            onChange={(e) => change({ ...p, modelId: e.target.value })}
            placeholder="공급자의 정확한 모델 ID"
          />
        </label>
        <label>
          모델 버전
          <input
            value={p.modelRevision}
            onChange={(e) => change({ ...p, modelRevision: e.target.value })}
            placeholder="모델 revision"
          />
        </label>
      </div>
      {["ollama", "lmstudio"].includes(p.adapterId) && (
        <Toggle
          title="호스트 AI의 원격 실행이 꺼진 것을 확인했습니다"
          description="Cloud 모델과 LM Link 등 원격 실행을 호스트에서 직접 확인하세요. 이 항목은 사용자 확인이며 자동 검증이 아닙니다."
          checked={p.localIsolationVerified ?? false}
          onChange={(v) => change({ ...p, localIsolationVerified: v })}
        />
      )}
      <label>
        임베딩 모델 ID
        <input
          value={p.embeddingModelId}
          onChange={(e) => change({ ...p, embeddingModelId: e.target.value })}
          placeholder="사용할 때만 입력"
        />
      </label>
      <CredentialInput
        id={p.credentialRef ?? p.id}
        status={status}
        done={async () => {
          change({ ...p, credentialRef: p.credentialRef ?? p.id });
          await refreshStatus();
        }}
      />
      <button
        type="button"
        className="button small"
        disabled={testing}
        onClick={async () => {
          setTesting(true);
          setTest("");
          try {
            const r = await send<{ ok: boolean; modelCount?: number }>(
              `/providers/${p.id}/tests`,
              "POST",
              {},
            );
            setTest(
              r.ok
                ? `메타데이터 연결 확인 완료${typeof r.modelCount === "number" ? ` · 모델 ${r.modelCount}개` : ""}. 추론은 실행하지 않았습니다.`
                : "연결을 확인하지 못했습니다.",
            );
          } catch (e) {
            setTest(errorText(e));
          } finally {
            setTesting(false);
          }
        }}
      >
        저장된 설정으로 연결 확인
      </button>
      {test && (
        <p className="form-hint" role="status">
          {test}
        </p>
      )}
      <small>
        자격 증명 저장 후 화면 위의 ‘변경 저장’으로 공급자 연결을 확정하세요.
      </small>
    </div>
  );
}
function CredentialInput({
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
function AccessTokens() {
  const tokens = useResource<
    {
      id: string;
      name: string;
      scopes: string[];
      createdAt: string;
      revokedAt?: string;
    }[]
  >("/access-tokens");
  const [name, setName] = useState("");
  const [issued, setIssued] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section className="settings-section">
      <h2>
        <ShieldCheck size={17} /> 외부 도구 접근 토큰
      </h2>
      <p>
        기본 읽기 전용 권한으로 발급합니다. 비밀 토큰은 발급 직후 이 화면에서만
        확인할 수 있습니다.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          setIssued("");
          try {
            const result = await send<{ token: string }>(
              "/access-tokens",
              "POST",
              { name, scopes: ["library:read", "wiki:read", "learning:read"] },
            );
            setIssued(result.token);
            setName("");
            tokens.reload();
          } catch (e) {
            setError(errorText(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          사용 용도
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: 로컬 자료 조회 도구"
            required
          />
        </label>
        <button className="button" disabled={busy || !name.trim()}>
          읽기 전용 토큰 발급
        </button>
      </form>
      {issued && (
        <div className="credential-form" style={{ marginTop: 20 }}>
          <label>
            새 접근 토큰
            <input
              readOnly
              type="password"
              value={issued}
              autoComplete="off"
              aria-label="발급된 접근 토큰"
            />
          </label>
          <button
            className="button small"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(issued);
              } catch {
                setError(
                  "클립보드 접근이 허용되지 않았습니다. 입력 필드에서 직접 복사하세요.",
                );
              }
            }}
          >
            토큰 복사
          </button>
          <button className="button small" onClick={() => setIssued("")}>
            확인했어요 · 화면에서 지우기
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <hr />
      {tokens.loading ? (
        <Loading />
      ) : tokens.error ? (
        <ErrorState error={tokens.error} retry={tokens.reload} />
      ) : (
        listOf(tokens.data).map((t) => (
          <div className="provider-card" key={t.id}>
            <header>
              <strong>{t.name}</strong>
              <span className="status-pill">
                {t.revokedAt ? "폐기됨" : "유효"}
              </span>
            </header>
            <small>
              {t.scopes.join(" · ")}
              <br />
              {dateLabel(t.createdAt)}
            </small>
            {!t.revokedAt && (
              <button
                className="button small danger"
                onClick={async () => {
                  try {
                    await send(`/access-tokens/${t.id}`, "DELETE");
                    tokens.reload();
                  } catch (e) {
                    setError(errorText(e));
                  }
                }}
              >
                토큰 폐기
              </button>
            )}
          </div>
        ))
      )}
    </section>
  );
}
