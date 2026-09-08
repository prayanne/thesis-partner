"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import {
  Plus,
  Search,
  RefreshCw,
  FileText,
  ArrowUpRight,
  Pencil,
  Archive,
  LayoutGrid,
  List,
} from "lucide-react";
import { useResource, listOf, send, errorText, dateLabel } from "../lib/api";
import type { Paper, Job } from "../lib/types";
import { Empty, ErrorState, Loading, Modal, Notice, PageHeading } from "./ui";
import { JobStatus } from "./jobs";
const statusLabels: Record<string, string> = {
  unread: "읽기 전",
  not_started: "읽기 전",
  reading: "읽는 중",
  in_progress: "읽는 중",
  completed: "읽기 완료",
};
export function LibraryPage() {
  const [filter, setFilter] = useState("all");
  const papers = useResource<Paper[] | { items: Paper[] }>(
    `/papers${filter === "archived" ? "?includeArchived=true" : ""}`,
  );
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("grid");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Paper | null>(null);
  const [archiving, setArchiving] = useState<Paper | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [notice, setNotice] = useState("");
  const all = listOf(papers.data);
  const visible = all.filter(
    (p) =>
      `${p.title} ${p.doi ?? ""} ${(p.tags ?? []).join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (filter === "all" ||
        (filter === "archived"
          ? Boolean(p.archivedAt)
          : filter === "reading"
            ? ["reading", "in_progress"].includes(p.readingStatus ?? "")
            : p.readingStatus === filter)),
  );
  async function scan() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await send<Job | { imported?: number; scanned?: number }>(
        "/library/scan",
        "POST",
        {},
      );
      if ("jobId" in result || "state" in result) setJob(result as Job);
      else {
        setNotice(
          `폴더 확인을 완료했습니다${"imported" in result && typeof result.imported === "number" ? ` · ${result.imported}편 등록` : ""}.`,
        );
        papers.reload();
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page">
      <PageHeading
        eyebrow="YOUR RESEARCH, CONNECTED"
        title="라이브러리"
        description="읽고 싶은 논문을 모으고, 나만의 생각을 이어가세요."
        actions={
          <>
            <button className="button" onClick={scan} disabled={busy}>
              <RefreshCw size={14} className={busy ? "spin" : ""} />
              폴더 스캔
            </button>
            <button className="button primary" onClick={() => setAdding(true)}>
              <Plus size={15} />
              논문 추가
            </button>
          </>
        }
      />
      <div className="welcome-banner">
        <div>
          <h2>한 편의 논문에서, 새로운 연결로.</h2>
          <p>원문을 읽고 · 생각을 기록하고 · 개념을 쌓아보세요.</p>
        </div>
        <div className="banner-art" aria-hidden="true">
          <i className="sheet" />
          <i className="sheet" />
          <i className="leaf" />
        </div>
      </div>
      <div className="toolbar">
        <div className="search-field">
          <Search size={16} />
          <input
            aria-label="논문 검색"
            placeholder="제목, 태그 또는 DOI로 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="section-meta">
          <span>
            {papers.data ? `${all.length}편의 논문` : "내 라이브러리"}
          </span>
          <button
            className="icon-button"
            aria-label="카드 보기"
            aria-pressed={mode === "grid"}
            onClick={() => setMode("grid")}
          >
            <LayoutGrid size={15} />
          </button>
          <button
            className="icon-button"
            aria-label="목록 보기"
            aria-pressed={mode === "list"}
            onClick={() => setMode("list")}
          >
            <List size={17} />
          </button>
        </div>
      </div>
      <div className="tabs" style={{ marginBottom: 24 }}>
        {[
          ["all", "전체 논문"],
          ["reading", "읽는 중"],
          ["completed", "읽기 완료"],
          ["archived", "보관함"],
        ].map(([key, label]) => (
          <button
            key={key}
            className={filter === key ? "active" : ""}
            onClick={() => setFilter(key)}
          >
            {label}
            {key === "all" && papers.data && (
              <span className="count">{all.length}</span>
            )}
          </button>
        ))}
      </div>
      {error && <Notice>{error}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      {job && (
        <JobStatus
          job={job}
          onComplete={() => {
            papers.reload();
            setNotice("스캔 작업이 완료되었습니다.");
          }}
        />
      )}
      {papers.loading ? (
        <Loading />
      ) : papers.error ? (
        <ErrorState error={papers.error} retry={papers.reload} />
      ) : visible.length === 0 ? (
        <Empty
          title={
            all.length ? "검색한 논문이 없어요" : "첫 번째 논문을 만나볼까요?"
          }
          action={
            <button className="button primary" onClick={() => setAdding(true)}>
              <Plus size={14} />
              로컬 PDF 연결
            </button>
          }
        >
          {all.length
            ? "검색어나 읽기 상태를 변경해 보세요."
            : "라이브러리 폴더에 PDF를 놓고 연결하세요. 원본은 그대로 두고, 이곳에서 읽기와 기록을 시작합니다."}
        </Empty>
      ) : mode === "grid" ? (
        <div className="paper-grid">
          {visible.map((p) => (
            <article className="paper-card" key={p.id}>
              <div className="card-top">
                <span className="paper-icon">
                  <FileText size={21} strokeWidth={1.25} />
                </span>
                <span className={`status-pill ${p.readingStatus ?? ""}`}>
                  {statusLabels[p.readingStatus ?? "unread"] ?? p.readingStatus}
                </span>
              </div>
              <Link href={`/papers/${p.id}`}>
                <h3>{p.title}</h3>
              </Link>
              <p className="authors">
                {p.metadata?.authors?.length
                  ? p.metadata.authors.join(", ")
                  : "저자 정보 미등록"}
                {p.metadata?.year ? ` · ${p.metadata.year}` : ""}
              </p>
              <div className="tag-row">
                {(p.tags ?? []).map((tag) => (
                  <span className="tag" key={tag}>
                    {tag}
                  </span>
                ))}
              </div>
              <div className="card-footer">
                <Link href={`/papers/${p.id}`}>
                  {p.currentRevisionId ? "읽기 시작" : "원문 미연결"}{" "}
                  <ArrowUpRight size={12} style={{ verticalAlign: "middle" }} />
                </Link>
                <div className="card-menu">
                  <button
                    className="icon-button"
                    aria-label={`${p.title} 수정`}
                    onClick={() => setEditing(p)}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`${p.title} ${p.archivedAt ? "복구" : "보관"}`}
                    onClick={() => setArchiving(p)}
                  >
                    <Archive size={13} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <table className="paper-table">
          <thead>
            <tr>
              <th>논문</th>
              <th>상태</th>
              <th>등록일</th>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link href={`/papers/${p.id}`}>{p.title}</Link>
                </td>
                <td>
                  {statusLabels[p.readingStatus ?? "unread"] ?? p.readingStatus}
                </td>
                <td>{dateLabel(p.createdAt)}</td>
                <td>
                  <button
                    className="icon-button"
                    aria-label="논문 수정"
                    onClick={() => setEditing(p)}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={p.archivedAt ? "논문 복구" : "논문 보관"}
                    onClick={() => setArchiving(p)}
                  >
                    <Archive size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {adding && (
        <ImportDialog
          close={() => setAdding(false)}
          done={() => {
            setAdding(false);
            papers.reload();
          }}
        />
      )}
      {editing && (
        <PaperEditor
          paper={editing}
          close={() => setEditing(null)}
          done={() => {
            setEditing(null);
            papers.reload();
          }}
        />
      )}
      {archiving && (
        <Modal
          title={
            archiving.archivedAt ? "논문을 복구할까요?" : "논문을 보관할까요?"
          }
          close={() => setArchiving(null)}
        >
          <p>
            「{archiving.title}」
            {archiving.archivedAt
              ? "을 기본 목록에 다시 표시합니다."
              : "을 기본 목록에서 숨깁니다. 원본 파일과 연결된 기록은 보존됩니다."}
          </p>
          <div className="form-actions">
            <button className="button" onClick={() => setArchiving(null)}>
              취소
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await send(
                    `/papers/${archiving.id}${archiving.archivedAt ? "/restore" : ""}`,
                    archiving.archivedAt ? "POST" : "DELETE",
                    { expectedRevision: archiving.revision },
                  );
                  setArchiving(null);
                  papers.reload();
                } catch (e) {
                  setError(errorText(e));
                  setArchiving(null);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {archiving.archivedAt ? "복구하기" : "보관하기"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function ImportDialog({
  close,
  done,
}: {
  close: () => void;
  done: () => void;
}) {
  const files = useResource<
    | (string | { relativePath: string; registered?: boolean })[]
    | { items: (string | { relativePath: string; registered?: boolean })[] }
  >("/library/files");
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await send("/papers", "POST", { relativePath: path });
      done();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="라이브러리에 논문 추가" close={close}>
      <form onSubmit={submit}>
        <p className="form-hint">
          설정된 라이브러리 폴더의 PDF를 연결합니다. 파일을 옮기거나 업로드하지
          않습니다.
        </p>
        {files.loading ? (
          <Loading />
        ) : files.error ? (
          <ErrorState error={files.error} retry={files.reload} />
        ) : (
          <div className="file-list">
            {listOf(files.data).map((f) => {
              const relativePath = typeof f === "string" ? f : f.relativePath;
              return (
                <div className="file-option" key={relativePath}>
                  <span>{relativePath}</span>
                  <button
                    type="button"
                    className="button small"
                    onClick={() => setPath(relativePath)}
                    disabled={typeof f !== "string" && f.registered}
                  >
                    선택
                  </button>
                </div>
              );
            })}
            {!listOf(files.data).length && (
              <p className="form-hint">
                PDF가 없습니다. 라이브러리 폴더에 파일을 넣은 뒤 목록을 다시
                불러오세요.
              </p>
            )}
          </div>
        )}
        <label>
          폴더 안의 상대 경로
          <input
            placeholder="systems/paper.pdf"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            required
          />
        </label>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="button" onClick={files.reload}>
            목록 새로고침
          </button>
          <button
            className="button primary"
            disabled={busy || !path.toLowerCase().endsWith(".pdf")}
          >
            {busy ? "연결 중…" : "논문 연결"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function PaperEditor({
  paper,
  close,
  done,
}: {
  paper: Paper;
  close: () => void;
  done: () => void;
}) {
  const [title, setTitle] = useState(paper.title);
  const [doi, setDoi] = useState(paper.doi ?? "");
  const [tags, setTags] = useState((paper.tags ?? []).join(", "));
  const [status, setStatus] = useState(paper.readingStatus ?? "unread");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="논문 정보 수정" close={close}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await send(`/papers/${paper.id}`, "PATCH", {
              expectedRevision: paper.revision,
              title,
              doi: doi || null,
              tags: tags
                .split(",")
                .map((v) => v.trim())
                .filter(Boolean),
              readingStatus: status,
            });
            done();
          } catch (e) {
            setError(errorText(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          제목
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </label>
        <label>
          DOI
          <input value={doi} onChange={(e) => setDoi(e.target.value)} />
        </label>
        <label>
          태그 <small>쉼표로 구분</small>
          <input value={tags} onChange={(e) => setTags(e.target.value)} />
        </label>
        <label>
          읽기 상태
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="unread">읽기 전</option>
            <option value="reading">읽는 중</option>
            <option value="completed">읽기 완료</option>
          </select>
        </label>
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="button" onClick={close}>
            취소
          </button>
          <button className="button primary" disabled={busy}>
            변경 저장
          </button>
        </div>
      </form>
    </Modal>
  );
}
