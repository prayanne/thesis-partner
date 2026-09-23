"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Archive,
  BookOpen,
  ExternalLink,
  FileText,
  FolderKanban,
  Link2,
  NotebookPen,
  Pencil,
  Plus,
  Search,
} from "lucide-react";
import { errorText, listOf, send, useResource } from "../lib/api";
import type {
  Paper,
  ProjectMaterial,
  ProjectMaterialKind,
  ProjectStatus,
  ResearchProject,
  Wiki,
} from "../lib/types";
import { Markdown } from "./markdown";
import { Empty, ErrorState, Loading, Modal, Notice, PageHeading } from "./ui";

const statusLabel: Record<ProjectStatus, string> = {
  active: "진행 중",
  paused: "잠시 멈춤",
  completed: "정리 완료",
};
const kindLabel: Record<ProjectMaterialKind, string> = {
  paper: "논문",
  wiki: "Wiki",
  link: "외부 링크",
  note: "직접 메모",
};

export function ProjectsPage() {
  const [showArchived, setShowArchived] = useState(false);
  const projects = useResource<
    ResearchProject[] | { items: ResearchProject[] }
  >(`/projects${showArchived ? "?includeArchived=true" : ""}`);
  const [selected, setSelected] = useState<string | null>(null);
  const detail = useResource<ResearchProject>(
    selected
      ? `/projects/${selected}${showArchived ? "?includeArchived=true" : ""}`
      : null,
  );
  const papers = useResource<Paper[] | { items: Paper[] }>("/papers");
  const wikis = useResource<Wiki[] | { items: Wiki[] }>("/wiki");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<ResearchProject | "new" | null>(null);
  const [materialEditor, setMaterialEditor] = useState<
    ProjectMaterial | "new" | null
  >(null);
  const [archiveProject, setArchiveProject] = useState(false);
  const [summaryEditing, setSummaryEditing] = useState(false);
  const [summary, setSummary] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const rows = listOf(projects.data);
    if (!selected && rows.length) setSelected(rows[0]!.id);
    if (selected && projects.data && !rows.some((row) => row.id === selected))
      setSelected(rows[0]?.id ?? null);
  }, [projects.data, selected]);
  useEffect(() => {
    setSummary(detail.data?.summaryMarkdown ?? "");
    setSummaryEditing(false);
  }, [detail.data?.id, detail.data?.revision, detail.data?.summaryMarkdown]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return listOf(projects.data).filter(
      (project) =>
        !needle ||
        `${project.title} ${project.domain} ${project.description}`
          .toLowerCase()
          .includes(needle),
    );
  }, [projects.data, query]);

  function refreshed(message?: string) {
    projects.reload();
    detail.reload();
    if (message) setNotice(message);
  }

  return (
    <div className="page projects-page">
      <PageHeading
        eyebrow="RESEARCH, ORGANIZED BY PURPOSE"
        title="프로젝트"
        description="하나의 연구 주제에 논문과 자료를 모으고, 근거를 비교하며 통합 요약을 정리하세요."
        actions={
          <button className="button primary" onClick={() => setEditing("new")}>
            <Plus size={14} />새 프로젝트
          </button>
        }
      />
      <div className="project-toolbar">
        <div className="search-field">
          <Search size={15} />
          <input
            aria-label="프로젝트 검색"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="프로젝트 또는 도메인 검색"
          />
        </div>
        <label className="check-item">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(event) => {
              setShowArchived(event.target.checked);
              setSelected(null);
            }}
          />
          보관된 프로젝트·자료 포함
        </label>
      </div>
      {error && <Notice>{error}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      {projects.loading ? (
        <Loading />
      ) : projects.error ? (
        <ErrorState error={projects.error} retry={projects.reload} />
      ) : !listOf(projects.data).length ? (
        <Empty
          title="첫 연구 프로젝트를 만들어 보세요"
          action={
            <button
              className="button primary"
              onClick={() => setEditing("new")}
            >
              프로젝트 만들기
            </button>
          }
        >
          도메인과 질문을 정한 뒤 라이브러리 논문, Wiki, 링크와 메모를 한곳에
          모을 수 있습니다.
        </Empty>
      ) : (
        <div className="project-layout">
          <aside className="project-list" aria-label="프로젝트 목록">
            {visible.map((project) => (
              <button
                key={project.id}
                className={`project-list-item ${selected === project.id ? "active" : ""}`}
                onClick={() => setSelected(project.id)}
              >
                <span className="project-list-icon">
                  <FolderKanban size={17} />
                </span>
                <span>
                  <strong>
                    {project.title}
                    {project.archivedAt ? " · 보관됨" : ""}
                  </strong>
                  <small>{project.domain}</small>
                  <small>
                    논문 {project.paperCount ?? 0}편 · 자료{" "}
                    {project.materialCount ?? 0}개
                  </small>
                </span>
              </button>
            ))}
            {!visible.length && (
              <p className="form-hint">검색 결과가 없습니다.</p>
            )}
          </aside>
          <section className="project-detail">
            {detail.loading ? (
              <Loading />
            ) : detail.error ? (
              <ErrorState error={detail.error} retry={detail.reload} />
            ) : detail.data ? (
              <>
                <header className="project-detail-heading">
                  <div>
                    <span className="eyebrow">{detail.data.domain}</span>
                    <h2>{detail.data.title}</h2>
                    <span className={`project-status ${detail.data.status}`}>
                      {statusLabel[detail.data.status]}
                    </span>
                  </div>
                  <div className="heading-actions">
                    <button
                      className="button small"
                      disabled={Boolean(detail.data.archivedAt)}
                      onClick={() => setEditing(detail.data!)}
                    >
                      <Pencil size={12} />
                      프로젝트 설정
                    </button>
                    <button
                      className="icon-button"
                      aria-label={
                        detail.data.archivedAt
                          ? "프로젝트 복구"
                          : "프로젝트 보관"
                      }
                      onClick={() => setArchiveProject(true)}
                    >
                      <Archive size={15} />
                    </button>
                  </div>
                </header>
                {detail.data.description && (
                  <p className="project-description">
                    {detail.data.description}
                  </p>
                )}
                <section
                  className="project-summary"
                  aria-labelledby="project-summary-title"
                >
                  <div className="section-heading">
                    <div>
                      <span className="eyebrow">SYNTHESIS</span>
                      <h3 id="project-summary-title">통합 요약</h3>
                    </div>
                    {!detail.data.archivedAt && (
                      <button
                        className="button small"
                        onClick={() => setSummaryEditing((value) => !value)}
                      >
                        <NotebookPen size={12} />
                        {summaryEditing ? "미리보기" : "요약 편집"}
                      </button>
                    )}
                  </div>
                  {summaryEditing ? (
                    <form
                      onSubmit={async (event) => {
                        event.preventDefault();
                        setBusy(true);
                        setError("");
                        try {
                          await send(`/projects/${detail.data!.id}`, "PATCH", {
                            expectedRevision: detail.data!.revision,
                            summaryMarkdown: summary,
                          });
                          setSummaryEditing(false);
                          refreshed("프로젝트 통합 요약을 저장했습니다.");
                        } catch (caught) {
                          setError(errorText(caught));
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      <label>
                        프로젝트 통합 요약 Markdown
                        <textarea
                          className="project-summary-input"
                          value={summary}
                          onChange={(event) => setSummary(event.target.value)}
                          placeholder={
                            "## 현재 결론\n\n논문과 자료를 비교해 공통점, 차이, 근거와 다음 질문을 정리하세요."
                          }
                        />
                      </label>
                      <p className="form-hint">
                        이 내용은 자동 생성되지 않습니다. 외부 AI 호출 없이 직접
                        편집하고 로컬 DB에 저장합니다.
                      </p>
                      <div className="form-actions">
                        <button
                          type="button"
                          className="button"
                          onClick={() => {
                            setSummary(detail.data!.summaryMarkdown);
                            setSummaryEditing(false);
                          }}
                        >
                          취소
                        </button>
                        <button className="button primary" disabled={busy}>
                          통합 요약 저장
                        </button>
                      </div>
                    </form>
                  ) : detail.data.summaryMarkdown ? (
                    <Markdown>{detail.data.summaryMarkdown}</Markdown>
                  ) : (
                    <div className="project-summary-empty">
                      자료를 모은 뒤 핵심 주장, 상충하는 근거, 남은 질문을 한
                      문서로 정리하세요.
                    </div>
                  )}
                </section>
                <section
                  className="project-materials"
                  aria-labelledby="project-materials-title"
                >
                  <div className="section-heading">
                    <div>
                      <span className="eyebrow">EVIDENCE BOARD</span>
                      <h3 id="project-materials-title">
                        프로젝트 자료{" "}
                        <small>
                          {detail.data.materials?.filter(
                            (item) => !item.archivedAt,
                          ).length ?? 0}
                        </small>
                      </h3>
                    </div>
                    <button
                      className="button primary small"
                      disabled={Boolean(detail.data.archivedAt)}
                      onClick={() => setMaterialEditor("new")}
                    >
                      <Plus size={12} />
                      자료 추가
                    </button>
                  </div>
                  {!detail.data.materials?.length ? (
                    <Empty
                      title="프로젝트 자료가 아직 없습니다"
                      action={
                        <button
                          className="button primary"
                          disabled={Boolean(detail.data.archivedAt)}
                          onClick={() => setMaterialEditor("new")}
                        >
                          첫 자료 연결
                        </button>
                      }
                    >
                      라이브러리 논문과 Wiki를 참조하거나 링크와 직접 메모를
                      추가하세요.
                    </Empty>
                  ) : (
                    <div className="project-material-grid">
                      {detail.data.materials.map((material) => (
                        <MaterialCard
                          key={material.id}
                          material={material}
                          projectArchived={Boolean(detail.data!.archivedAt)}
                          edit={() => setMaterialEditor(material)}
                          changed={refreshed}
                          failed={(message) => setError(message)}
                        />
                      ))}
                    </div>
                  )}
                </section>
              </>
            ) : null}
          </section>
        </div>
      )}

      {editing && (
        <ProjectEditor
          project={editing}
          close={() => setEditing(null)}
          done={(project) => {
            setEditing(null);
            setSelected(project.id);
            refreshed(
              editing === "new"
                ? "프로젝트를 만들었습니다."
                : "프로젝트 설정을 저장했습니다.",
            );
          }}
        />
      )}
      {materialEditor && detail.data && (
        <MaterialEditor
          material={materialEditor}
          projectId={detail.data.id}
          papers={listOf(papers.data)}
          wikis={listOf(wikis.data)}
          close={() => setMaterialEditor(null)}
          done={() => {
            setMaterialEditor(null);
            refreshed(
              materialEditor === "new"
                ? "프로젝트 자료를 추가했습니다."
                : "자료 메모를 저장했습니다.",
            );
          }}
        />
      )}
      {archiveProject && detail.data && (
        <Modal
          title={
            detail.data.archivedAt
              ? "프로젝트를 복구할까요?"
              : "프로젝트를 보관할까요?"
          }
          close={() => setArchiveProject(false)}
        >
          <p>
            「{detail.data.title}」을
            {detail.data.archivedAt
              ? " 다시 기본 목록에 표시합니다."
              : " 목록에서 숨깁니다. 연결한 논문·Wiki·링크·메모는 삭제되지 않습니다."}
          </p>
          <div className="form-actions">
            <button className="button" onClick={() => setArchiveProject(false)}>
              취소
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await send(
                    `/projects/${detail.data!.id}${detail.data!.archivedAt ? "/restore" : ""}`,
                    detail.data!.archivedAt ? "POST" : "DELETE",
                    { expectedRevision: detail.data!.revision },
                  );
                  setArchiveProject(false);
                  setSelected(null);
                  projects.reload();
                } catch (caught) {
                  setError(errorText(caught));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {detail.data.archivedAt ? "복구" : "보관"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function MaterialCard({
  material,
  projectArchived,
  edit,
  changed,
  failed,
}: {
  material: ProjectMaterial;
  projectArchived: boolean;
  edit: () => void;
  changed: (message?: string) => void;
  failed: (message: string) => void;
}) {
  const Icon =
    material.kind === "paper"
      ? FileText
      : material.kind === "wiki"
        ? BookOpen
        : material.kind === "link"
          ? Link2
          : NotebookPen;
  const body =
    material.kind === "wiki" ? material.wiki?.markdown : material.content;
  return (
    <article
      className={`project-material-card ${material.archivedAt ? "archived" : ""}`}
    >
      <header>
        <span className="project-material-icon">
          <Icon size={17} />
        </span>
        <div>
          <small>
            {kindLabel[material.kind]}
            {material.archivedAt ? " · 보관됨" : ""}
          </small>
          <h4>{material.title}</h4>
        </div>
      </header>
      {material.kind === "paper" && material.paper && (
        <>
          <p>{material.paper.abstract || "초록이 등록되지 않은 논문입니다."}</p>
          <div className="tag-row">
            {(material.paper.tags ?? []).slice(0, 5).map((tag) => (
              <span className="tag" key={tag}>
                {tag}
              </span>
            ))}
          </div>
        </>
      )}
      {body && (
        <div className="project-material-body">
          <Markdown>{body}</Markdown>
        </div>
      )}
      {material.note && (
        <div className="project-material-note">
          <strong>프로젝트 메모</strong>
          <p>{material.note}</p>
        </div>
      )}
      <footer>
        <div>
          {material.paperId && (
            <Link className="button small" href={`/papers/${material.paperId}`}>
              논문 열기
            </Link>
          )}
          {material.wikiId && (
            <Link
              className="button small"
              href={`/wiki?selected=${material.wikiId}`}
            >
              Wiki 열기
            </Link>
          )}
          {material.sourceUrl && (
            <a
              className="button small"
              href={material.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              출처 열기 <ExternalLink size={11} />
            </a>
          )}
        </div>
        <div>
          {!material.archivedAt && !projectArchived && (
            <button className="button small" onClick={edit}>
              <Pencil size={11} />
              메모 편집
            </button>
          )}
          {!projectArchived && (
            <button
              className="icon-button"
              aria-label={
                material.archivedAt
                  ? `${material.title} 자료 복구`
                  : `${material.title} 자료 보관`
              }
              onClick={async () => {
                try {
                  await send(
                    `/project-materials/${material.id}${material.archivedAt ? "/restore" : ""}`,
                    material.archivedAt ? "POST" : "DELETE",
                    { expectedRevision: material.revision },
                  );
                  changed(
                    material.archivedAt
                      ? "자료를 복구했습니다."
                      : "자료를 프로젝트에서 보관했습니다.",
                  );
                } catch (caught) {
                  failed(errorText(caught));
                }
              }}
            >
              <Archive size={13} />
            </button>
          )}
        </div>
      </footer>
    </article>
  );
}

function ProjectEditor({
  project,
  close,
  done,
}: {
  project: ResearchProject | "new";
  close: () => void;
  done: (project: ResearchProject) => void;
}) {
  const [title, setTitle] = useState(project === "new" ? "" : project.title);
  const [domain, setDomain] = useState(project === "new" ? "" : project.domain);
  const [description, setDescription] = useState(
    project === "new" ? "" : project.description,
  );
  const [status, setStatus] = useState<ProjectStatus>(
    project === "new" ? "active" : project.status,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={project === "new" ? "새 연구 프로젝트" : "프로젝트 설정"}
      close={close}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            const saved = await send<ResearchProject>(
              project === "new" ? "/projects" : `/projects/${project.id}`,
              project === "new" ? "POST" : "PATCH",
              {
                title,
                domain,
                description,
                status,
                ...(project === "new"
                  ? {}
                  : { expectedRevision: project.revision }),
              },
            );
            done(saved);
          } catch (caught) {
            setError(errorText(caught));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          프로젝트 이름
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            placeholder="예: 로컬 우선 RAG 연구"
          />
        </label>
        <label>
          연구 도메인
          <input
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
            required
            placeholder="예: Information Retrieval · Local-first AI"
          />
        </label>
        <label>
          프로젝트 목표와 질문
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="이 프로젝트에서 비교하고 답하려는 질문을 적으세요."
          />
        </label>
        <label>
          진행 상태
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as ProjectStatus)}
          >
            {Object.entries(statusLabel).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="button" onClick={close}>
            취소
          </button>
          <button className="button primary" disabled={busy}>
            {project === "new" ? "프로젝트 만들기" : "설정 저장"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function MaterialEditor({
  material,
  projectId,
  papers,
  wikis,
  close,
  done,
}: {
  material: ProjectMaterial | "new";
  projectId: string;
  papers: Paper[];
  wikis: Wiki[];
  close: () => void;
  done: () => void;
}) {
  const [kind, setKind] = useState<ProjectMaterialKind>(
    material === "new" ? "paper" : material.kind,
  );
  const [paperId, setPaperId] = useState(
    material === "new" ? "" : (material.paperId ?? ""),
  );
  const [wikiId, setWikiId] = useState(
    material === "new" ? "" : (material.wikiId ?? ""),
  );
  const [title, setTitle] = useState(material === "new" ? "" : material.title);
  const [sourceUrl, setSourceUrl] = useState(
    material === "new" ? "" : (material.sourceUrl ?? ""),
  );
  const [content, setContent] = useState(
    material === "new" ? "" : material.content,
  );
  const [note, setNote] = useState(material === "new" ? "" : material.note);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  function payload() {
    if (material !== "new")
      return {
        expectedRevision: material.revision,
        ...(kind === "link" || kind === "note" ? { title, content } : {}),
        note,
      };
    if (kind === "paper") return { kind, paperId, note };
    if (kind === "wiki") return { kind, wikiId, note };
    if (kind === "link") return { kind, title, sourceUrl, content, note };
    return { kind, title, content, note };
  }
  return (
    <Modal
      title={material === "new" ? "프로젝트 자료 추가" : "프로젝트 자료 편집"}
      close={close}
    >
      <form
        onSubmit={async (event: FormEvent) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            await send(
              material === "new"
                ? `/projects/${projectId}/materials`
                : `/project-materials/${material.id}`,
              material === "new" ? "POST" : "PATCH",
              payload(),
            );
            done();
          } catch (caught) {
            setError(errorText(caught));
          } finally {
            setBusy(false);
          }
        }}
      >
        {material === "new" && (
          <label>
            자료 종류
            <select
              aria-label="프로젝트 자료 종류"
              value={kind}
              onChange={(event) =>
                setKind(event.target.value as ProjectMaterialKind)
              }
            >
              {Object.entries(kindLabel).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === "paper" && (
          <label>
            라이브러리 논문
            <select
              aria-label="프로젝트에 추가할 논문"
              value={paperId}
              onChange={(event) => setPaperId(event.target.value)}
              required
              disabled={material !== "new"}
            >
              <option value="">논문 선택</option>
              {papers.map((paper) => (
                <option key={paper.id} value={paper.id}>
                  {paper.title}
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === "wiki" && (
          <label>
            개념 Wiki
            <select
              aria-label="프로젝트에 추가할 Wiki"
              value={wikiId}
              onChange={(event) => setWikiId(event.target.value)}
              required
              disabled={material !== "new"}
            >
              <option value="">Wiki 선택</option>
              {wikis.map((wiki) => (
                <option key={wiki.id} value={wiki.id}>
                  {wiki.title}
                </option>
              ))}
            </select>
          </label>
        )}
        {(kind === "link" || kind === "note") && (
          <label>
            자료 제목
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
            />
          </label>
        )}
        {kind === "link" && material === "new" && (
          <label>
            출처 URL
            <input
              type="url"
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.target.value)}
              required
              placeholder="https://"
            />
          </label>
        )}
        {(kind === "link" || kind === "note") && (
          <label>
            {kind === "link" ? "발췌·설명 Markdown" : "메모 Markdown"}
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              required={kind === "note"}
            />
          </label>
        )}
        <label>
          이 프로젝트에서의 메모
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="이 자료가 프로젝트 주장에 주는 근거, 반례, 확인할 점…"
          />
        </label>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="button" onClick={close}>
            취소
          </button>
          <button className="button primary" disabled={busy}>
            {material === "new" ? "자료 추가" : "자료 메모 저장"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
