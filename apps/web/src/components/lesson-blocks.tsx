"use client";
import Link from "next/link";
import { BookOpen, FileText, ArrowUpRight } from "lucide-react";
import type { LessonBlock, BlockKind } from "../lib/types";
import { blockDefinitions, supportedBlock } from "../lib/lesson-blocks";
import { Markdown } from "./markdown";
import { useResource, listOf } from "../lib/api";
export function LessonBlockRenderer({
  block,
  answers,
  setAnswer,
}: {
  block: LessonBlock;
  answers: Record<string, string>;
  setAnswer: (key: string, value: string) => void;
}) {
  if (!supportedBlock(block))
    return (
      <div className="unsupported">
        지원하지 않는 학습 블록 ({block.kind} · schema {block.schemaVersion}
        )입니다. 원본 데이터는 보존됩니다.
      </div>
    );
  const p = block.payload;
  const fields = (p.questions ?? p.items ?? []) as string[];
  return (
    <section className="lesson-block">
      <div className="block-heading">
        <span>{blockDefinitions[block.kind].label.toUpperCase()}</span>
      </div>
      {block.kind === "markdown" ? (
        <Markdown>{p.markdown as string}</Markdown>
      ) : block.kind === "exercise" ? (
        <>
          <h3>{typeof p.title === "string" ? p.title : "직접 만들어 보기"}</h3>
          <Markdown>{p.instructions as string}</Markdown>
          <p className="form-hint">
            실습은 익숙한 에디터와 터미널에서 수행하고 아래 학습 기록에 결과를
            남기세요.
          </p>
        </>
      ) : block.kind === "self_explanation" ? (
        fields.map((q, i) => (
          <label className="question-field" key={i}>
            {i + 1}. {q}
            <textarea
              value={answers[`${block.blockKey}:${i}`] ?? ""}
              onChange={(e) =>
                setAnswer(`${block.blockKey}:${i}`, e.target.value)
              }
              placeholder="나의 말로 설명해 보세요."
            />
          </label>
        ))
      ) : block.kind === "checklist" ? (
        fields.map((q, i) => (
          <label className="check-item" key={i}>
            <input
              type="checkbox"
              checked={answers[`${block.blockKey}:${i}`] === "checked"}
              onChange={(e) =>
                setAnswer(
                  `${block.blockKey}:${i}`,
                  e.target.checked ? "checked" : "",
                )
              }
            />
            {q}
          </label>
        ))
      ) : (
        <>
          <ReadingBlock block={block} />
          {typeof p.readingScope === "string" && (
            <p className="form-hint" style={{ marginTop: 12 }}>
              읽기 범위 · {p.readingScope}
            </p>
          )}
        </>
      )}
    </section>
  );
}
function ReadingBlock({ block }: { block: LessonBlock }) {
  const p = block.payload;
  const paper = block.kind === "paper_reading";
  const id = p[paper ? "paperId" : "wikiId"];
  return typeof id === "string" && id ? (
    <Link
      className="block-link"
      href={
        paper
          ? `/papers/${encodeURIComponent(id)}`
          : `/wiki?selected=${encodeURIComponent(id)}`
      }
    >
      {paper ? <FileText size={22} /> : <BookOpen size={22} />}
      <div>
        {typeof p.title === "string"
          ? p.title
          : paper
            ? "연결한 논문 읽기"
            : "연결한 위키 읽기"}
        <small style={{ display: "block" }}>저장된 자료로 이동</small>
      </div>
      <ArrowUpRight size={16} />
    </Link>
  ) : (
    <div className="unsupported">
      읽기 자료가 연결되지 않았습니다. 단원 편집에서 논문 또는 위키 ID를
      연결하세요.
    </div>
  );
}
export function LessonBlockEditor({
  block,
  change,
}: {
  block: LessonBlock;
  change: (block: LessonBlock) => void;
}) {
  const options = useResource<{ id: string; title: string }[]>(
    block.kind === "paper_reading"
      ? "/papers"
      : block.kind === "wiki_reading"
        ? "/wiki"
        : null,
  );
  const def = blockDefinitions[block.kind as BlockKind];
  if (!def || block.schemaVersion !== 1)
    return (
      <div className="unsupported">
        이 블록은 읽기 전용입니다. 새 버전을 지원하는 앱에서 편집하세요.
      </div>
    );
  const value = block.payload[def.field];
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {["paper_reading", "wiki_reading", "exercise"].includes(block.kind) && (
        <label>
          표시 제목
          <input
            value={
              typeof block.payload.title === "string" ? block.payload.title : ""
            }
            onChange={(e) =>
              change({
                ...block,
                payload: { ...block.payload, title: e.target.value },
              })
            }
          />
        </label>
      )}
      <label>
        {block.kind === "paper_reading"
          ? "논문 읽기 자료"
          : block.kind === "wiki_reading"
            ? "위키 읽기 자료"
            : def.list
              ? "한 줄에 한 항목"
              : "Markdown 내용"}
        {["paper_reading", "wiki_reading"].includes(block.kind) ? (
          <select
            aria-label={
              block.kind === "paper_reading"
                ? "논문 읽기 자료"
                : "위키 읽기 자료"
            }
            value={typeof value === "string" ? value : ""}
            onChange={(e) =>
              change({
                ...block,
                payload: { ...block.payload, [def.field]: e.target.value },
              })
            }
          >
            <option value="">자료 연결 안 함</option>
            {listOf(options.data).map((option) => (
              <option key={option.id} value={option.id}>
                {option.title}
              </option>
            ))}
          </select>
        ) : (
          <textarea
            value={
              def.list && Array.isArray(value)
                ? value.join("\n")
                : typeof value === "string"
                  ? value
                  : ""
            }
            onChange={(e) =>
              change({
                ...block,
                payload: {
                  ...block.payload,
                  [def.field]: def.list
                    ? e.target.value.split("\n")
                    : e.target.value,
                },
              })
            }
          />
        )}
      </label>
      {["paper_reading", "wiki_reading"].includes(block.kind) && (
        <label>
          읽기 범위
          <input
            value={
              typeof block.payload.readingScope === "string"
                ? block.payload.readingScope
                : ""
            }
            onChange={(e) =>
              change({
                ...block,
                payload: { ...block.payload, readingScope: e.target.value },
              })
            }
            placeholder="예: 2~4페이지 · 방법과 한계"
          />
        </label>
      )}
    </div>
  );
}
