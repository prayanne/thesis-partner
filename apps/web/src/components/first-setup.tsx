"use client";
import { useEffect, useRef, useState } from "react";
import type { AppConfig } from "@thesis/security";
import { ArrowLeft, ArrowRight, ShieldCheck } from "lucide-react";
import { apiEnvelope, errorText, send } from "../lib/api";
import {
  PrivacyFields,
  ReadingFields,
  TranslationFields,
  type CredentialStatus,
} from "./setup-fields";
import { ProviderSettings, FunctionDefaults } from "./provider-settings";
import { finishSetup, setupStatus } from "../lib/setup-models";
import styles from "./setup.module.css";

export const OPEN_SETUP_EVENT = "workspace-open-setup";
export const SETUP_SAVED_EVENT = "workspace-setup-saved";
export type SetupFinish = "completed" | "local-only" | "deferred";
const steps = ["개인정보·요금", "공급자·API 키", "기능별 기본값", "읽기 환경"];

export function FirstSetupLauncher() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [credentials, setCredentials] = useState<CredentialStatus>({});
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    async function load(reopen = false) {
      try {
        const value = await apiEnvelope<AppConfig>("/config");
        if (!active) return;
        setConfig(value.data);
        setCredentials((value.meta?.credentials ?? {}) as CredentialStatus);
        setOpen(reopen || setupStatus(value.data) === "pending");
        setError("");
      } catch (e) {
        if (active) setError(errorText(e));
      }
    }
    void load();
    const reopen = () => void load(true);
    const refresh = () => void load();
    window.addEventListener(OPEN_SETUP_EVENT, reopen);
    window.addEventListener("workspace-config-saved", refresh);
    return () => {
      active = false;
      window.removeEventListener(OPEN_SETUP_EVENT, reopen);
      window.removeEventListener("workspace-config-saved", refresh);
    };
  }, []);
  if (error)
    return (
      <div className={styles.banner} role="alert">
        첫 설정 상태를 불러오지 못했습니다. {error}
        <button
          className="button small"
          onClick={() => window.dispatchEvent(new Event(OPEN_SETUP_EVENT))}
        >
          다시 확인
        </button>
      </div>
    );
  if (!config) return null;
  return (
    <>
      {!open && setupStatus(config) === "deferred" && (
        <div className={styles.banner}>
          <span>
            첫 설정을 나중으로 미뤘습니다. 현재 저장된 정책으로 작업 공간을
            사용합니다.
          </span>
          <button
            className="button small"
            onClick={() => window.dispatchEvent(new Event(OPEN_SETUP_EVENT))}
          >
            첫 설정 계속하기
          </button>
        </div>
      )}
      {open && (
        <FirstSetupDialog
          initialConfig={config}
          initialCredentials={credentials}
          done={(next) => {
            setConfig(next);
            setOpen(false);
            window.dispatchEvent(new Event(SETUP_SAVED_EVENT));
          }}
        />
      )}
    </>
  );
}

