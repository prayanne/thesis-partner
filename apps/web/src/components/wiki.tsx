"use client";
import { useEffect, useState } from "react";
import { Plus, Search, Pencil, Archive, BookOpen } from "lucide-react";
import { useResource, listOf, send, errorText, dateLabel } from "../lib/api";
import type { Wiki } from "../lib/types";
import { Empty, ErrorState, Loading, Modal, Notice, PageHeading } from "./ui";
import { Markdown } from "./markdown";
export function WikiPage() {
  const [showArchived, setShowArchived] = useState(false);
  const pages = useResource<Wiki[] | { items: Wiki[] }>(
    `/wiki${showArchived ? "?includeArchived=true" : ""}`,
  );
  const [selected, setSelected] = useState<string | null>(null);
  const detail = useResource<Wiki>(selected ? `/wiki/${selected}` : null);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Wiki | "new" | null>(null);
  const [archive, setArchive] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!selected && listOf(pages.data).length)
      setSelected(
        new URLSearchParams(window.location.search).get("selected") ??
          listOf(pages.data)[0].id,
      );
  }, [pages.data, selected]);
  return (
    <div className="page">
      <PageHeading
        eyebrow="A GROWING KNOWLEDGE BASE"
        title="개념 위키"
        description="논문 속 개념을 내 언어로 정리하고, 지식 사이에 연결을 만드세요."
        actions={
          <button className="button primary" onClick={() => setEditing("new")}>
            <Plus size={14} />새 문서
          </button>
        }
      />
      <label className="check-item" style={{ marginBottom: 22 }}>
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(e) => {
            setShowArchived(e.target.checked);
            setSelected(null);
          }}
        />
        보관된 문서 포함
      </label>
      {error && <Notice>{error}</Notice>}
      {pages.loading ? (
        <Loading />
      ) : pages.error ? (
        <ErrorState error={pages.error} retry={pages.reload} />
      ) : !listOf(pages.data).length ? (
        <Empty
          title="생각이 머무는 작은 위키"
          action={
            <button
              className="button primary"
              onClick={() => setEditing("new")}
            >
              첫 개념 정리하기
            </button>
          }
        >
          읽으며 만난 개념을 정의, 예시, 근거와 함께 남겨보세요. Markdown으로
          자유롭게 작성할 수 있어요.
        </Empty>
      ) : (
        <div className="split-view">
          <aside className="document-list">
            <div className="search-field">
              <Search size={15} />
              <input
                aria-label="위키 검색"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="개념 찾아보기"
              />
            </div>
            {listOf(pages.data)
              .filter((p) =>
                p.title.toLowerCase().includes(query.toLowerCase()),
              )
              .map((p) => (
                <button
                  key={p.id}
                  className={`document-list-item ${selected === p.id ? "active" : ""}`}
                  onClick={() => setSelected(p.id)}
                >
                  <strong>
                    <BookOpen size={12} style={{ marginRight: 7 }} />
                    {p.title}
                    {p.archivedAt ? " · 보관됨" : ""}
                  </strong>
                  <small>
                    {dateLabel(p.updatedAt)} · v{p.revision}
                  </small>
                </button>
              ))}
          </aside>
          <article className="document-content">
            {detail.loading ? (
              <Loading />
            ) : detail.error ? (
              <ErrorState error={detail.error} retry={detail.reload} />
            ) : (
              detail.data && (
                <>
                  <div className="document-heading">
                    <div>
                      <span className="eyebrow">
                        CONCEPT NOTE · v{detail.data.revision}
                      </span>
                      <h2>{detail.data.title}</h2>
                    </div>
                    <div className="heading-actions">
                      <button
                        className="button small"
                        disabled={Boolean(detail.data.archivedAt)}
                        onClick={() => setEditing(detail.data)}
                      >
                        <Pencil size={12} />
                        수정
                      </button>
                      <button
                        className="icon-button"
                        aria-label={
                          detail.data.archivedAt
                            ? "위키 문서 복구"
                            : "위키 문서 보관"
                        }
                        onClick={() => setArchive(true)}
                      >
                        <Archive size={15} />
                      </button>
                    </div>
                  </div>
                  {detail.data.state === "draft" && (
                    <Notice>
                      초안입니다. 근거를 확인한 뒤 문서를 확정하세요.
                    </Notice>
                  )}
                  <Markdown>
                    {detail.data.markdown || "아직 작성된 본문이 없습니다."}
                  </Markdown>
                </>
              )
            )}
          </article>
        </div>
      )}
      {editing && (
        <WikiEditor
          page={editing}
          close={() => setEditing(null)}
          done={(id) => {
            setEditing(null);
            setSelected(id);
            pages.reload();
            detail.reload();
          }}
        />
      )}
      {archive && detail.data && (
        <Modal
          title={
            detail.data.archivedAt ? "문서를 복구할까요?" : "문서를 보관할까요?"
          }
          close={() => setArchive(false)}
        >
          <p>
            「{detail.data.title}」
            {detail.data.archivedAt
              ? "을 다시 기본 목록에 표시합니다."
              : "을 목록에서 숨깁니다. 이전 내용과 학습 기록은 유지됩니다."}
          </p>
          <div className="form-actions">
            <button className="button" onClick={() => setArchive(false)}>
              취소
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await send(
                    `/wiki/${selected}${detail.data!.archivedAt ? "/restore" : ""}`,
                    detail.data!.archivedAt ? "POST" : "DELETE",
                    { expectedRevision: detail.data!.revision },
                  );
                  setSelected(null);
                  pages.reload();
                  setArchive(false);
                } catch (e) {
                  setError(errorText(e));
                  setArchive(false);
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
function WikiEditor({
  page,
  close,
  done,
}: {
  page: Wiki | "new";
  close: () => void;
  done: (id: string) => void;
}) {
  const [title, setTitle] = useState(page === "new" ? "" : page.title);
  const [slug, setSlug] = useState(page === "new" ? "" : page.slug);
  const [markdown, setMarkdown] = useState(page === "new" ? "" : page.markdown);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={page === "new" ? "새 개념 문서" : "문서 수정"} close={close}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const result = await send<Wiki>(
              page === "new" ? "/wiki" : `/wiki/${page.id}`,
              page === "new" ? "POST" : "PATCH",
              {
                title,
                slug:
                  slug ||
                  title
                    .trim()
                    .replace(/\s+/g, "-")
                    .replace(/[^\p{L}\p{N}_-]/gu, ""),
                markdown,
                ...(page === "new" ? {} : { expectedRevision: page.revision }),
              },
            );
            done(result.id);
          } catch (e) {
            setError(errorText(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          문서 제목
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="예: 정보 은닉과 모듈 경계"
            required
          />
        </label>
        <label>
          문서 식별 이름
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="information-hiding"
          />
        </label>
        <div className="tabs">
          <button
            type="button"
            className={!preview ? "active" : ""}
            onClick={() => setPreview(false)}
          >
            Markdown 편집
          </button>
          <button
            type="button"
            className={preview ? "active" : ""}
            onClick={() => setPreview(true)}
          >
            미리보기
          </button>
        </div>
        {preview ? (
          <Markdown>{markdown}</Markdown>
        ) : (
          <textarea
            className="editor-textarea"
            aria-label="위키 Markdown 본문"
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
            placeholder={
              "## 한 문장 정의\n\n## 작은 예시\n\n## 흔한 오해\n\n## 연결 논문과 근거\n\n## 자기 설명 질문"
            }
          />
        )}{" "}
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
            문서 저장
          </button>
        </div>
      </form>
    </Modal>
  );
}
