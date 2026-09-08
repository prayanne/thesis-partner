"use client";
import { useEffect, useState } from "react";
import {
  Plus,
  Pencil,
  Archive,
  ChevronUp,
  ChevronDown,
  GraduationCap,
  RotateCcw,
  Link2,
} from "lucide-react";
import { useResource, listOf, send, errorText } from "../lib/api";
import type {
  Curriculum,
  CurriculumItem,
  LessonBlock,
  BlockKind,
  LearningResource,
} from "../lib/types";
import {
  blockDefinitions,
  newBlock,
  reorder,
  supportedBlock,
} from "../lib/lesson-blocks";
import { Empty, ErrorState, Loading, Modal, Notice, PageHeading } from "./ui";
import { LessonBlockEditor, LessonBlockRenderer } from "./lesson-blocks";
import { LearningRecords } from "./learning-records";
export function CurriculumPage() {
  const [archived, setArchived] = useState(false);
  const curricula = useResource<Curriculum[]>(
    `/curricula${archived ? "?includeArchived=true" : ""}`,
  );
  const [id, setId] = useState<string | null>(null);
  const curriculum = useResource<Curriculum>(
    id ? `/curricula/${id}${archived ? "?includeArchived=true" : ""}` : null,
  );
  const [itemId, setItemId] = useState<string | null>(null);
  const [editCurriculum, setEditCurriculum] = useState<
    Curriculum | "new" | null
  >(null);
  const [editItem, setEditItem] = useState<CurriculumItem | "new" | null>(null);
  const [dependency, setDependency] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<{
    path: string;
    revision: number;
    title: string;
    restore?: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!id && listOf(curricula.data).length)
      setId(listOf(curricula.data)[0].id);
  }, [curricula.data, id]);
  const current = curriculum.data;
  const items = current?.items ?? [];
  const item =
    items.find((i) => i.id === itemId) ??
    items.find((i) => i.kind === "lesson") ??
    items[0];
  const lessons = items.filter((i) => i.kind === "lesson" && !i.archivedAt);
  const completed = lessons.filter(
    (i) => i.progress?.state === "completed",
  ).length;
  async function move(from: number, to: number) {
    if (!current) return;
    setError("");
    try {
      await send(`/curricula/${id}/reorder`, "POST", {
        expectedRevision: current.revision,
        itemIds: reorder(
          items.filter((i) => !i.archivedAt),
          from,
          to,
        ).map((i) => i.id),
      });
      curriculum.reload();
    } catch (e) {
      setError(errorText(e));
    }
  }
  const reload = () => {
    curriculum.reload();
    curricula.reload();
  };
  return (
    <div className="page">
      <PageHeading
        eyebrow="LEARN BY READING & BUILDING"
        title="학습 커리큘럼"
        description="개념을 읽고, 직접 만들어 보고, 배운 것을 나의 언어로 남기세요."
        actions={
          <button
            className="button primary"
            onClick={() => setEditCurriculum("new")}
          >
            <Plus size={14} />
            커리큘럼 만들기
          </button>
        }
      />
      {error && <Notice>{error}</Notice>}
      <div className="toolbar">
        <select
          aria-label="커리큘럼 선택"
          style={{ maxWidth: 400 }}
          value={id ?? ""}
          onChange={(e) => {
            setId(e.target.value);
            setItemId(null);
          }}
        >
          <option value="" disabled>
            커리큘럼 선택
          </option>
          {listOf(curricula.data).map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
              {c.archivedAt ? " · 보관됨" : ""}
            </option>
          ))}
        </select>
        <label className="check-item">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => {
              setArchived(e.target.checked);
              setId(null);
            }}
          />
          보관된 항목 포함
        </label>
      </div>
      {curricula.loading ? (
        <Loading />
      ) : curricula.error ? (
        <ErrorState error={curricula.error} retry={curricula.reload} />
      ) : !listOf(curricula.data).length ? (
        <Empty
          title="배움의 경로를 설계하세요"
          action={
            <button
              className="button primary"
              onClick={() => setEditCurriculum("new")}
            >
              첫 커리큘럼 만들기
            </button>
          }
        >
          단원과 읽기 자료, 자기 설명 질문, 실습을 연결해 보세요. 학습 내용은
          자유롭게 추가하고 수정할 수 있습니다.
        </Empty>
      ) : curriculum.loading ? (
        <Loading />
      ) : curriculum.error ? (
        <ErrorState error={curriculum.error} retry={curriculum.reload} />
      ) : (
        current && (
          <>
            <div className="document-heading">
              <div>
                <h2>{current.title}</h2>
                <p className="form-hint">{current.description}</p>
              </div>
              <div className="heading-actions">
                <button
                  className="button small"
                  onClick={() => setEditCurriculum(current)}
                >
                  <Pencil size={12} />
                  편집
                </button>
                <button
                  className="button small"
                  onClick={() => setDependency(true)}
                >
                  <Link2 size={12} />
                  선수 관계
                </button>
                <button
                  className="icon-button"
                  aria-label={
                    current.archivedAt ? "커리큘럼 복구" : "커리큘럼 보관"
                  }
                  onClick={() =>
                    setConfirm({
                      path: `/curricula/${id}`,
                      revision: current.revision,
                      title: current.title,
                      restore: Boolean(current.archivedAt),
                    })
                  }
                >
                  {current.archivedAt ? (
                    <RotateCcw size={15} />
                  ) : (
                    <Archive size={15} />
                  )}
                </button>
              </div>
            </div>
            <div className="progress-summary">
              <span>
                {completed} / {lessons.length} 단원 완료
              </span>
              <div className="progress-track">
                <div
                  className="progress-fill"
                  style={{
                    width: `${lessons.length ? (completed / lessons.length) * 100 : 0}%`,
                  }}
                />
              </div>
              <span>나의 속도로, 꾸준히</span>
            </div>
            <div className="curriculum-layout">
              <aside className="lesson-list">
                <div className="panel-title">
                  <h3>학습 단원</h3>
                  <button
                    className="icon-button"
                    aria-label="단원 추가"
                    disabled={Boolean(current.archivedAt)}
                    onClick={() => setEditItem("new")}
                  >
                    <Plus size={17} />
                  </button>
                </div>
                {items.map((i, index) => (
                  <div
                    className={`lesson-item ${item?.id === i.id ? "active" : ""} ${i.kind === "section" ? "section" : ""}`}
                    key={i.id}
                  >
                    <button onClick={() => setItemId(i.id)}>
                      <span>
                        {i.kind === "section" ? "▤ " : ""}
                        {i.title}
                        {i.archivedAt ? " · 보관됨" : ""}
                      </span>
                      <small>
                        {i.kind === "lesson"
                          ? `${i.estimatedMinutes ?? "—"}분 · ${i.progress?.state === "completed" ? "완료" : i.progress?.state === "in_progress" ? "학습 중" : "시작 전"}`
                          : "섹션"}
                      </small>
                    </button>
                    {!archived && (
                      <div>
                        <button
                          className="icon-button"
                          aria-label={`${i.title} 위로 이동`}
                          disabled={index === 0}
                          onClick={() => void move(index, index - 1)}
                        >
                          <ChevronUp size={12} />
                        </button>
                        <button
                          className="icon-button"
                          aria-label={`${i.title} 아래로 이동`}
                          disabled={index === items.length - 1}
                          onClick={() => void move(index, index + 1)}
                        >
                          <ChevronDown size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </aside>
              <div className="lesson-detail">
                {!item ? (
                  <Empty title="첫 학습 단원을 추가하세요">
                    설명, 자료 읽기, 자기 설명, 실습, 체크리스트를 조합할 수
                    있습니다.
                  </Empty>
                ) : (
                  <>
                    <div className="document-heading">
                      <div>
                        <span className="eyebrow">
                          LESSON · VERSION {item.contentVersion}
                        </span>
                        <h2>{item.title}</h2>
                      </div>
                      <div className="heading-actions">
                        <button
                          className="button small"
                          disabled={
                            Boolean(item.archivedAt) ||
                            Boolean(current.archivedAt)
                          }
                          onClick={() => setEditItem(item)}
                        >
                          <Pencil size={12} />
                          단원 편집
                        </button>
                        <button
                          className="icon-button"
                          aria-label={
                            item.archivedAt ? "단원 복구" : "단원 보관"
                          }
                          onClick={() =>
                            setConfirm({
                              path: `/curriculum-items/${item.id}`,
                              revision: item.revision,
                              title: item.title,
                              restore: Boolean(item.archivedAt),
                            })
                          }
                        >
                          {item.archivedAt ? (
                            <RotateCcw size={15} />
                          ) : (
                            <Archive size={15} />
                          )}
                        </button>
                      </div>
                    </div>
                    {item.kind === "section" ? (
                      <Notice>
                        이 섹션의 단원:{" "}
                        {items
                          .filter((i) => i.parentId === item.id)
                          .map((i) => i.title)
                          .join(", ") || "없음"}
                        . 단원이 포함된 섹션은 먼저 각 단원을 옮기거나 보관해야
                        합니다.
                      </Notice>
                    ) : (
                      <LessonContent
                        key={`${item.id}-${item.contentVersion}`}
                        item={item}
                        onSaved={curriculum.reload}
                      />
                    )}
                  </>
                )}
              </div>
            </div>
          </>
        )
      )}
      {editCurriculum && (
        <CurriculumEditor
          value={editCurriculum}
          close={() => setEditCurriculum(null)}
          done={(newId) => {
            setEditCurriculum(null);
            setId(newId);
            reload();
          }}
        />
      )}
      {editItem && current && (
        <ItemEditor
          value={editItem}
          curriculum={current}
          close={() => setEditItem(null)}
          done={(newId) => {
            setEditItem(null);
            setItemId(newId);
            reload();
          }}
        />
      )}
      {dependency && current && (
        <DependencyEditor
          curriculum={current}
          close={() => setDependency(false)}
          done={reload}
        />
      )}{" "}
      {confirm && (
        <Modal
          title={confirm.restore ? "보관된 항목 복구" : "항목 보관"}
          close={() => setConfirm(null)}
        >
          <p>
            「{confirm.title}」
            {confirm.restore
              ? "을 다시 표시합니다."
              : "을 기본 목록에서 숨깁니다. 이전 학습 기록은 보존됩니다."}
          </p>
          <div className="form-actions">
            <button className="button" onClick={() => setConfirm(null)}>
              취소
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await send(
                    `${confirm.path}${confirm.restore ? "/restore" : ""}`,
                    confirm.restore ? "POST" : "DELETE",
                    { expectedRevision: confirm.revision },
                  );
                  setConfirm(null);
                  if (!confirm.restore && confirm.path === `/curricula/${id}`)
                    setId(null);
                  reload();
                } catch (e) {
                  setError(errorText(e));
                  setConfirm(null);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {confirm.restore ? "복구" : "보관"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function LessonContent({
  item,
  onSaved,
}: {
  item: CurriculumItem;
  onSaved: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    const result: Record<string, string> = {
      ...item.progress?.checks?.blockResponses,
    };
    let index = 0;
    for (const block of item.blocks ?? [])
      if (
        block.kind === "self_explanation" &&
        Array.isArray(block.payload.questions)
      )
        block.payload.questions.forEach((_, i) => {
          result[`${block.blockKey}:${i}`] =
            item.progress?.checks?.selfExplanationAnswers[index++] ?? "";
        });
    return result;
  });
  return (
    <>
      {(item.blocks ?? []).map((block) => (
        <LessonBlockRenderer
          key={block.blockKey}
          block={block}
          answers={answers}
          setAnswer={(key, value) =>
            setAnswers((old) => ({ ...old, [key]: value }))
          }
        />
      ))}
      {Boolean(item.resources?.length) && (
        <section className="lesson-block">
          <h3>연결 자료</h3>
          {item.resources?.map((r) => (
            <a
              className="block-link"
              style={{ marginTop: 10 }}
              href={
                r.kind === "paper"
                  ? `/papers/${r.paperId}`
                  : r.kind === "wiki"
                    ? `/wiki?selected=${r.wikiId}`
                    : r.sourceUrl
              }
              target={r.kind === "external" ? "_blank" : undefined}
              rel="noopener noreferrer"
              key={r.id}
            >
              {r.title}
              {r.kind === "external" ? " ↗ 외부 자료" : ""}
              <small>{r.role}</small>
            </a>
          ))}
        </section>
      )}
      <LearningRecords item={item} answers={answers} onSaved={onSaved} />
    </>
  );
}
function CurriculumEditor({
  value,
  close,
  done,
}: {
  value: Curriculum | "new";
  close: () => void;
  done: (id: string) => void;
}) {
  const [title, setTitle] = useState(value === "new" ? "" : value.title);
  const [description, setDescription] = useState(
    value === "new" ? "" : value.description,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={value === "new" ? "새 커리큘럼" : "커리큘럼 수정"}
      close={close}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const result = await send<Curriculum>(
              value === "new" ? "/curricula" : `/curricula/${value.id}`,
              value === "new" ? "POST" : "PATCH",
              {
                title,
                description,
                ...(value === "new"
                  ? {}
                  : { expectedRevision: value.revision }),
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
          제목
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            placeholder="예: 나의 컴퓨터 시스템 기초"
          />
        </label>
        <label>
          학습 목표
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
        <button className="button primary" disabled={busy}>
          저장
        </button>
      </form>
    </Modal>
  );
}
function ItemEditor({
  value,
  curriculum,
  close,
  done,
}: {
  value: CurriculumItem | "new";
  curriculum: Curriculum;
  close: () => void;
  done: (id: string) => void;
}) {
  const [title, setTitle] = useState(value === "new" ? "" : value.title);
  const [kind, setKind] = useState(value === "new" ? "lesson" : value.kind);
  const [parentId, setParentId] = useState(
    value === "new" ? "" : (value.parentId ?? ""),
  );
  const [minutes, setMinutes] = useState(
    String(value === "new" ? 45 : (value.estimatedMinutes ?? 45)),
  );
  const [blocks, setBlocks] = useState<LessonBlock[]>(
    value === "new" ? [] : (value.blocks ?? []),
  );
  const [addKind, setAddKind] = useState<BlockKind>("markdown");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [links, setLinks] = useState<{ resourceId: string; role: string }[]>(
    value === "new"
      ? []
      : (value.resources ?? []).map((r) => ({
          resourceId: r.id,
          role: r.role ?? "required",
        })),
  );
  const resources = useResource<LearningResource[]>("/resources");
  const [resourceId, setResourceId] = useState("");
  const [resourceForm, setResourceForm] = useState(false);
  const unsupported = blocks.some((b) => !supportedBlock(b));
  return (
    <Modal
      title={value === "new" ? "학습 단원 추가" : "학습 내용 편집"}
      close={close}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const result = await send<CurriculumItem>(
              value === "new"
                ? `/curricula/${curriculum.id}/items`
                : `/curriculum-items/${value.id}`,
              value === "new" ? "POST" : "PATCH",
              {
                title,
                kind,
                parentId: parentId || null,
                estimatedMinutes: Number(minutes),
                blocks: blocks.map(
                  ({ blockKey, kind, schemaVersion, payload }) => ({
                    blockKey,
                    kind,
                    schemaVersion,
                    payload,
                  }),
                ),
                resources: links,
                expectedCurriculumRevision: curriculum.revision,
                ...(value === "new"
                  ? {}
                  : { expectedRevision: value.revision }),
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
          단원 제목
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </label>
        <div className="form-row">
          <label>
            종류
            <select
              value={kind}
              disabled={value !== "new"}
              onChange={(e) => {
                setKind(e.target.value as "lesson" | "section");
                if (e.target.value === "section") {
                  setBlocks([]);
                  setParentId("");
                }
              }}
            >
              <option value="lesson">학습 단원</option>
              <option value="section">섹션</option>
            </select>
          </label>
          <label>
            예상 시간 (분)
            <input
              type="number"
              min={1}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              required
            />
          </label>
        </div>
        {kind === "lesson" && (
          <>
            <label>
              상위 섹션
              <select
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
              >
                <option value="">없음</option>
                {curriculum.items
                  ?.filter((i) => i.kind === "section" && !i.archivedAt)
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.title}
                    </option>
                  ))}
              </select>
            </label>
            {blocks.map((block, index) => (
              <div
                className="lesson-block"
                key={block.blockKey}
                style={{ padding: 16, marginBottom: 0 }}
              >
                <div className="block-heading">
                  <span>
                    {blockDefinitions[block.kind as BlockKind]?.label ??
                      block.kind}
                  </span>
                  <div>
                    <button
                      className="icon-button"
                      type="button"
                      disabled={index === 0}
                      aria-label="블록 위로"
                      onClick={() =>
                        setBlocks(reorder(blocks, index, index - 1))
                      }
                    >
                      <ChevronUp size={13} />
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      disabled={index === blocks.length - 1}
                      aria-label="블록 아래로"
                      onClick={() =>
                        setBlocks(reorder(blocks, index, index + 1))
                      }
                    >
                      <ChevronDown size={13} />
                    </button>
                    <button
                      type="button"
                      className="button text small"
                      disabled={!supportedBlock(block)}
                      onClick={() =>
                        setBlocks(blocks.filter((_, i) => i !== index))
                      }
                    >
                      제거
                    </button>
                  </div>
                </div>
                <LessonBlockEditor
                  block={block}
                  change={(next) =>
                    setBlocks(blocks.map((b, i) => (i === index ? next : b)))
                  }
                />
              </div>
            ))}
            <div className="form-row">
              <select
                aria-label="추가할 블록 종류"
                value={addKind}
                onChange={(e) => setAddKind(e.target.value as BlockKind)}
              >
                {Object.entries(blockDefinitions).map(([key, def]) => (
                  <option key={key} value={key}>
                    {def.label}
                  </option>
                ))}
              </select>
              <button
                className="button"
                type="button"
                onClick={() =>
                  setBlocks([...blocks, newBlock(addKind, crypto.randomUUID())])
                }
              >
                <Plus size={13} />
                블록 추가
              </button>
            </div>
            <label>
              연결할 자료
              <select
                value={resourceId}
                onChange={(e) => setResourceId(e.target.value)}
              >
                <option value="">자료 선택</option>
                {listOf(resources.data).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </select>
            </label>
            <div className="heading-actions">
              <button
                type="button"
                className="button small"
                disabled={
                  !resourceId || links.some((l) => l.resourceId === resourceId)
                }
                onClick={() =>
                  setLinks([...links, { resourceId, role: "required" }])
                }
              >
                자료 연결
              </button>
              <button
                type="button"
                className="button small"
                onClick={() => setResourceForm(!resourceForm)}
              >
                새 자료 등록
              </button>
            </div>
            {resourceForm && (
              <ResourceForm
                done={(r) => {
                  resources.reload();
                  setLinks([...links, { resourceId: r.id, role: "required" }]);
                  setResourceForm(false);
                }}
              />
            )}
            {links.map((link) => (
              <div className="file-option" key={link.resourceId}>
                <span>
                  {listOf(resources.data).find((r) => r.id === link.resourceId)
                    ?.title ?? link.resourceId}
                </span>
                <select
                  aria-label="자료 역할"
                  value={link.role}
                  style={{ width: 90 }}
                  onChange={(e) =>
                    setLinks(
                      links.map((l) =>
                        l.resourceId === link.resourceId
                          ? { ...l, role: e.target.value }
                          : l,
                      ),
                    )
                  }
                >
                  <option value="required">필수</option>
                  <option value="optional">선택</option>
                  <option value="assignment">실습</option>
                </select>
                <button
                  className="button text small"
                  type="button"
                  onClick={() =>
                    setLinks(
                      links.filter((l) => l.resourceId !== link.resourceId),
                    )
                  }
                >
                  해제
                </button>
              </div>
            ))}
          </>
        )}
        {unsupported && (
          <Notice>
            알 수 없는 블록이 포함되어 안전하게 읽기 전용으로 표시합니다.
            지원되는 앱 버전에서 수정하세요.
          </Notice>
        )}
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
        <p className="form-hint">
          저장하면 새 학습 내용 버전을 만듭니다. 이전 제출과 완료 기록은 당시
          내용에 연결된 채 남습니다.
        </p>
        <button className="button primary" disabled={busy || unsupported}>
          학습 내용 저장
        </button>
      </form>
    </Modal>
  );
}
function ResourceForm({ done }: { done: (r: LearningResource) => void }) {
  const [kind, setKind] = useState("external");
  const choices = useResource<{ id: string; title: string }[]>(
    kind === "paper" ? "/papers" : kind === "wiki" ? "/wiki" : null,
  );
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState("");
  const [scope, setScope] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="provider-card">
      <label>
        자료 제목
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label>
        자료 종류
        <select
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setTarget("");
          }}
        >
          <option value="external">외부 링크</option>
          <option value="paper">로컬 논문</option>
          <option value="wiki">개념 위키</option>
        </select>
      </label>
      <label>
        {kind === "external" ? "https:// 자료 URL" : "자료 선택"}
        {kind === "external" ? (
          <input
            type="url"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
        ) : (
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">자료 선택</option>
            {listOf(choices.data).map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        )}
      </label>
      <label>
        읽기 범위
        <input value={scope} onChange={(e) => setScope(e.target.value)} />
      </label>
      {error && <p className="inline-error">{error}</p>}
      <button
        type="button"
        className="button"
        disabled={busy || !title || !target}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await send<LearningResource>("/resources", "POST", {
              kind,
              title,
              [kind === "external"
                ? "sourceUrl"
                : kind === "paper"
                  ? "paperId"
                  : "wikiId"]: target,
              readingScope: { description: scope },
            });
            done(r);
          } catch (e) {
            setError(errorText(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        자료 등록
      </button>
    </div>
  );
}
function DependencyEditor({
  curriculum,
  close,
  done,
}: {
  curriculum: Curriculum;
  close: () => void;
  done: () => void;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="선수 학습 관계" close={close}>
      <p className="form-hint">
        표시 순서와 별도로, 먼저 학습할 단원을 연결합니다. 순환 관계는 서버가
        거부합니다.
      </p>
      <div className="form-row" style={{ marginTop: 15 }}>
        {[
          [from, setFrom, "먼저 학습"],
          [to, setTo, "다음 학습"],
        ].map(([value, setter, label]) => (
          <label key={label as string}>
            {label as string}
            <select
              value={value as string}
              onChange={(e) => (setter as (v: string) => void)(e.target.value)}
            >
              <option value="">단원 선택</option>
              {curriculum.items
                ?.filter((i) => i.kind === "lesson" && !i.archivedAt)
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.title}
                  </option>
                ))}
            </select>
          </label>
        ))}
      </div>
      {error && <p className="inline-error">{error}</p>}
      <button
        className="button primary"
        style={{ marginTop: 15 }}
        disabled={busy || !from || !to || from === to}
        onClick={async () => {
          setBusy(true);
          try {
            await send(`/curricula/${curriculum.id}/dependencies`, "POST", {
              prerequisiteItemId: from,
              dependentItemId: to,
              expectedRevision: curriculum.revision,
            });
            done();
            close();
          } catch (e) {
            setError(errorText(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        관계 추가
      </button>
      <hr />
      {curriculum.dependencies?.map((edge) => (
        <div className="file-option" key={edge.id}>
          <span>
            {
              curriculum.items?.find((i) => i.id === edge.prerequisiteItemId)
                ?.title
            }{" "}
            →{" "}
            {
              curriculum.items?.find((i) => i.id === edge.dependentItemId)
                ?.title
            }
          </span>
          <button
            className="button small"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await send(
                  `/curricula/${curriculum.id}/dependencies/${edge.id}`,
                  "DELETE",
                  { expectedRevision: curriculum.revision },
                );
                done();
                close();
              } catch (e) {
                setError(errorText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            해제
          </button>
        </div>
      ))}
    </Modal>
  );
}
