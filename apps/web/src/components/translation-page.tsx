"use client";
import { useEffect, useMemo, useState } from "react";
import type { Artifact, Segment } from "../lib/types";
import {
  focusedWord,
  sentenceRows,
  translationParagraphs,
  translationRows,
  type ReadingFocus,
  type TranslationRow,
} from "../lib/translation-page";
import type { PdfHoverTarget } from "./pdf-viewer";
import { Loading } from "./ui";

export function TranslationPage({
  artifact,
  segments,
  revisionId,
  pageNumber,
  focus,
  onFocus,
  onTargets,
}: {
  artifact: Artifact;
  segments: Segment[];
  revisionId: string;
  pageNumber: number;
  focus: ReadingFocus;
  onFocus: (focus: ReadingFocus) => void;
  onTargets: (targets: PdfHoverTarget[]) => void;
}) {
  const [state, setState] = useState<{
    artifact: Artifact;
    segments: Segment[];
    rows: TranslationRow[];
  } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    translationRows(artifact, segments)
      .then((rows) => {
        if (!cancelled) setState({ artifact, segments, rows });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [artifact, segments]);
  const rows = useMemo(
    () =>
      state?.artifact === artifact && state.segments === segments
        ? state.rows
        : [],
    [state, artifact, segments],
  );
  const paragraphs = useMemo(() => translationParagraphs(rows), [rows]);
  const abstractIndex = paragraphs.findIndex((p) =>
    p.rows.some((r) => /^abstract$/i.test(r.segment.sourceText.trim())),
  );
  const active = rows.find(
    (r) => r.segment.id === focus?.segmentId && r.linked,
  );
  const sentence = useMemo(
    () => (active ? sentenceRows(paragraphs, active.segment.id) : []),
    [paragraphs, active],
  );
  const word = active ? focusedWord(active, focus) : undefined;
  const activeIds = new Set(sentence.map((r) => r.segment.id));
  useEffect(() => {
    const target = (
      row: TranslationRow,
      kind: "word" | "sentence",
      sourceRange = { start: 0, end: row.segment.sourceText.length },
    ): PdfHoverTarget => ({
      segmentId: row.segment.id,
      sourceRange,
      kind,
      paperRevisionId: revisionId,
      extractionRunId: row.segment.extractionRunId,
      sourceTextHash: row.segment.textHash,
      pageNumber,
    });
    onTargets([
      ...sentence.map((r) => target(r, "sentence")),
      ...(word && active ? [target(active, "word", word.sourceRange)] : []),
    ]);
    return () => onTargets([]);
  }, [sentence, word, active, revisionId, pageNumber, onTargets]);
  const translated = rows.filter((r) => r.targetText !== null).length;
  const linkedWords = rows.reduce((sum, r) => sum + r.links.length, 0);
  if (failed)
    return (
      <p role="alert" className="inline-error">
        번역 위치 정보를 읽지 못했습니다. 저장된 결과를 다시 불러와 주세요.
      </p>
    );
  if (!state || state.artifact !== artifact || state.segments !== segments)
    return <Loading label="페이지 번역 구성 중" />;
  const renderRow = (row: TranslationRow) => {
    if (row.targetText === null)
      return (
        <span
          key={row.segment.id}
          className="translation-missing"
          data-segment-id={row.segment.id}
          title={row.segment.sourceText}
        >
          아직 번역되지 않은 구절
        </span>
      );
    const pieces = [];
    let cursor = 0;
    row.links.forEach((link, i) => {
      if (link.targetRange.start > cursor)
        pieces.push(row.targetText!.slice(cursor, link.targetRange.start));
      const selected = active?.segment.id === row.segment.id && word === link;
      pieces.push(
        <span
          key={`word-${i}`}
          data-word-index={i}
          data-target-start={link.targetRange.start}
          data-target-end={link.targetRange.end}
          className={`translation-word${selected ? " is-word-active" : ""}`}
          title="원문 단어·구절 연결 · 기계 번역 표식 기반"
        >
          {row.targetText!.slice(link.targetRange.start, link.targetRange.end)}
        </span>,
      );
      cursor = link.targetRange.end;
    });
    pieces.push(row.targetText.slice(cursor));
    return (
      <span
        key={row.segment.id}
        className={`translation-phrase${activeIds.has(row.segment.id) ? " is-sentence-active" : ""}${row.linked ? " is-linked" : ""}`}
        data-segment-id={row.segment.id}
        data-linked={row.linked}
        tabIndex={row.linked ? 0 : undefined}
        title={
          row.linked
            ? "원문 문장·구절 확인 · 방향키로 연결 단어 이동"
            : "현재 원문과의 대응을 확인할 수 없습니다"
        }
        onFocus={() => {
          if (row.linked)
            onFocus({ origin: "translation", segmentId: row.segment.id });
        }}
        onBlur={() => onFocus(null)}
        onPointerMove={(e) => {
          if (!row.linked || e.buttons || window.getSelection()?.toString())
            return;
          const element =
            e.target instanceof Element
              ? e.target.closest<HTMLElement>("[data-word-index]")
              : null;
          const link = element
            ? row.links[Number(element.dataset.wordIndex)]
            : undefined;
          onFocus({
            origin: "translation",
            segmentId: row.segment.id,
            ...(link ? { range: link.targetRange } : {}),
          });
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            onFocus(null);
            return;
          }
          if (!["ArrowLeft", "ArrowRight"].includes(e.key) || !row.links.length)
            return;
          e.preventDefault();
          const current = word ? row.links.indexOf(word) : -1;
          const next =
            (current + (e.key === "ArrowRight" ? 1 : -1) + row.links.length) %
            row.links.length;
          onFocus({
            origin: "translation",
            segmentId: row.segment.id,
            range: row.links[next].targetRange,
          });
        }}
      >
        {pieces}
      </span>
    );
  };
  return (
    <section
      className="translation-document"
      aria-label={`${pageNumber}페이지 번역`}
    >
      <div className="translation-document-meta">
        <span>PAGE {String(pageNumber).padStart(2, "0")}</span>
        <span>
          {translated} / {rows.length} 구절 번역
        </span>
      </div>
      <div className="translation-legend">
        <span>
          <i className="sentence-swatch" />
          문장·구절
        </span>
        <span>
          <i className="word-swatch" />
          연결 단어
        </span>
      </div>
      <p className="translation-link-hint">
        {linkedWords
          ? `단어 연결 ${linkedWords}개 · 원문이나 번역 위에 마우스를 올려 대응 위치를 확인하세요.`
          : "단어 연결 정보가 없는 결과는 문장·구절로 연결됩니다. 새로 생성하면 단어 연결을 시도합니다."}
      </p>
      <article
        className="translation-paper"
        lang="ko"
        onPointerLeave={() => onFocus(null)}
        onPointerDown={() => onFocus(null)}
      >
        {paragraphs.map((paragraph, index) => {
          const content = paragraph.rows.flatMap((row, i) => [
            i ? " " : "",
            renderRow(row),
          ]);
          return paragraph.heading ? (
            <h3 key={paragraph.id}>{content}</h3>
          ) : (
            <p
              key={paragraph.id}
              className={
                abstractIndex > index && index > 0
                  ? "translation-frontmatter"
                  : undefined
              }
            >
              {content}
            </p>
          );
        })}
      </article>
      <footer className="translation-attribution">
        <a href="https://translate.google.com" target="_blank" rel="noreferrer">
          Powered by Google Translate
        </a>
        <span>자동 번역 · 표식이 없는 단어는 구절 범위로 표시합니다.</span>
      </footer>
    </section>
  );
}
