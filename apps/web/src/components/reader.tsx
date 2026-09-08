"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Sparkles,
  Send,
  BookmarkPlus,
} from "lucide-react";
import { useResource, listOf, send, errorText, dateLabel } from "../lib/api";
import type {
  Annotation,
  Artifact,
  Job,
  Paper,
  Segment,
  SourceAnchor,
} from "../lib/types";
import { Empty, ErrorState, Loading, Notice } from "./ui";
import { PdfViewer, type PdfSelection } from "./pdf-viewer";
import { JobStatus } from "./jobs";
import { Markdown } from "./markdown";
type Panel = "translation" | "summary" | "chat" | "notes";
export function ReaderPage({ id }: { id: string }) {
  const paper = useResource<Paper>(`/papers/${id}`);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [scale, setScale] = useState(1);
  const [panel, setPanel] = useState<Panel>("translation");
  const [selection, setSelection] = useState<PdfSelection | null>(null);
  const [activeAnchor, setActiveAnchor] = useState<SourceAnchor | null>(null);
  const segments = useResource<Segment[] | { items: Segment[] }>(
    `/papers/${id}/segments?pageNumber=${page}`,
  );
  const annotations = useResource<Annotation[] | { items: Annotation[] }>(
    `/papers/${id}/annotations`,
  );
  const readerConfig = useResource<{ reading: { scale: number } }>("/config");
  const reading = useResource<{
    revision: number;
    paperRevisionId?: string;
    pageNumber: number;
    scale: number;
  }>(`/papers/${id}/reading-state`);
  const [readingError, setReadingError] = useState("");
  const [positionSaving, setPositionSaving] = useState(false);
  const [positionNotice, setPositionNotice] = useState("");
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    if (
      !paper.loading &&
      paper.data &&
      !reading.loading &&
      !readerConfig.loading &&
      !restored
    ) {
      const saved = reading.data;
      if (
        saved &&
        (!saved.paperRevisionId ||
          saved.paperRevisionId === paper.data?.currentRevisionId)
      ) {
        setPage(saved.pageNumber || 1);
        setScale(saved.scale || 1);
      } else {
        setScale(readerConfig.data?.reading.scale ?? 1);
      }
      setRestored(true);
    }
  }, [
    reading.data,
    reading.loading,
    readerConfig.data,
    readerConfig.loading,
    restored,
    paper.loading,
    paper.data?.currentRevisionId,
  ]);
  const selectionChanged = useCallback(
    (value: PdfSelection | null) => setSelection(value),
    [],
  );
  async function savePosition() {
    setReadingError("");
    setPositionNotice("");
    setPositionSaving(true);
    try {
      const result = await send<{
        revision: number;
        pageNumber: number;
        scale: number;
      }>(`/papers/${id}/reading-state`, "PATCH", {
        paperRevisionId: paper.data?.currentRevisionId,
        pageNumber: page,
        scale,
        expectedRevision: reading.data?.revision ?? 1,
      });
      reading.setData(result);
      setPositionNotice("읽기 위치를 저장했습니다.");
    } catch (e) {
      setReadingError(errorText(e));
    } finally {
      setPositionSaving(false);
    }
  }
  if (paper.loading) return <Loading />;
  if (paper.error)
    return (
      <div className="page">
        <ErrorState error={paper.error} retry={paper.reload} />
      </div>
    );
  if (!paper.data) return null;
  const revision = paper.data.currentRevisionId;
  return (
    <div className="reader-page">
      <header className="reader-heading">
        <Link
          className="icon-button"
          href="/"
          aria-label="라이브러리로 돌아가기"
        >
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h1>{paper.data.title}</h1>
          <small>
            {paper.data.metadata?.authors?.join(", ") || "로컬 논문"} · 원문과
            함께 읽기
          </small>
        </div>
      </header>
      <div className="reader-columns">
        <section className="pdf-column" aria-label="PDF 원문">
          <div className="reader-controls">
            <button
              className="icon-button"
              aria-label="이전 페이지"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft size={16} />
            </button>
            <input
              aria-label="페이지 번호"
              disabled={!restored || !pages}
              type="number"
              min={1}
              max={pages || 1}
              value={page}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isInteger(v) && v >= 1 && v <= pages) setPage(v);
              }}
            />
            <span>/ {pages || "—"}</span>
            <button
              className="icon-button"
              aria-label="다음 페이지"
              disabled={!pages || page >= pages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight size={16} />
            </button>
            <span className="control-separator" />
            <select
              aria-label="PDF 확대 비율"
              disabled={!restored || !pages}
              value={scale}
              onChange={(e) => setScale(Number(e.target.value))}
            >
              {[0.5, 0.75, 1, 1.25, 1.5, 2].map((v) => (
                <option key={v} value={v}>
                  {v * 100}%
                </option>
              ))}
            </select>
            <span className="control-separator" />
            <button
              className="button text small"
              disabled={!restored || positionSaving}
              onClick={savePosition}
            >
              읽기 위치 저장
            </button>
          </div>
          {readingError && <Notice>{readingError}</Notice>}
          {positionNotice && <Notice>{positionNotice}</Notice>}
          {revision ? (
            <PdfViewer
              paperId={id}
              revisionId={revision}
              pageNumber={page}
              scale={scale}
              segments={listOf(segments.data)}
              annotations={listOf(annotations.data)}
              onPages={setPages}
              onSelection={selectionChanged}
              activeAnchor={activeAnchor}
            />
          ) : (
            <Empty title="원문이 아직 연결되지 않았어요">
              라이브러리 폴더에 PDF를 넣고 논문에 연결하면 여기에서 읽을 수
              있습니다.
            </Empty>
          )}
        </section>
        <aside className="reader-panel">
          <div className="tabs">
            {(
              [
                ["translation", "번역"],
                ["summary", "요약"],
                ["chat", "질문"],
                ["notes", "메모"],
              ] as [Panel, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                className={panel === key ? "active" : ""}
                onClick={() => setPanel(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="panel-content">
            {panel === "notes" ? (
              <NotesPanel
                paperId={id}
                revisionId={revision ?? ""}
                selection={selection}
                annotations={annotations}
                navigate={(anchor) => {
                  setPage(anchor.pageNumber);
                  setActiveAnchor(anchor);
                }}
              />
            ) : (
              <GenerationPanel
                key={`${id}-${panel}-${page}`}
                paperId={id}
                operation={panel}
                pageNumber={page}
                segments={segments}
                onAnchor={setActiveAnchor}
              />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
function GenerationPanel({
  paperId,
  operation,
  pageNumber,
  segments,
  onAnchor,
}: {
  paperId: string;
  operation: Exclude<Panel, "notes">;
  pageNumber: number;
  segments: ReturnType<typeof useResource<Segment[] | { items: Segment[] }>>;
  onAnchor: (anchor: SourceAnchor | null) => void;
}) {
  const artifacts = useResource<Artifact[] | { items: Artifact[] }>(
    `/papers/${paperId}/artifacts?operation=${operation}${operation === "translation" ? `&pageNumber=${pageNumber}` : ""}`,
  );
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [question, setQuestion] = useState("");
  const [direct, setDirect] = useState<Artifact | null>(null);
  const [segmentId, setSegmentId] = useState("page");
  const selectedSegment = segmentId;
  const titles = {
    translation: "한국어 번역",
    summary: "핵심 내용 정리",
    chat: "논문에 질문하기",
  };
  const artifact =
    direct ??
    listOf(artifacts.data).find(
      (a) =>
        operation !== "translation" ||
        selectedSegment === "page" ||
        translationHasSegment(a, selectedSegment),
    );
  async function generate(cacheMode: "use" | "refresh") {
    setBusy(true);
    setError("");
    try {
      const result = await send<Job | Artifact>(
        `/papers/${paperId}/${operation === "translation" ? "translations" : operation === "summary" ? "summaries" : "chat"}`,
        "POST",
        {
          cacheMode,
          requestId: crypto.randomUUID(),
          scope:
            operation === "translation"
              ? selectedSegment === "page"
                ? { type: "page", pageNumber }
                : { type: "segments", segmentIds: [selectedSegment] }
              : { type: "paper" },
          ...(operation === "translation" ? { targetLanguage: "ko" } : {}),
          ...(operation === "chat" ? { message } : {}),
        },
      );
      if ("jobId" in result || ("state" in result && !("payload" in result))) {
        setJob(result as Job);
      } else setDirect(result as Artifact);
      if (operation === "chat") {
        setQuestion(message);
        setMessage("");
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="panel-title">
        <h2>{titles[operation]}</h2>
        {operation === "translation" && <small>{pageNumber}페이지</small>}
      </div>
      {operation === "translation" && (
        <label style={{ marginBottom: 15 }}>
          번역할 원문 항목
          <select
            aria-label="번역할 원문 항목"
            value={selectedSegment}
            onChange={(e) => {
              setSegmentId(e.target.value);
              setDirect(null);
            }}
          >
            <option value="page">
              현재 페이지 전체 · {listOf(segments.data).length}개 원문 항목
            </option>
            {listOf(segments.data).map((s, i) => (
              <option key={s.id} value={s.id}>
                {i + 1}. {s.sourceText.slice(0, 65)}
              </option>
            ))}
          </select>
          <small>
            현재 페이지 또는 원문 항목 하나를 선택하세요. 페이지 번역은 항목별
            작업으로 진행됩니다.
          </small>
        </label>
      )}
      {operation === "translation" && (
        <Notice>
          단어 정렬은 아직 검증되지 않았습니다. 번역문 hover와 원문 단어 연결은
          제공하지 않습니다.
        </Notice>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {job && <JobStatus job={job} onComplete={artifacts.reload} />}{" "}
      {artifacts.loading ? (
        <Loading label="저장된 결과 확인 중" />
      ) : artifacts.error ? (
        <ErrorState error={artifacts.error} retry={artifacts.reload} />
      ) : artifact ? (
        <>
          <div className="cache-info">
            <span>저장된 결과</span>
            <span>
              {dateLabel(artifact.completedAt ?? artifact.generatedAt)}
            </span>
            {typeof artifact.provenance?.modelId === "string" && (
              <span>{artifact.provenance.modelId}</span>
            )}
          </div>
          {question && <div className="chat-question">{question}</div>}
          <ArtifactContent
            artifact={artifact}
            segmentId={
              operation === "translation" && selectedSegment !== "page"
                ? selectedSegment
                : undefined
            }
          />
        </>
      ) : (
        <Empty
          title={
            operation === "translation"
              ? "원문 옆에서 편하게 읽기"
              : operation === "summary"
                ? "논문의 흐름을 한눈에"
                : "읽다가 궁금해졌나요?"
          }
        >
          {operation === "translation"
            ? "현재 페이지에서 원문 항목을 선택하고 번역을 요청하세요. 저장된 결과는 다시 사용할 수 있어요."
            : operation === "summary"
              ? "핵심 주장과 방법, 한계를 정리합니다. 공급자 설정이 먼저 필요합니다."
              : "논문에 대한 질문을 남겨보세요. 답변의 근거는 원문과 함께 확인해 주세요."}
        </Empty>
      )}
      {operation === "chat" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void generate("use");
          }}
        >
          <label>
            논문에 대한 질문
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="이 논문에서 제안하는 방법의 한계는 무엇인가요?"
              required
            />
          </label>
          <button className="button primary" disabled={busy || !message.trim()}>
            <Send size={13} />
            질문 보내기
          </button>
        </form>
      ) : (
        <div className="panel-actions">
          <button
            className="button primary"
            disabled={busy || (operation === "translation" && !selectedSegment)}
            onClick={() => void generate("use")}
          >
            <Sparkles size={13} />
            {operation === "translation"
              ? selectedSegment === "page"
                ? "페이지 번역 요청"
                : "선택 항목 번역"
              : "요약 요청"}
          </button>
          <button
            className="button"
            disabled={busy || (operation === "translation" && !selectedSegment)}
            onClick={() => void generate("refresh")}
          >
            <RefreshCw size={13} />
            새로 생성
          </button>
        </div>
      )}
      <p className="form-hint">
        요청 버튼을 누를 때만 생성 작업을 시작합니다. 새로 생성은 기존 캐시를
        갱신하며, 허용된 유료 공급자에는 비용이 발생할 수 있습니다.
      </p>
      {operation === "translation" && (
        <details style={{ marginTop: 25 }}>
          <summary className="form-hint">추출된 원문 확인</summary>
          {segments.loading ? (
            <Loading />
          ) : segments.error ? (
            <ErrorState error={segments.error} retry={segments.reload} />
          ) : (
            listOf(segments.data).map((s) => (
              <div className="translation-segment" key={s.id}>
                {s.sourceText}
              </div>
            ))
          )}
        </details>
      )}
    </>
  );
}
function translationHasSegment(artifact: Artifact, id: string) {
  if (!id || !artifact.payload || typeof artifact.payload !== "object")
    return false;
  const p = artifact.payload as Record<string, unknown>;
  const rows = p.segments ?? p.items;
  return (
    Array.isArray(rows) &&
    rows.some(
      (r) =>
        r &&
        typeof r === "object" &&
        (r as Record<string, unknown>).segmentId === id,
    )
  );
}
function ArtifactContent({
  artifact,
  segmentId,
}: {
  artifact: Artifact;
  segmentId?: string;
}) {
  const payload = artifact.payload;
  if (typeof payload === "string") return <Markdown>{payload}</Markdown>;
  if (payload && typeof payload === "object") {
    const value = payload as Record<string, unknown>;
    const text =
      value.text ?? value.translatedText ?? value.summary ?? value.answer;
    if (typeof text === "string")
      return (
        <>
          <Markdown>{text}</Markdown>
          {Array.isArray(value.warnings) &&
            value.warnings.map((warning, i) => (
              <p className="form-hint" key={i}>
                {String(warning)}
              </p>
            ))}
        </>
      );
    const rows = value.segments ?? value.items;
    if (Array.isArray(rows))
      return (
        <>
          {rows
            .filter(
              (row) =>
                !segmentId ||
                (row &&
                  typeof row === "object" &&
                  (row as Record<string, unknown>).segmentId === segmentId),
            )
            .map((row, i) => {
              if (!row || typeof row !== "object") return null;
              const part = row as Record<string, unknown>;
              const translated =
                part.targetText ?? part.translatedText ?? part.text;
              return (
                <div className="translation-segment" key={i}>
                  {typeof part.sourceText === "string" && (
                    <p className="source-quote">{part.sourceText}</p>
                  )}
                  {typeof translated === "string"
                    ? translated
                    : "표시 가능한 번역 본문이 없습니다."}
                </div>
              );
            })}
          {value.attribution &&
          typeof value.attribution === "object" &&
          typeof (value.attribution as Record<string, unknown>).displayText ===
            "string" ? (
            <p className="form-hint" style={{ marginTop: 15 }}>
              {String(
                (value.attribution as Record<string, unknown>).displayText,
              )}
            </p>
          ) : null}
        </>
      );
  }
  return (
    <div className="unsupported">
      저장된 결과의 표시 형식을 지원하지 않습니다. 서버 결과 schema를 확인해
      주세요.
    </div>
  );
}
function NotesPanel({
  paperId,
  revisionId,
  selection,
  annotations,
  navigate,
}: {
  paperId: string;
  revisionId: string;
  selection: PdfSelection | null;
  annotations: ReturnType<
    typeof useResource<Annotation[] | { items: Annotation[] }>
  >;
  navigate: (anchor: SourceAnchor) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(kind: "note" | "highlight") {
    setBusy(true);
    setError("");
    try {
      await send(`/papers/${paperId}/annotations`, "POST", {
        kind,
        text: kind === "highlight" ? selection?.text : text,
        color: "#fde68a",
        paperRevisionId: revisionId,
        ...(selection?.anchor ? { anchor: selection.anchor } : {}),
      });
      setText("");
      annotations.reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="panel-title">
        <h2>나의 읽기 메모</h2>
        <BookmarkPlus size={16} />
      </div>
      {selection && (
        <div className="selection-note">
          <strong>선택한 원문</strong>
          <p>{selection.text}</p>
          {selection.reason && (
            <p className="inline-error">{selection.reason}</p>
          )}
          {selection.anchor && (
            <button
              className="button small"
              style={{ marginTop: 8 }}
              disabled={busy}
              onClick={() => void save("highlight")}
            >
              하이라이트 저장
            </button>
          )}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save("note");
        }}
      >
        <label>
          생각 기록
          <textarea
            placeholder="핵심 아이디어, 연결되는 개념, 다음에 확인할 질문…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            required
          />
        </label>
        {selection && !selection.anchor && (
          <p className="form-hint">
            원문 위치를 확정할 수 없어 위치 연결 없이 메모를 저장합니다.
          </p>
        )}
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
        <button className="button primary" disabled={busy || !text.trim()}>
          메모 저장
        </button>
      </form>
      <hr />
      {annotations.loading ? (
        <Loading />
      ) : annotations.error ? (
        <ErrorState error={annotations.error} retry={annotations.reload} />
      ) : !listOf(annotations.data).length ? (
        <p className="form-hint">
          아직 메모가 없습니다. 원문을 선택하면 검증된 위치에 하이라이트를 남길
          수 있어요.
        </p>
      ) : (
        listOf(annotations.data).map((a) => (
          <div className="annotation-card" key={a.id}>
            {a.text}
            <small>
              {a.kind === "highlight" ? "하이라이트" : "메모"} ·{" "}
              {dateLabel(a.createdAt)}
            </small>
            {a.anchor && (
              <button
                className="button small"
                onClick={() => navigate(a.anchor!)}
              >
                원문 {a.anchor.pageNumber}페이지
              </button>
            )}
          </div>
        ))
      )}
    </>
  );
}