export function FirstSetupDialog({
  initialConfig,
  initialCredentials,
  done,
}: {
  initialConfig: AppConfig;
  initialCredentials: CredentialStatus;
  done: (config: AppConfig) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [config, setConfig] = useState(initialConfig);
  const [saved, setSaved] = useState(initialConfig);
  const [credentials, setCredentials] = useState(initialCredentials);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const dirty = JSON.stringify(config) !== JSON.stringify(saved);
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => {
      element?.close();
      previous?.focus();
    };
  }, []);
  useEffect(() => {
    heading.current?.focus();
  }, [step]);
  async function refreshCredentials() {
    const value = await apiEnvelope<AppConfig>("/config");
    setCredentials((value.meta?.credentials ?? {}) as CredentialStatus);
  }
  function edit(next: AppConfig) {
    setConfig(next);
    setNotice("");
  }
  async function persist(mode?: SetupFinish) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      // Deferring discards this dialog's draft and preserves the latest saved settings.
      const baseline =
        mode === "deferred"
          ? (await apiEnvelope<AppConfig>("/config")).data
          : config;
      const next = mode ? finishSetup(baseline, mode) : baseline;
      const { revision, schemaVersion, ...patch } = next;
      void schemaVersion;
      const value = await send<AppConfig>("/config", "PATCH", {
        expectedRevision: revision,
        patch,
      });
      setConfig(value);
      setSaved(value);
      if (mode) done(value);
      else
        setNotice(
          "설정을 저장했습니다. 이제 모델 목록 새로고침과 검증을 직접 실행할 수 있습니다.",
        );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="first-setup-title"
      aria-describedby="first-setup-description"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) void persist("deferred");
      }}
    >
      <header className={styles.dialogHeader}>
        <span className="eyebrow">YOUR RESEARCH WORKSPACE</span>
        <h2 id="first-setup-title">연구 공간 첫 설정</h2>
        <p id="first-setup-description">
          기존 설정과 저장된 키를 유지하며 필요한 항목만 바꾸세요. 이 안내를
          열어도 외부 요청이나 모델 다운로드는 실행되지 않습니다.
        </p>
      </header>
      <fieldset disabled={busy} className={styles.wizardFields}>
        <div className={styles.dialogBody}>
          <nav className={styles.steps} aria-label="첫 설정 단계">
            {steps.map((label, index) => (
              <button
                key={label}
                type="button"
                aria-current={step === index ? "step" : undefined}
                onClick={() => setStep(index)}
              >
                <span>{index + 1}</span>
                {label}
              </button>
            ))}
          </nav>
          <section className={styles.stepContent}>
            <h3 ref={heading} tabIndex={-1}>
              {steps[step]}
            </h3>
            {step === 0 && (
              <>
                <p>외부로 보낼 정보와 사용할 유료 서비스를 직접 선택하세요.</p>
                <PrivacyFields config={config} change={edit} />
              </>
            )}
            {step === 1 && (
              <>
                <p>
                  로컬 서비스는 미리 설치된 모델을 조회합니다. API 키는 입력할
                  때만 표시되고 다시 읽어오지 않습니다.
                </p>
                <ProviderSettings
                  config={config}
                  change={edit}
                  credentials={credentials}
                  refreshCredentials={refreshCredentials}
                  dirty={dirty}
                />
                <details className={styles.developer}>
                  <summary>Google Translation 설정</summary>
                  <TranslationFields
                    config={config}
                    change={edit}
                    credentials={credentials}
                    refreshCredentials={refreshCredentials}
                  />
                </details>
                <div className={styles.actions}>
                  <button
                    type="button"
                    className="button"
                    disabled={!dirty}
                    onClick={() => void persist()}
                  >
                    연결 설정 저장
                  </button>
                  <small>목록 조회·검증은 저장된 설정을 사용합니다.</small>
                </div>
              </>
            )}
            {step === 2 && (
              <>
                <p>
                  선택하지 않은 기능은 사용할 때 설정할 수 있습니다. 모델은 다른
                  공급자로 자동 대체되지 않습니다.
                </p>
                <FunctionDefaults config={config} change={edit} />
              </>
            )}
            {step === 3 && (
              <>
                <p>
                  읽기 환경을 정하면 시작할 준비가 됩니다. AI 연결 없이 완료해도
                  됩니다.
                </p>
                <ReadingFields config={config} change={edit} />
                <div className={styles.callout}>
                  현재 정책:{" "}
                  {config.network.localOnly
                    ? "로컬 전용"
                    : "선택한 외부 연결 허용"}{" "}
                  · 유료 AI {config.ai.paidAiEnabled ? "허용" : "차단"}
                  <br />
                  저장은 추론 검증이 아닙니다. 공급자 단계에서 메타데이터와 실제
                  추론 결과를 따로 확인할 수 있습니다.
                </div>
              </>
            )}
          </section>
        </div>
        <footer className={styles.dialogFooter}>
          <div className={styles.actions}>
            <button
              type="button"
              className="button small"
              onClick={() => void persist("deferred")}
            >
              나중에 설정
            </button>
            <button
              type="button"
              className="button small"
              onClick={() => void persist("local-only")}
            >
              <ShieldCheck size={13} />
              로컬 전용으로 완료
            </button>
          </div>
          <div className={styles.actions}>
            {step > 0 && (
              <button
                type="button"
                className="button"
                onClick={() => setStep(step - 1)}
              >
                <ArrowLeft size={13} />
                이전
              </button>
            )}
            {step < steps.length - 1 ? (
              <button
                type="button"
                className="button primary"
                onClick={() => setStep(step + 1)}
              >
                다음
                <ArrowRight size={13} />
              </button>
            ) : (
              <button
                type="button"
                className="button primary"
                onClick={() => void persist("completed")}
              >
                {busy ? "저장 중…" : "설정 완료"}
              </button>
            )}
          </div>
        </footer>
      </fieldset>
      {(error || notice || busy) && (
        <div className={styles.dialogMessage}>
          {error && (
            <p className="inline-error" role="alert">
              {error} 현재 입력은 유지됩니다. 설정을 다시 확인한 후 저장하세요.
            </p>
          )}
          {notice && (
            <p role="status" className="form-hint">
              {notice}
            </p>
          )}
          {busy && <p role="status">설정을 저장하고 있습니다…</p>}
        </div>
      )}
    </dialog>
  );
}
