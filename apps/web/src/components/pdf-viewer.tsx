"use client";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { PointerEvent } from "react";
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
import { readPdfTextContent } from "../lib/pdf-text-content";
import {
  caretAtPoint,
  caretTextOffset,
  pdfWordRanges,
  pointInRects,
  rangeRectsInStage,
  textRange,
  verifiedHoverRange,
  wordRangesAtCaret,
} from "../lib/pdf-hover";
import type { PdfHoverTarget, PdfTextHover } from "../lib/pdf-hover";
export type { PdfHoverTarget, PdfTextHover } from "../lib/pdf-hover";

const noHoverTargets: PdfHoverTarget[] = [];
type RenderedTextLayer = {
  signature: string;
  layer: TextLayer;
  viewport: PageViewport;
};
type VerifiedTextItem = {
  segment: Segment;
  element: HTMLSpanElement;
  index: number;
  text: string;
  hash: string;
  words: { start: number; end: number }[];
};
type HoverRect = {
  target: PdfHoverTarget;
  rect: { left: number; top: number; width: number; height: number };
};
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
  onTextHover,
  hoverTargets = noHoverTargets,
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
  onTextHover?: (hit: PdfTextHover | null) => void;
  hoverTargets?: PdfHoverTarget[];
}) {
  const [loadAttempt, setLoadAttempt] = useState(0);
  const signature = `${paperId}:${revisionId}:${pageNumber}:${scale}:${loadAttempt}`;
  const liveSignature = useRef(signature);
  liveSignature.current = signature;
  const [verified, setVerified] = useState<{
    signature: string;
    ids: Set<string>;
    segments: Segment[] | null;
    rendered: RenderedTextLayer | null;
    textItems: Map<string, VerifiedTextItem>;
  }>({
    signature: "",
    ids: new Set(),
    segments: null,
    rendered: null,
    textItems: new Map(),
  });
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [rendered, setRendered] = useState<RenderedTextLayer | null>(null);
  const [selecting, setSelecting] = useState(false);
  const pointerSelecting = useRef(false);
  const lastHover = useRef<PdfTextHover | null>(null);
  const hoverCallback = useRef(onTextHover);
  hoverCallback.current = onTextHover;
  const emitHover = useCallback((hit: PdfTextHover | null) => {
    const previous = lastHover.current;
    if (
      previous?.segmentId === hit?.segmentId &&
      previous?.sourceRange.start === hit?.sourceRange.start &&
      previous?.sourceRange.end === hit?.sourceRange.end
    )
      return;
    lastHover.current = hit;
    hoverCallback.current?.(hit);
  }, []);
  const clearHover = useCallback(() => {
    lastHover.current = null;
    hoverCallback.current?.(null);
  }, []);
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
    clearHover();
    return clearHover;
  }, [signature, rendered, segments, clearHover]);
  useEffect(() => {
    const selectionChanged = () => {
      const selected = window.getSelection();
      const active =
        pointerSelecting.current || Boolean(selected && !selected.isCollapsed);
      setSelecting(active);
      if (active) clearHover();
    };
    const pointerEnded = () => {
      pointerSelecting.current = false;
      selectionChanged();
    };
    const blurred = () => {
      pointerEnded();
      clearHover();
    };
    document.addEventListener("selectionchange", selectionChanged);
    window.addEventListener("pointerup", pointerEnded);
    window.addEventListener("pointercancel", pointerEnded);
    window.addEventListener("blur", blurred);
    return () => {
      document.removeEventListener("selectionchange", selectionChanged);
      window.removeEventListener("pointerup", pointerEnded);
      window.removeEventListener("pointercancel", pointerEnded);
      window.removeEventListener("blur", blurred);
    };
  }, [clearHover]);
  useEffect(() => {
    let stopped = false;
    let task:
      ReturnType<(typeof import("pdfjs-dist"))["getDocument"]> | undefined;
    setLoading(true);
    setError(null);
    setPdf(null);
    (async () => {
      // The modern build assumes new JS built-ins absent in current Safari.
      // Use upstream's polyfilled build and its matching, versioned worker.
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = `/vendor/pdfjs/pdf.worker.legacy.min.mjs?v=${pdfjs.version}`;
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
  }, [paperId, revisionId, loadAttempt]);
  useEffect(() => {
    setRendered(null);
    clearHover();
    if (!pdf || !canvas.current || !layerElement.current) return;
    let stopped = false;
    const controller = new AbortController();
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
      const content = await readPdfTextContent(page, controller.signal);
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
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      if (stopped) return;
      textLayer = new pdfjs.TextLayer({
        textContentSource: content,
        container,
        viewport: current,
      });
      layer.current = textLayer;
      await textLayer.render();
      if (!stopped) {
        setRendered({ signature, layer: textLayer, viewport: current });
        setLoading(false);
      }
    })().catch((e) => {
      if (!stopped && e?.name !== "RenderingCancelledException") {
        setError(e as Error);
        setLoading(false);
      }
    });
    return () => {
      stopped = true;
      controller.abort();
      render?.cancel();
      textLayer?.cancel();
      layer.current = null;
      clearHover();
    };
  }, [pdf, pageNumber, scale, signature, clearHover]);
  useEffect(() => {
    let stopped = false;
    if (loading || error || !rendered || rendered.signature !== signature)
      return;
    const divs = rendered.layer.textDivs;
    (async () => {
      const hashes = await Promise.all(
        items.current.map((item) => sha256(item.str)),
      );
      if (stopped) return;
      const ids = new Set<string>();
      const textItems = new Map<string, VerifiedTextItem>();
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
          ) {
            ids.add(segment.id);
            const element = divs[i];
            const item = {
              segment,
              element,
              index: itemIndexes.current[i],
              text,
              hash: hashes[i],
              words: pdfWordRanges(text),
            };
            const target: PdfHoverTarget = {
              segmentId: segment.id,
              sourceRange: { start: 0, end: text.length },
              kind: "sentence",
              paperRevisionId: revisionId,
              extractionRunId: segment.extractionRunId,
              sourceTextHash: segment.textHash,
              pageNumber,
            };
            if (
              element?.isConnected &&
              element.textContent === text &&
              rendered.layer.textContentItemsStr[i] === text &&
              verifiedHoverRange(target, segment, item, {
                revisionId,
                pageNumber,
              })
            ) {
              textItems.set(segment.id, item);
              element.dataset.pdfVerified = "true";
              element.dataset.segmentId = segment.id;
              element.dataset.pdfItemIndex = String(item.index);
              element.dataset.sourceStart = "0";
              element.dataset.sourceEnd = String(text.length);
              element.dataset.paperRevisionId = revisionId;
              element.dataset.extractionRunId = segment.extractionRunId;
              element.dataset.sourceTextHash = segment.textHash;
              element.dataset.pageNumber = String(pageNumber);
            }
          }
        }
      }
      setVerified({ signature, ids, segments, rendered, textItems });
    })().catch(() => {
      if (!stopped)
        setVerified({
          signature,
          ids: new Set(),
          segments,
          rendered,
          textItems: new Map(),
        });
    });
    return () => {
      stopped = true;
      for (const div of divs) {
        for (const key of [
          "pdfVerified",
          "segmentId",
          "pdfItemIndex",
          "sourceStart",
          "sourceEnd",
          "paperRevisionId",
          "extractionRunId",
          "sourceTextHash",
          "pageNumber",
        ])
          delete div.dataset[key];
      }
    };
  }, [loading, error, rendered, segments, signature, revisionId, pageNumber]);
  const hoverReady =
    !loading &&
    !error &&
    rendered?.signature === signature &&
    verified.signature === signature &&
    verified.rendered === rendered &&
    verified.segments === segments;
  const [hoverGeometry, setHoverGeometry] = useState<{
    verified: typeof verified;
    targets: PdfHoverTarget[];
    rects: HoverRect[];
  } | null>(null);
  useLayoutEffect(() => {
    if (!hoverReady || selecting || !stage.current || !rendered) {
      setHoverGeometry(null);
      return;
    }
    const stageBounds = stage.current.getBoundingClientRect();
    const rects: HoverRect[] = [];
    for (const target of hoverTargets) {
      if (!target) continue;
      const item = verified.textItems.get(target.segmentId);
      if (!item || !item.element.isConnected) continue;
      const offsets = verifiedHoverRange(target, item.segment, item, {
        revisionId,
        pageNumber,
      });
      const range = offsets && textRange(item.element, item.text, offsets);
      if (!range) continue;
      for (const rect of rangeRectsInStage(
        range.getClientRects(),
        stageBounds,
        rendered.viewport,
      ))
        rects.push({ target, rect });
    }
    setHoverGeometry({ verified, targets: hoverTargets, rects });
  }, [
    hoverReady,
    selecting,
    rendered,
    verified,
    hoverTargets,
    revisionId,
    pageNumber,
  ]);
  function textPointerMoved(event: PointerEvent<HTMLDivElement>) {
    const selected = window.getSelection();
    if (
      !hoverReady ||
      event.buttons !== 0 ||
      pointerSelecting.current ||
      (selected && !selected.isCollapsed) ||
      event.pointerType === "touch"
    ) {
      emitHover(null);
      return;
    }
    const caret = caretAtPoint(
      event.currentTarget.ownerDocument,
      event.clientX,
      event.clientY,
    );
    if (!caret || !event.currentTarget.contains(caret.node)) {
      emitHover(null);
      return;
    }
    const element = (
      caret.node.nodeType === 1
        ? (caret.node as Element)
        : caret.node.parentElement
    )?.closest<HTMLElement>('[data-pdf-verified="true"]');
    const item = element?.dataset.segmentId
      ? verified.textItems.get(element.dataset.segmentId)
      : undefined;
    if (item && item.element === element && item.element.contains(caret.node)) {
      const offset = caretTextOffset(item.element, item.text, caret);
      if (offset === null) {
        emitHover(null);
        return;
      }
      for (const sourceRange of wordRangesAtCaret(
        item.text,
        offset,
        item.words,
      )) {
        const target: PdfHoverTarget = {
          segmentId: item.segment.id,
          sourceRange,
          kind: "word",
          paperRevisionId: revisionId,
          extractionRunId: item.segment.extractionRunId,
          sourceTextHash: item.segment.textHash,
          pageNumber,
        };
        const offsets = verifiedHoverRange(target, item.segment, item, {
          revisionId,
          pageNumber,
        });
        const range = offsets && textRange(item.element, item.text, offsets);
        if (
          range &&
          pointInRects(range.getClientRects(), event.clientX, event.clientY)
        ) {
          emitHover({ segmentId: item.segment.id, sourceRange: offsets! });
          return;
        }
      }
    }
    emitHover(null);
  }
  async function selectionChanged() {
    if (loading) return;
    clearHover();
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
      !error &&
      verified.signature === signature &&
      verified.segments === segments &&
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
    <div className="pdf-scroll" onPointerLeave={clearHover}>
      {loading && <Loading label="PDF 페이지를 불러오는 중" />}
      {error && (
        <ErrorState error={error} retry={() => setLoadAttempt((n) => n + 1)} />
      )}{" "}
      {ocr && !loading && (
        <div className="notice">
          텍스트를 찾을 수 없습니다. 스캔 문서라면 OCR이 필요합니다.
        </div>
      )}
      <div
        ref={stage}
        className="pdf-stage"
        data-page-number={pageNumber}
        data-paper-revision-id={revisionId}
        data-pdf-scale={scale}
        data-pdf-rotation={rendered?.viewport.rotation}
        data-pdf-hover-ready={Boolean(hoverReady)}
        data-pdf-selecting={selecting}
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
        <div
          className="textLayer"
          ref={layerElement}
          data-pdf-text-layer="true"
          onPointerMove={textPointerMoved}
          onPointerLeave={clearHover}
          onPointerDown={() => {
            pointerSelecting.current = true;
            setSelecting(true);
            clearHover();
          }}
          onPointerCancel={clearHover}
        />
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
        <div
          className="pdf-highlights pdf-hover-overlays"
          aria-hidden="true"
          style={{ pointerEvents: "none" }}
          data-pdf-hover-overlay="true"
        >
          {hoverReady &&
            !selecting &&
            hoverGeometry?.verified === verified &&
            hoverGeometry.targets === hoverTargets &&
            [...hoverGeometry.rects]
              .sort(
                (a, b) =>
                  Number(a.target.kind === "word") -
                  Number(b.target.kind === "word"),
              )
              .map(({ target, rect }, index) => (
                <div
                  key={`${target.segmentId}-${target.kind}-${target.sourceRange.start}-${target.sourceRange.end}-${index}`}
                  className={`pdf-hover-${target.kind}`}
                  style={{
                    ...rect,
                    position: "absolute",
                    pointerEvents: "none",
                  }}
                  data-hover-kind={target.kind}
                  data-segment-id={target.segmentId}
                  data-source-start={target.sourceRange.start}
                  data-source-end={target.sourceRange.end}
                  data-paper-revision-id={target.paperRevisionId}
                  data-extraction-run-id={target.extractionRunId}
                  data-source-text-hash={target.sourceTextHash}
                  data-page-number={target.pageNumber}
                  data-pdf-scale={scale}
                  data-pdf-rotation={rendered?.viewport.rotation}
                />
              ))}
        </div>
      </div>
    </div>
  );
}
