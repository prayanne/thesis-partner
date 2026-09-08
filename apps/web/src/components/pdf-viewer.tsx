"use client";
import { useEffect, useRef, useState } from "react";
import type {
  PDFDocumentProxy,
  PageViewport,
  RenderTask,
  TextLayer,
} from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import type { Annotation, Segment, SourceAnchor } from "../lib/types";
import {
  exactItemSourceRange,
  sha256,
  toPdfRect,
  validRange,
  viewportRect,
} from "../lib/pdf-mapping";
import { ErrorState, Loading } from "./ui";
export interface PdfSelection {
  text: string;
  anchor: SourceAnchor | null;
  reason?: string;
}
export function PdfViewer({
  paperId,
  revisionId,
  pageNumber,
  scale,
  segments,
  annotations,
  onPages,
  onSelection,
  activeAnchor,
}: {
  paperId: string;
  revisionId: string;
  pageNumber: number;
  scale: number;
  segments: Segment[];
  annotations: Annotation[];
  onPages: (count: number) => void;
  onSelection: (selection: PdfSelection | null) => void;
  activeAnchor?: SourceAnchor | null;
}) {
  const signature = `${revisionId}:${pageNumber}:${scale}`;
  const liveSignature = useRef(signature);
  liveSignature.current = signature;
  const [verified, setVerified] = useState<{
    signature: string;
    ids: Set<string>;
  }>({ signature: "", ids: new Set() });
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [viewport, setViewport] = useState<PageViewport | null>(null);
  const [ocr, setOcr] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const layerElement = useRef<HTMLDivElement>(null);
  const layer = useRef<TextLayer | null>(null);
  const items = useRef<TextItem[]>([]);
  const itemIndexes = useRef<number[]>([]);
  const pdfViewport = useRef<PageViewport | null>(null);
  const sourceBox = useRef<number[]>([]);
  const callback = useRef(onPages);
  callback.current = onPages;
  useEffect(() => {
    let stopped = false;
    let task:
      ReturnType<(typeof import("pdfjs-dist"))["getDocument"]> | undefined;
    setLoading(true);
    setError(null);
    setPdf(null);
    (async () => {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.min.mjs";
      if (stopped) return;
      task = pdfjs.getDocument({
        url: `/api/v1/papers/${paperId}/file?revision=${encodeURIComponent(revisionId)}`,
        withCredentials: true,
        cMapUrl: "/vendor/pdfjs/cmaps/",
        cMapPacked: true,
        standardFontDataUrl: "/vendor/pdfjs/standard_fonts/",
        wasmUrl: "/vendor/pdfjs/wasm/",
      });
      const doc = await task.promise;
      if (stopped) return;
      setPdf(doc);
      callback.current(doc.numPages);
    })().catch((e) => {
      if (!stopped) {
        setError(
          new Error(
            `PDF를 열 수 없습니다. 원본 파일과 현재 버전을 확인해 주세요. ${e instanceof Error ? e.message : ""}`,
          ),
        );
        setLoading(false);
      }
    });
    return () => {
      stopped = true;
      void task?.destroy();
    };
  }, [paperId, revisionId]);
  useEffect(() => {
    if (!pdf || !canvas.current || !layerElement.current) return;
    let stopped = false;
    let render: RenderTask | undefined;
    let textLayer: TextLayer | undefined;
    setLoading(true);
    setError(null);
    onSelection(null);
    (async () => {
      const page = await pdf.getPage(pageNumber);
      if (stopped) return;
      const current = page.getViewport({ scale });
      const target = canvas.current!;
      const context = target.getContext("2d");
      if (!context) throw new Error("Canvas를 사용할 수 없습니다.");
      const ratio = window.devicePixelRatio || 1;
      target.width = Math.floor(current.width * ratio);
      target.height = Math.floor(current.height * ratio);
      target.style.width = `${current.width}px`;
      target.style.height = `${current.height}px`;
      setViewport(current);
      pdfViewport.current = current;
      sourceBox.current = page.view;
      render = page.render({
        canvas: target,
        canvasContext: context,
        viewport: current,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
      });
      await render.promise;
      if (stopped) return;
      const content = await page.getTextContent();
      if (stopped) return;
      itemIndexes.current = [];
      items.current = [];
      content.items.forEach((item, index) => {
        if ("str" in item) {
          items.current.push(item);
          itemIndexes.current.push(index);
        }
      });
      setOcr(!items.current.some((i) => i.str.trim()));
      const container = layerElement.current!;
      container.replaceChildren();
      container.style.setProperty("--scale-factor", String(scale));
      container.style.setProperty(
        "--total-scale-factor",
        String(scale * current.userUnit),
      );
      const pdfjs = await import("pdfjs-dist");
      if (stopped) return;
      textLayer = new pdfjs.TextLayer({
        textContentSource: content,
        container,
        viewport: current,
      });
      layer.current = textLayer;
      await textLayer.render();
      if (!stopped) setLoading(false);
    })().catch((e) => {
      if (!stopped && e?.name !== "RenderingCancelledException") {
        setError(e as Error);
        setLoading(false);
      }
    });
    return () => {
      stopped = true;
      render?.cancel();
      textLayer?.cancel();
      layer.current = null;
    };
  }, [pdf, pageNumber, scale]);
  useEffect(() => {
    let stopped = false;
    if (loading || !pdfViewport.current) return;
    (async () => {
      const hashes = await Promise.all(
        items.current.map((item) => sha256(item.str)),
      );
      if (stopped) return;
      const ids = new Set<string>();
      for (const segment of segments) {
        if (segment.paperRevisionId && segment.paperRevisionId !== revisionId)
          continue;
        for (let i = 0; i < items.current.length; i++) {
          const text = items.current[i].str;
          if (
            exactItemSourceRange(
              segment,
              itemIndexes.current[i],
              text,
              hashes[i],
              { start: 0, end: text.length },
              pageNumber,
              segment.extractionRunId,
            )
          )
            ids.add(segment.id);
        }
      }
      setVerified({ signature, ids });
    })().catch(() => {
      if (!stopped) setVerified({ signature, ids: new Set() });
    });
    return () => {
      stopped = true;
    };
  }, [loading, segments, signature, revisionId, pageNumber]);
  async function selectionChanged() {
    if (loading) return;
    const selected = window.getSelection();
    if (
      !selected ||
      selected.isCollapsed ||
      !layerElement.current ||
      !stage.current ||
      !pdfViewport.current
    ) {
      onSelection(null);
      return;
    }
    const range = selected.getRangeAt(0).cloneRange();
    if (
      !layerElement.current.contains(range.startContainer) ||
      !layerElement.current.contains(range.endContainer)
    )
      return;
    const text = selected.toString();
    const divs = layer.current?.textDivs ?? [];
    const index = divs.findIndex((div) => div.contains(range.startContainer));
    if (index < 0 || !divs[index].contains(range.endContainer)) {
      onSelection({
        text,
        anchor: null,
        reason:
          "여러 텍스트 항목에 걸친 선택은 정확한 원문 오프셋 연결이 아직 지원되지 않습니다. 한 항목 안에서 다시 선택하세요.",
      });
      return;
    }
    const div = divs[index];
    const prefix = document.createRange();
    prefix.selectNodeContents(div);
    prefix.setEnd(range.startContainer, range.startOffset);
    const start = prefix.toString().length;
    const item = items.current[index];
    if (!item) {
      onSelection({
        text,
        anchor: null,
        reason: "텍스트 레이어 연결을 확인할 수 없습니다.",
      });
      return;
    }
    const captureBox = stage.current.getBoundingClientRect();
    const captureViewport = pdfViewport.current;
    const capturedRects = Array.from(range.getClientRects())
      .filter((r) => r.width > 0 && r.height > 0)
      .map((rect) =>
        toPdfRect(rect, captureBox, (x, y) =>
          captureViewport.convertToPdfPoint(x, y),
        ),
      );
    const hash = await sha256(item.str);
    if (liveSignature.current !== signature) return;
    const offsets = { start, end: start + range.toString().length };
    for (const segment of segments) {
      const mapped = exactItemSourceRange(
        segment,
        itemIndexes.current[index],
        item.str,
        hash,
        offsets,
        pageNumber,
        segment.extractionRunId,
      );
      if (!mapped) continue;
      const rects = capturedRects;
      if (!rects.length) continue;
      onSelection({
        text,
        anchor: {
          paperId,
          paperRevisionId: revisionId,
          extractionRunId: segment.extractionRunId,
          pageNumber,
          segmentId: segment.id,
          sourceRange: mapped,
          sourceTextHash: segment.textHash,
          rects,
          coordinateSpace: "pdf-user-space-unrotated",
          pageBox: sourceBox.current,
        },
      });
      return;
    }
    onSelection({
      text,
      anchor: null,
      reason:
        "현재 추출 텍스트와 PDF 항목의 해시·범위가 일치하지 않습니다. 추출 완료 여부를 확인하세요.",
    });
  }
  const anchors = [
    ...annotations.map((a) => ({ id: a.id, anchor: a.anchor, active: false })),
    ...(activeAnchor
      ? [{ id: "active", anchor: activeAnchor, active: true }]
      : []),
  ].filter(
    ({ anchor }) =>
      anchor &&
      !loading &&
      verified.signature === signature &&
      verified.ids.has(anchor.segmentId) &&
      anchor.paperId === paperId &&
      anchor.paperRevisionId === revisionId &&
      anchor.pageNumber === pageNumber &&
      anchor.coordinateSpace === "pdf-user-space-unrotated" &&
      segments.some(
        (s) =>
          s.id === anchor.segmentId &&
          s.extractionRunId === anchor.extractionRunId &&
          anchor.sourceTextHash === s.textHash &&
          validRange(anchor.sourceRange, s.sourceText),
      ),
  );
  return (
    <div className="pdf-scroll">
      {loading && <Loading label="PDF 페이지를 불러오는 중" />}
      {error && <ErrorState error={error} />}{" "}
      {ocr && !loading && (
        <div className="notice">
          텍스트를 찾을 수 없습니다. 스캔 문서라면 OCR이 필요합니다.
        </div>
      )}
      <div
        ref={stage}
        className="pdf-stage"
        style={{
          width: viewport?.width,
          height: viewport?.height,
          display: error ? "none" : undefined,
          visibility: loading ? "hidden" : undefined,
        }}
        onMouseUp={() => void selectionChanged()}
        onKeyUp={() => void selectionChanged()}
      >
        <canvas ref={canvas} aria-label={`PDF 원문 ${pageNumber}페이지`} />
        <div className="textLayer" ref={layerElement} />
        <div className="pdf-highlights" aria-hidden="true">
          {viewport &&
            anchors.flatMap(({ id, anchor, active }) =>
              (anchor?.rects ?? [])
                .filter(
                  (rect) => rect.length === 4 && rect.every(Number.isFinite),
                )
                .map((rect, index) => (
                  <div
                    className={`pdf-highlight ${active ? "active" : ""}`}
                    key={`${id}-${index}`}
                    style={viewportRect(rect, (r) => [
                      ...viewport.convertToViewportPoint(r[0], r[1]),
                      ...viewport.convertToViewportPoint(r[2], r[3]),
                    ])}
                  />
                )),
            )}
        </div>
      </div>
    </div>
  );
}
