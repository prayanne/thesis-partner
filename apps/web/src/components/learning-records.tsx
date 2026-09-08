"use client";
import { useState } from "react";
import { CheckCheck, Clock3 } from "lucide-react";
import type { CurriculumItem } from "../lib/types";
import { useResource, listOf, send, errorText, dateLabel } from "../lib/api";
import { ErrorState, Loading, Notice } from "./ui";
export function LearningRecords({
  item,
  answers,
  onSaved,
}: {
  item: CurriculumItem;
  answers: Record<string, string>;
  onSaved: () => void;
}) {
  const [tab, setTab] = useState("study");
  const [minutes, setMinutes] = useState("");
  const [reflection, setReflection] = useState("");
  const [environment, setEnvironment] = useState("");
  const [method, setMethod] = useState("");
  const [evidence, setEvidence] = useState("");
  const [commit, setCommit] = useState("");
  const [result, setResult] = useState("");
  const [exercise, setExercise] = useState(
    (item.blocks ?? []).find((b) => b.kind === "exercise")?.blockKey ?? "",
  );
  const [reading, setReading] = useState(
    item.progress?.checks?.readingConfirmed ?? false,
  );
  const [exerciseCheck, setExerciseCheck] = useState(
    item.progress?.checks?.exerciseConfirmed ?? false,
  );
  const [confirmed, setConfirmed] = useState(false);
  const [review, setReview] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessions = useResource<
    {
      id: string;
      lessonRevisionId: string;
      elapsedSeconds: number;
      reflection: string;
      startedAt: string;
    }[]
  >(`/study-sessions?itemId=${item.id}`);
  const submissions = useResource<
    {
      id: string;
      lessonRevisionId: string;
      blockKey: string;
      resultNote: string;
      createdAt: string;
      evidencePath?: string;
      commitRef?: string;
    }[]
  >(`/exercise-submissions?itemId=${item.id}`);
  const exercises = (item.blocks ?? []).filter((b) => b.kind === "exercise");
  const selfAnswers = (item.blocks ?? [])
    .filter((b) => b.kind === "self_explanation")
    .flatMap((b) =>
      Array.isArray(b.payload.questions)
        ? b.payload.questions.map((_, i) => answers[`${b.blockKey}:${i}`] ?? "")
        : [],
    );
  const readonly = Boolean(item.archivedAt) || !item.lessonRevisionId;
  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="record-panel">
      <div className="panel-title">
        <h3>실습과 회고</h3>
        <Clock3 size={17} />
      </div>
      <p className="form-hint">
        현재 학습 내용 v{item.contentVersion}에 기록됩니다. 답안을 저장하려면
        학습 상태를 저장하거나 실습 결과를 제출하세요.
      </p>
      {readonly && (
        <Notice>
          보관되었거나 학습 버전이 없는 단원입니다. 기록을 읽을 수 있지만 새로
          저장할 수 없습니다.
        </Notice>
      )}
      <div className="tabs">
        <button
          className={tab === "study" ? "active" : ""}
          onClick={() => setTab("study")}
        >
          학습 기록
        </button>
        <button
          className={tab === "exercise" ? "active" : ""}
          onClick={() => setTab("exercise")}
        >
          실습 제출
        </button>
        <button
          className={tab === "progress" ? "active" : ""}
          onClick={() => setTab("progress")}
        >
          완료 · 복습
        </button>
        <button
          className={tab === "history" ? "active" : ""}
          onClick={() => setTab("history")}
        >
          이전 기록
        </button>
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {notice && <Notice>{notice}</Notice>}
      {tab === "study" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              const elapsedSeconds = Math.round(Number(minutes) * 60);
              const end = new Date();
              const row = await send<{ id: string }>(
                "/study-sessions",
                "POST",
                {
                  itemId: item.id,
                  lessonRevisionId: item.lessonRevisionId,
                  startedAt: new Date(
                    end.getTime() - elapsedSeconds * 1000,
                  ).toISOString(),
                  endedAt: end.toISOString(),
                  elapsedSeconds,
                  reflection,
                },
              );
              setSessionId(row.id);
              setReflection("");
              setMinutes("");
              sessions.reload();
              setNotice("학습 시간과 회고를 저장했습니다.");
            });
          }}
        >
          <label>
            실제 학습 시간 (분)
            <input
              type="number"
              min={0}
              step={1}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              required
            />
          </label>
          <label>
            오늘의 회고
            <textarea
              value={reflection}
              onChange={(e) => setReflection(e.target.value)}
              placeholder="이해한 점, 어려웠던 점, 다음에 확인할 것"
            />
          </label>
          <button className="button primary" disabled={busy || readonly}>
            학습 기록 저장
          </button>
        </form>
      )}
      {tab === "exercise" &&
        (exercises.length ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                await send("/exercise-submissions", "POST", {
                  itemId: item.id,
                  lessonRevisionId: item.lessonRevisionId,
                  blockKey: exercise,
                  sessionId,
                  answers: {
                    environment,
                    method,
                    selfExplanation: selfAnswers,
                    blockResponses: answers,
                  },
                  evidencePath: evidence || null,
                  commitRef: commit || null,
                  resultNote: result,
                });
                submissions.reload();
                setNotice(
                  "실습 결과를 제출했습니다. 완료 여부는 별도로 확인해 주세요.",
                );
                setResult("");
              });
            }}
          >
            <label>
              실습 선택
              <select
                value={exercise}
                onChange={(e) => setExercise(e.target.value)}
              >
                {exercises.map((b) => (
                  <option key={b.blockKey} value={b.blockKey}>
                    {typeof b.payload.title === "string"
                      ? b.payload.title
                      : b.blockKey}
                  </option>
                ))}
              </select>
            </label>
            <label>
              실행 환경
              <input
                value={environment}
                onChange={(e) => setEnvironment(e.target.value)}
                placeholder="언어 · 버전 · 운영체제"
                required
              />
            </label>
            <label>
              재현 방법
              <textarea
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                placeholder="실행 명령과 테스트 방법을 기록하세요."
                required
              />
            </label>
            <div className="form-row">
              <label>
                결과 파일 또는 코드 경로
                <input
                  value={evidence}
                  onChange={(e) => setEvidence(e.target.value)}
                  placeholder="텍스트 기록용 경로"
                />
              </label>
              <label>
                Git commit
                <input
                  value={commit}
                  onChange={(e) => setCommit(e.target.value)}
                  placeholder="선택 사항"
                />
              </label>
            </div>
            <label>
              정상 · 실패 결과와 회고
              <textarea
                value={result}
                onChange={(e) => setResult(e.target.value)}
                required
                placeholder="기대 결과, 실제 결과, 실패 사례와 배운 점"
              />
            </label>
            <p className="form-hint">
              경로와 명령은 증빙용 텍스트로만 저장합니다. 앱에서 코드를
              실행하거나 파일을 열지 않습니다.
            </p>
            <button className="button primary" disabled={busy || readonly}>
              실습 결과 제출
            </button>
          </form>
        ) : (
          <Notice>
            이 단원에는 실습 블록이 없습니다. 단원 편집에서 추가할 수 있습니다.
          </Notice>
        ))}
      {tab === "progress" && (
        <div>
          <label className="check-item">
            <input
              type="checkbox"
              checked={reading}
              onChange={(e) => setReading(e.target.checked)}
            />
            필수 읽기 자료를 확인했습니다.
          </label>
          {Boolean(selfAnswers.length) && (
            <p className="form-hint">
              자기 설명 답안: {selfAnswers.filter((v) => v.trim()).length} /{" "}
              {selfAnswers.length} 작성
            </p>
          )}
          {Boolean(exercises.length) && (
            <label className="check-item">
              <input
                type="checkbox"
                checked={exerciseCheck}
                onChange={(e) => setExerciseCheck(e.target.checked)}
              />
              각 실습의 결과를 제출하고 최소 확인 항목을 점검했습니다.
            </label>
          )}
          <label className="check-item">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            내가 직접 학습 완료를 확인합니다.
          </label>
          <label>
            다음 복습 날짜
            <input
              type="date"
              value={review}
              onChange={(e) => setReview(e.target.value)}
            />
          </label>
          <div className="panel-actions">
            {[
              ["in_progress", "학습 중으로 저장"],
              ["completed", "학습 완료"],
            ].map(([state, label]) => (
              <button
                key={state}
                className={`button ${state === "completed" ? "primary" : ""}`}
                disabled={
                  busy || readonly || (state === "completed" && !confirmed)
                }
                onClick={() =>
                  void act(async () => {
                    await send("/learning-progress", "PUT", {
                      itemId: item.id,
                      lessonRevisionId: item.lessonRevisionId,
                      expectedRevision: item.progress?.revision,
                      state,
                      nextReviewAt: review
                        ? new Date(`${review}T09:00:00`).toISOString()
                        : null,
                      checks: {
                        blockResponses: answers,
                        readingConfirmed: reading,
                        selfExplanationAnswers: selfAnswers,
                        exerciseConfirmed: exerciseCheck,
                        userConfirmed: confirmed,
                      },
                    });
                    setNotice("학습 상태와 답안을 저장했습니다.");
                    onSaved();
                  })
                }
              >
                {state === "completed" && <CheckCheck size={13} />} {label}
              </button>
            ))}
          </div>
          <p className="form-hint">
            완료 기록은 현재 단원 버전에만 적용됩니다. 내용이 개정되면 새 버전의
            학습 상태를 따로 관리합니다.
          </p>
        </div>
      )}
      {tab === "history" && (
        <>
          {sessions.loading || submissions.loading ? (
            <Loading />
          ) : sessions.error ? (
            <ErrorState error={sessions.error} retry={sessions.reload} />
          ) : submissions.error ? (
            <ErrorState error={submissions.error} retry={submissions.reload} />
          ) : (
            <>
              <h3>학습 세션</h3>
              {!listOf(sessions.data).length && (
                <p className="form-hint">저장된 학습 세션이 없습니다.</p>
              )}
              {listOf(sessions.data).map((s) => (
                <div className="annotation-card" key={s.id}>
                  <small>
                    {dateLabel(s.startedAt)} ·{" "}
                    {Math.round(s.elapsedSeconds / 60)}분 ·{" "}
                    {s.lessonRevisionId === item.lessonRevisionId
                      ? "현재 학습 버전"
                      : "이전 학습 버전"}
                  </small>
                  {s.reflection}
                </div>
              ))}
              <h3 style={{ marginTop: 20 }}>실습 제출</h3>
              {!listOf(submissions.data).length && (
                <p className="form-hint">제출한 실습 결과가 없습니다.</p>
              )}
              {listOf(submissions.data).map((s) => (
                <div className="annotation-card" key={s.id}>
                  <small>
                    {dateLabel(s.createdAt)} ·{" "}
                    {s.lessonRevisionId === item.lessonRevisionId
                      ? "현재 학습 버전"
                      : "이전 학습 버전"}
                  </small>
                  {s.resultNote}
                  <small>
                    {s.evidencePath}
                    {s.commitRef ? ` · ${s.commitRef}` : ""}
                  </small>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </section>
  );
}
