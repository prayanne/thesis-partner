"use client";
import { useEffect, useRef, useState } from "react";
import { api, errorText, send } from "../lib/api";
import type { Job } from "../lib/types";
const terminal = new Set([
  "succeeded",
  "completed",
  "failed",
  "cancelled",
  "canceled",
  "blocked_config",
]);
const labels: Record<string, string> = {
  queued: "작업 대기 중",
  running: "처리 중",
  succeeded: "완료",
  completed: "완료",
  failed: "작업 실패",
  cancelled: "취소됨",
  canceled: "취소됨",
  blocked_config: "설정이 필요합니다",
};
export function JobStatus({
  job,
  onComplete,
}: {
  job: Job;
  onComplete: () => void;
}) {
  const [current, setCurrent] = useState(job);
  const [error, setError] = useState("");
  const callback = useRef(onComplete);
  callback.current = onComplete;
  useEffect(() => {
    setCurrent(job);
    setError("");
    const id = job.jobId ?? job.id;
    if (!id) {
      setError("서버가 작업 ID를 반환하지 않았습니다.");
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await api<Job>(`/jobs/${id}`);
        if (stopped) return;
        setCurrent(next);
        if (["succeeded", "completed"].includes(next.state)) callback.current();
        if (!terminal.has(next.state)) timer = setTimeout(poll, 1800);
      } catch (e) {
        if (!stopped) setError(errorText(e));
      }
    }
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [job]);
  return (
    <div className="job-state" role="status">
      <span>
        {error || labels[current.state] || current.state}
        {current.errorCode ? ` · ${current.errorCode}` : ""}
        {current.state === "blocked_config" && (
          <>
            <br />
            <a href="/settings">
              환경 설정에서 공급자와 호출 허용을 확인하세요.
            </a>
          </>
        )}
        {!terminal.has(current.state) &&
          current.kind === "translation_group" && (
            <>
              <br />
              페이지 묶음은 일괄 취소를 아직 지원하지 않습니다.{" "}
              <a href="/settings">설정에서 번역 사용을 끄면</a> 대기 작업과 실행
              중 요청의 중단을 시도합니다. 이미 전송한 내용과 비용은 되돌릴 수
              없습니다.
            </>
          )}
      </span>
      {!terminal.has(current.state) && current.kind !== "translation_group" && (
        <button
          className="button small"
          onClick={async () => {
            try {
              const response = await send<Job>(
                `/jobs/${job.jobId ?? job.id}/cancel`,
                "POST",
                {},
              );
              setCurrent(response);
            } catch (e) {
              setError(errorText(e));
            }
          }}
        >
          취소
        </button>
      )}
    </div>
  );
}
