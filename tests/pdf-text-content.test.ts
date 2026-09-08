import { describe, expect, it, vi } from "vitest";
import type { TextContent, TextItem } from "pdfjs-dist/types/src/display/api";
import { readPdfTextContent } from "../apps/web/src/lib/pdf-text-content";

const item = (str: string): TextItem => ({
  str,
  dir: "ltr",
  transform: [1, 0, 0, 1, 0, 0],
  width: 10,
  height: 10,
  fontName: "f1",
  hasEOL: false,
});
function pageFor(stream: ReadableStream<TextContent>) {
  return {
    isPureXfa: false,
    streamTextContent: vi.fn(() => stream),
    getTextContent: vi.fn(async () => {
      throw new Error("Native async iteration must not be required");
    }),
  };
}
describe("PDF text without ReadableStream async iteration", () => {
  it("preserves ordered items, font styles and first document language", async () => {
    const stream = new ReadableStream<TextContent>({
      start(controller) {
        controller.enqueue({
          items: [item("first")],
          styles: {
            f1: {
              fontFamily: "serif",
              ascent: 0.8,
              descent: -0.2,
              vertical: false,
            },
          },
          lang: "en",
        });
        controller.enqueue({
          items: [item("second")],
          styles: {
            f2: {
              fontFamily: "sans-serif",
              ascent: 0.9,
              descent: -0.1,
              vertical: false,
            },
          },
          lang: null,
        });
        controller.close();
      },
    });
    Object.defineProperty(stream, Symbol.asyncIterator, { value: undefined });
    const page = pageFor(stream);
    const content = await readPdfTextContent(
      page,
      new AbortController().signal,
    );
    expect(content.items.map((value) => (value as TextItem).str)).toEqual([
      "first",
      "second",
    ]);
    expect(Object.keys(content.styles)).toEqual(["f1", "f2"]);
    expect(content.lang).toBe("en");
    expect(stream.locked).toBe(false);
    expect(page.getTextContent).not.toHaveBeenCalled();
  });
  it("cancels a pending read and releases its lock when the view changes", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<TextContent>({ cancel });
    const controller = new AbortController();
    const reading = readPdfTextContent(pageFor(stream), controller.signal);
    controller.abort();
    await expect(reading).rejects.toMatchObject({ name: "AbortError" });
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
  });
  it("propagates worker failures and releases the stream lock", async () => {
    const stream = new ReadableStream<TextContent>({
      start(controller) {
        controller.error(new Error("PDF worker stopped"));
      },
    });
    await expect(
      readPdfTextContent(pageFor(stream), new AbortController().signal),
    ).rejects.toThrow("PDF worker stopped");
    expect(stream.locked).toBe(false);
  });
  it("does not start text extraction when already cancelled", async () => {
    const page = pageFor(new ReadableStream<TextContent>());
    const controller = new AbortController();
    controller.abort();
    await expect(
      readPdfTextContent(page, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(page.streamTextContent).not.toHaveBeenCalled();
  });
  it("preserves the PDF.js XFA-specific text extraction path", async () => {
    const text: TextContent = { items: [], styles: {}, lang: null };
    const page = {
      isPureXfa: true,
      streamTextContent: vi.fn(),
      getTextContent: vi.fn(async () => text),
    };
    expect(await readPdfTextContent(page, new AbortController().signal)).toBe(
      text,
    );
    expect(page.streamTextContent).not.toHaveBeenCalled();
  });
});
