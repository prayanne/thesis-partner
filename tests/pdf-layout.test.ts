import { describe, expect, it } from "vitest";
import {
  nearbyPages,
  pageAtOffset,
  pdfLayout,
} from "../apps/web/src/lib/pdf-layout";

describe("continuous PDF geometry", () => {
  it("reserves all mixed-size and rotated viewports before canvases render", () => {
    const layout = pdfLayout(
      [
        { width: 600, height: 800 },
        { width: 1000, height: 500 },
      ],
      1.5,
    );
    expect(layout.pages).toEqual([
      { pageNumber: 1, top: 12, width: 900, height: 1200 },
      { pageNumber: 2, top: 1260, width: 1500, height: 750 },
    ]);
    expect(layout.width).toBe(1540);
    expect(layout.height).toBe(2058);
  });
  it("finds the reading page across boundaries and clamps offsets", () => {
    const { pages } = pdfLayout(
      Array.from({ length: 20 }, () => ({ width: 600, height: 800 })),
      1,
    );
    expect(pageAtOffset(pages, -10)?.pageNumber).toBe(1);
    expect(pageAtOffset(pages, pages[8].top - 1)?.pageNumber).toBe(8);
    expect(pageAtOffset(pages, pages[8].top)?.pageNumber).toBe(9);
    expect(pageAtOffset(pages, 1e9)?.pageNumber).toBe(20);
    expect(pageAtOffset([], 0)).toBeUndefined();
  });
  it("bounds canvases near the viewport without changing document extent", () => {
    const layout = pdfLayout(
      Array.from({ length: 1000 }, () => ({ width: 600, height: 800 })),
      1,
    );
    const visible = nearbyPages(layout.pages, layout.pages[499].top, 900);
    expect(visible.map((page) => page.pageNumber)).toEqual([
      498, 499, 500, 501, 502,
    ]);
    expect(layout.pages).toHaveLength(1000);
    expect(layout.height).toBe(848012);
  });
});
