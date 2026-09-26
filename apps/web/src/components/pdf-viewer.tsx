"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Annotation, SourceAnchor } from "../lib/types";
import type { PdfHoverTarget, PdfTextHover } from "../lib/pdf-hover";
import {
  nearbyPages,
  pageAtOffset,
  pageLabelHeight,
  pdfLayout,
  type PageSize,
} from "../lib/pdf-layout";
import { PdfPage, type PdfSelection } from "./pdf-page";
import { ErrorState, Loading } from "./ui";

export type { PdfSelection } from "./pdf-page";
export type { PdfHoverTarget, PdfTextHover } from "../lib/pdf-hover";
const noHoverTargets: PdfHoverTarget[] = [];

export function PdfViewer({
  paperId,
  revisionId,
  pageNumber,
  pageRequest,
  scale,
  annotations,
  onPages,
  onPageChange,
  onSelection,
  activeAnchor,
  onTextHover,
  hoverTargets = noHoverTargets,
}: {
  paperId: string;
  revisionId: string;
  pageNumber: number;
  pageRequest: { pageNumber: number; serial: number };
  scale: number;
  annotations: Annotation[];
  onPages: (count: number) => void;
  onPageChange: (page: number) => void;
  onSelection: (selection: PdfSelection | null) => void;
  activeAnchor?: SourceAnchor | null;
  onTextHover?: (hit: PdfTextHover | null) => void;
  hoverTargets?: PdfHoverTarget[];
}) {
  const [attempt, setAttempt] = useState(0);
  const [document, setDocument] = useState<{
    pdf: PDFDocumentProxy;
    sizes: PageSize[];
  } | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const topScroll = useRef<HTMLDivElement>(null);
  const scrollFrame = useRef<number | null>(null);
  const lastViewport = useRef({ top: 0, height: 0 });
  const callbacks = useRef({
    onPages,
    onPageChange,
    onSelection,
    onTextHover,
    pageNumber,
  });
  callbacks.current = {
    onPages,
    onPageChange,
    onSelection,
    onTextHover,
    pageNumber,
  };
  const [view, setView] = useState({
    top: 0,
    left: 0,
    height: 800,
    width: 0,
    scrollWidth: 0,
  });
  const layout = useMemo(
    () => pdfLayout(document?.sizes ?? [], scale),
    [document, scale],
  );
  const previous = useRef<{
    layout: typeof layout;
    request: typeof pageRequest;
    pdf: PDFDocumentProxy;
  } | null>(null);

  useEffect(() => {
    let stopped = false;
    let task:
      ReturnType<(typeof import("pdfjs-dist"))["getDocument"]> | undefined;
    setDocument(null);
    setError(null);
    callbacks.current.onPages(0);
    previous.current = null;
    (async () => {
      // Keep the polyfilled build and matching worker for Safari compatibility.
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      if (stopped) return;
      pdfjs.GlobalWorkerOptions.workerSrc = `/vendor/pdfjs/pdf.worker.legacy.min.mjs?v=${pdfjs.version}`;
      task = pdfjs.getDocument({
        url: `/api/v1/papers/${paperId}/file?revision=${encodeURIComponent(revisionId)}`,
        withCredentials: true,
        cMapUrl: "/vendor/pdfjs/cmaps/",
        cMapPacked: true,
        standardFontDataUrl: "/vendor/pdfjs/standard_fonts/",
        wasmUrl: "/vendor/pdfjs/wasm/",
      });
      const pdf = await task.promise;
      if (stopped) return;
      // Inspect dimensions without rendering. Reserve stable full-document space,
      // so dragging the native thumb works even before distant pages paint.
      const sizes: PageSize[] = [];
      for (let number = 1; number <= pdf.numPages; number++) {
        const page = await pdf.getPage(number);
        if (stopped) return;
        const { width, height } = page.getViewport({ scale: 1 });
        sizes.push({ width, height });
      }
      if (!stopped) {
        setDocument({ pdf, sizes });
        callbacks.current.onPages(pdf.numPages);
      }
    })().catch((cause) => {
      if (!stopped)
        setError(
          new Error(
            `PDF를 열 수 없습니다. 원본 파일과 현재 버전을 확인해 주세요. ${cause instanceof Error ? cause.message : ""}`,
          ),
        );
    });
    return () => {
      stopped = true;
      void task?.destroy();
    };
  }, [paperId, revisionId, attempt]);

  const measure = useCallback(() => {
    const element = scroll.current;
    if (!element) return;
    lastViewport.current = {
      top: element.scrollTop,
      height: element.clientHeight,
    };
    setView((old) => {
      const next = {
        top: element.scrollTop,
        left: element.scrollLeft,
        height: element.clientHeight,
        width: element.clientWidth,
        scrollWidth: element.scrollWidth,
      };
      return Object.keys(next).every(
        (key) =>
          old[key as keyof typeof old] === next[key as keyof typeof next],
      )
        ? old
        : next;
    });
  }, []);

  useLayoutEffect(() => {
    const element = scroll.current;
    if (!element || !document || !layout.pages.length) return;
    const old = previous.current;
    if (!old || old.pdf !== document.pdf || old.request !== pageRequest) {
      const requested = Math.max(
        1,
        Math.min(layout.pages.length, pageRequest.pageNumber),
      );
      element.scrollTop = layout.pages[requested - 1].top;
      callbacks.current.onPageChange(requested);
      callbacks.current.onSelection(null);
    } else if (old.layout !== layout) {
      const saved = lastViewport.current;
      const oldPage = pageAtOffset(old.layout.pages, saved.top);
      if (saved.top + saved.height >= old.layout.height - 1) {
        element.scrollTop = element.scrollHeight;
      } else if (oldPage) {
        const fraction =
          (saved.top - oldPage.top) / (oldPage.height + pageLabelHeight);
        const next = layout.pages[oldPage.pageNumber - 1];
        element.scrollTop =
          next.top + fraction * (next.height + pageLabelHeight);
      }
      callbacks.current.onSelection(null);
    }
    previous.current = { layout, request: pageRequest, pdf: document.pdf };
    measure();
  }, [document, layout, pageRequest, measure]);

  useEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [measure]);
  useEffect(
    () => () => {
      if (scrollFrame.current !== null)
        cancelAnimationFrame(scrollFrame.current);
    },
    [],
  );

  function scrolled() {
    const element = scroll.current;
    if (!element) return;
    if (
      topScroll.current &&
      Math.abs(topScroll.current.scrollLeft - element.scrollLeft) > 0.5
    )
      topScroll.current.scrollLeft = element.scrollLeft;
    callbacks.current.onTextHover?.(null);
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = null;
      measure();
      // Track the page at the reading line without issuing another scroll.
      const current =
        element.scrollTop + element.clientHeight >= element.scrollHeight - 1
          ? layout.pages.at(-1)
          : pageAtOffset(
              layout.pages,
              element.scrollTop + Math.min(100, element.clientHeight / 4),
            );
      if (current && current.pageNumber !== callbacks.current.pageNumber)
        callbacks.current.onPageChange(current.pageNumber);
    });
  }
  const mounted = new Set(
    nearbyPages(layout.pages, view.top, view.height).map(
      (page) => page.pageNumber,
    ),
  );
  return (
    <div className="pdf-viewer-shell">
      <div
        className="pdf-top-scroll"
        ref={topScroll}
        aria-label="PDF 가로 스크롤"
        role="region"
        style={{ width: view.width || undefined }}
        onScroll={(event) => {
          if (
            scroll.current &&
            Math.abs(
              scroll.current.scrollLeft - event.currentTarget.scrollLeft,
            ) > 0.5
          )
            scroll.current.scrollLeft = event.currentTarget.scrollLeft;
        }}
      >
        <div style={{ width: view.scrollWidth }} />
      </div>
      <div
        className="pdf-scroll"
        ref={scroll}
        role="region"
        aria-label="PDF 연속 스크롤"
        tabIndex={0}
        onScroll={scrolled}
        onPointerLeave={() => onTextHover?.(null)}
      >
        {!document && !error && (
          <Loading label="PDF 문서와 페이지 크기를 불러오는 중" />
        )}
        {error && (
          <ErrorState error={error} retry={() => setAttempt((n) => n + 1)} />
        )}
        {document && (
          <div
            className="pdf-document"
            style={{ width: layout.width, height: layout.height }}
          >
            {layout.pages.map((page) => (
              <section
                className="pdf-page-slot"
                key={page.pageNumber}
                aria-label={`원문 ${page.pageNumber}페이지`}
                data-page-number={page.pageNumber}
                style={{
                  top: page.top,
                  width: page.width,
                  height: page.height + pageLabelHeight,
                }}
              >
                <div className="pdf-page-label">
                  {page.pageNumber} / {layout.pages.length}
                </div>
                <div className="pdf-page-paper" style={{ height: page.height }}>
                  {mounted.has(page.pageNumber) && (
                    <PdfPage
                      pdf={document.pdf}
                      paperId={paperId}
                      revisionId={revisionId}
                      pageNumber={page.pageNumber}
                      scale={scale}
                      scrollPosition={`${view.top}:${view.left}`}
                      annotations={annotations}
                      activeAnchor={activeAnchor}
                      hoverTargets={
                        page.pageNumber === pageNumber
                          ? hoverTargets
                          : noHoverTargets
                      }
                      onSelection={(selection) => {
                        if (selection) onPageChange(page.pageNumber);
                        onSelection(selection);
                      }}
                      onTextHover={(hit) => {
                        if (page.pageNumber === callbacks.current.pageNumber)
                          onTextHover?.(hit);
                      }}
                    />
                  )}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
