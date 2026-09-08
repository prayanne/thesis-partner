"use client";
import { useEffect, useState } from "react";
import { Save, ShieldCheck } from "lucide-react";
import type { AppConfig } from "@thesis/security";
import {
  apiEnvelope,
  send,
  errorText,
  useResource,
  listOf,
  dateLabel,
} from "../lib/api";
import { ErrorState, Loading, Notice, PageHeading } from "./ui";
import {
  PrivacyFields,
  ReadingFields,
  TranslationFields,
  Toggle,
  type CredentialStatus,
} from "./setup-fields";
import { ProviderSettings, FunctionDefaults } from "./provider-settings";
import { OPEN_SETUP_EVENT, SETUP_SAVED_EVENT } from "./first-setup";
import styles from "./setup.module.css";

export function SettingsPage() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [credentials, setCredentials] = useState<CredentialStatus>({});
  const [section, setSection] = useState("general");
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
    const refresh = () => void load();
    window.addEventListener(SETUP_SAVED_EVENT, refresh);
    return () => window.removeEventListener(SETUP_SAVED_EVENT, refresh);
  }, []);
  function edit(next: AppConfig) {
    setConfig(next);
    setDirty(true);
    setNotice("");
  }
  async function refreshCredentials() {
    const value = await apiEnvelope<AppConfig>("/config");
    setCredentials((value.meta?.credentials ?? {}) as CredentialStatus);
  }
  async function save() {
    if (!config) return;
    setBusy(true);
    setNotice("");
    setError(null);
    const { revision, schemaVersion, ...patch } = config;
    void schemaVersion;
    try {
      const next = await send<AppConfig>("/config", "PATCH", {
        expectedRevision: revision,
        patch,
      });
      setConfig(next);
      setDirty(false);
      setNotice("설정을 저장했습니다. 생성 요청은 실행하지 않았습니다.");
      window.dispatchEvent(new Event("workspace-config-saved"));
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
      <fieldset className={styles.wizardFields} disabled={busy}>
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
                <ReadingFields config={config} change={edit} />
                <div className={styles.developer}>
                  <h2>개발자 모드</h2>
                  <Toggle
                    title="개발자 모드 사용"
                    description="직접 켜고 저장하면 첫 설정 안내를 다시 열어 테스트할 수 있습니다. 기존 설정과 키는 유지됩니다."
                    checked={config.developer?.enabled ?? false}
                    onChange={(enabled) =>
                      edit({
                        ...config,
                        developer: { ...config.developer, enabled },
                      })
                    }
                  />
                  {config.developer?.enabled && (
                    <>
                      <button
                        type="button"
                        className="button"
                        disabled={dirty}
                        onClick={() =>
                          window.dispatchEvent(new Event(OPEN_SETUP_EVENT))
                        }
                      >
                        첫 설정 다시 열기
                      </button>
                      {dirty && (
                        <p className="form-hint">
                          개발자 모드와 변경사항을 먼저 저장하세요.
                        </p>
                      )}
                    </>
                  )}
                </div>
              </section>
            )}
            {section === "providers" && (
              <>
                <section className="settings-section">
                  <h2>AI 공급자</h2>
                  <p>
                    공급자와 모델을 선택한 뒤 연결과 추론을 각각 확인하세요.
                  </p>
                  <ProviderSettings
                    config={config}
                    change={edit}
                    credentials={credentials}
                    refreshCredentials={refreshCredentials}
                    dirty={dirty}
                  />
                </section>
                <section className="settings-section">
                  <h2>기능별 기본 공급자·모델</h2>
                  <p>
                    각 기능은 공급자 기본값을 따르거나 별도 모델을 사용할 수
                    있습니다. 자동으로 다른 모델이나 공급자로 전환하지 않습니다.
                  </p>
                  <FunctionDefaults config={config} change={edit} />
                </section>
              </>
            )}
            {section === "translation" && (
              <section className="settings-section">
                <h2>문서 번역</h2>
                <TranslationFields
                  config={config}
                  change={edit}
                  credentials={credentials}
                  refreshCredentials={refreshCredentials}
                />
              </section>
            )}
            {section === "network" && (
              <section className="settings-section">
                <h2>연결 정책·요금</h2>
                <p>외부로 전송할 정보와 사용 한도를 직접 정하세요.</p>
                <PrivacyFields config={config} change={edit} />
              </section>
            )}
            {section === "access" && <AccessTokens />}
          </div>
        </div>
      </fieldset>
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
