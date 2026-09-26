export type PageSize = { width: number; height: number };
export type PageLayout = PageSize & { pageNumber: number; top: number };
export const pageLabelHeight = 24;
const gap = 24;

/** Sizes come from PDF.js viewports, including each page's rotation/user unit. */
export function pdfLayout(sizes: PageSize[], scale: number) {
  let top = 12;
  let width = 0;
  const pages = sizes.map((size, index): PageLayout => {
    const page = {
      pageNumber: index + 1,
      top,
      width: size.width * scale,
      height: size.height * scale,
    };
    top += pageLabelHeight + page.height + gap;
    width = Math.max(width, page.width);
    return page;
  });
  return { pages, height: top, width: width + 40 };
}

export function pageAtOffset(pages: PageLayout[], offset: number) {
  let low = 0;
  let high = pages.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (pages[middle].top <= offset) low = middle;
    else high = middle - 1;
  }
  return pages[low];
}

export function nearbyPages(
  pages: PageLayout[],
  scrollTop: number,
  viewportHeight: number,
) {
  // Reserve every page's space, but allocate canvases only around the viewport.
  const overscan = Math.max(400, viewportHeight);
  return pages.filter(
    (page) =>
      page.top + pageLabelHeight + page.height >= scrollTop - overscan &&
      page.top <= scrollTop + viewportHeight + overscan,
  );
}
