import type { PDFPageProxy } from "pdfjs-dist";
import type { TextContent } from "pdfjs-dist/types/src/display/api";

/** Safari before 26.4 lacks ReadableStream async iteration even with PDF.js legacy.
 * Read via the supported reader API, preserving PDF.js item order/styles/lang.
 * No global browser prototypes are modified. */
export async function readPdfTextContent(
  page: Pick<
    PDFPageProxy,
    "streamTextContent" | "getTextContent" | "isPureXfa"
  >,
  signal: AbortSignal,
): Promise<TextContent> {
  signal.throwIfAborted();
  if (page.isPureXfa) return page.getTextContent();
  const reader = page.streamTextContent().getReader();
  const content: TextContent = {
    items: [],
    styles: Object.create(null),
    lang: null,
  };
  const cancel = () => {
    void reader.cancel(signal.reason).catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) return content;
      content.lang ??= value.lang;
      Object.assign(content.styles, value.styles);
      content.items.push(...value.items);
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}
