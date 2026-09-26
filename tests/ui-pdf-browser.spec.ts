import { test, expect, type Page } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";

const base = process.env.UI_TEST_URL ?? "http://127.0.0.1:3000";
const apiBase = process.env.UI_API_TEST_URL ?? base;
const fixtureTitle = "pdfjs-tracemonkey-validation";

function textFreePdf() {
  // A visible drawing without a text layer exercises the scanned-page notice.
  const content = "q 0.2 0.4 0.6 rg 40 40 520 720 re f Q";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << >> /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = Buffer.byteLength(pdf);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 5\n0000000000 65535 f \n${offsets
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

async function openSession(page: Page) {
  const token = (
    await readFile(
      process.env.UI_BOOTSTRAP_FILE ?? "data/bootstrap-token",
      "utf8",
    )
  ).trim();
  expect(
    (
      await page.request.post(`${apiBase}/api/v1/session`, {
        headers: { Origin: apiBase },
        data: { token },
      })
    ).ok(),
  ).toBeTruthy();
  // Optional local dev frontend + existing local container backend.
  if (apiBase !== base)
    await page.route("**/api/v1/**", async (route) => {
      const response = await route.fetch({
        url: route.request().url().replace(base, apiBase),
        headers: { ...route.request().headers(), origin: apiBase },
      });
      await route.fulfill({ response });
    });
  // The reader regression does not complete or mutate the installation wizard.
  await page.route("**/api/v1/config", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route
      .fetch({ url: `${apiBase}/api/v1/config` })
      .catch(() => null);
    if (!response) return route.abort("failed");
    const body = await response.json();
    body.data.onboarding = { completedAt: "2026-09-09T00:00:00.000Z" };
    await route.fulfill({ response, json: body });
  });
  const papers = (
    await (await page.request.get(`${apiBase}/api/v1/papers`)).json()
  ).data;
  const paper = papers.find(
    (p: { title: string; currentRevisionId?: string }) =>
      p.title === fixtureTitle && p.currentRevisionId,
  );
  expect(
    paper,
    "Import the public PDF.js tracemonkey fixture before this live test",
  ).toBeTruthy();
  return paper as { id: string; currentRevisionId: string };
}

async function rendered(page: Page, pageNumber: number) {
  await expect(page.locator(".pdf-scroll .state.loading")).toHaveCount(0);
  await expect(page.locator(".pdf-scroll .state.error")).toHaveCount(0);
  const canvas = page.getByLabel(`PDF 원문 ${pageNumber}페이지`);
  await expect(canvas).toBeVisible();
  await expect(
    page
      .locator(`.pdf-stage[data-page-number="${pageNumber}"] .textLayer span`)
      .first(),
  ).toBeVisible();
  // A canvas node alone is not proof that the document actually painted.
  expect(
    await canvas.evaluate((element: HTMLCanvasElement) => {
      const pixels = element
        .getContext("2d")!
        .getImageData(0, 0, element.width, element.height).data;
      let ink = 0;
      for (let i = 0; i < pixels.length; i += 16) {
        if (
          pixels[i + 3] > 0 &&
          pixels[i] + pixels[i + 1] + pixels[i + 2] < 600
        )
          ink++;
      }
      return ink;
    }),
  ).toBeGreaterThan(100);
}

const browserName =
  process.env.UI_PDF_BROWSER === "webkit" ? "webkit" : "chromium";
test.use({
  baseURL: base,
  browserName,
  launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] },
  viewport: { width: 1440, height: 1050 },
});
test.describe(`PDF ${browserName}`, () => {
  test.afterEach(async ({ page }) => {
    await page.request.delete(`${apiBase}/api/v1/session`, {
      headers: { Origin: apiBase },
    });
  });

  test("polyfilled render, page, zoom, selection and reopen without AI calls", async ({
    page,
  }) => {
    test.setTimeout(60000);
    const paper = await openSession(page);
    // Reproduce a browser missing the new ES Map helpers used by PDF.js 6.
    await page.addInitScript(() => {
      Reflect.deleteProperty(Map.prototype, "getOrInsertComputed");
      Reflect.deleteProperty(WeakMap.prototype, "getOrInsertComputed");
      Reflect.deleteProperty(ReadableStream.prototype, Symbol.asyncIterator);
      Reflect.deleteProperty(ReadableStream.prototype, "values");
    });
    const unsafeCalls: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        /\/(translations|summaries|chat|validation|models)$/.test(request.url())
      )
        unsafeCalls.push(request.url());
    });
    await page.goto(`/papers/${paper.id}`);
    await expect(page.getByLabel("페이지 번호", { exact: true })).toBeEnabled({
      timeout: 20000,
    });
    await page.getByLabel("페이지 번호", { exact: true }).fill("1");
    await page.getByLabel("PDF 확대 비율").selectOption("1");
    await rendered(page, 1);
    await expect(
      page.locator('.pdf-stage[data-page-number="1"] .textLayer'),
    ).toContainText("Trace-based");
    const width = await page
      .locator('.pdf-stage[data-page-number="1"]')
      .evaluate((el) => el.getBoundingClientRect().width);
    await page.getByLabel("PDF 확대 비율").selectOption("1.5");
    await rendered(page, 1);
    await expect
      .poll(() =>
        page
          .locator('.pdf-stage[data-page-number="1"]')
          .evaluate((el) => el.getBoundingClientRect().width),
      )
      .toBeCloseTo(width * 1.5, 0);
    const topScroll = page.getByLabel("PDF 가로 스크롤");
    await expect(topScroll).toBeVisible();
    expect(
      await topScroll.evaluate(
        (element) => element.scrollWidth > element.clientWidth,
      ),
    ).toBe(true);
    const maxHorizontalScroll = await topScroll.evaluate(
      (element) => element.scrollWidth - element.clientWidth,
    );
    const middleHorizontalScroll = maxHorizontalScroll / 2;
    await topScroll.evaluate((element, position) => {
      element.scrollLeft = position;
      element.dispatchEvent(new Event("scroll"));
    }, middleHorizontalScroll);
    await expect
      .poll(() =>
        page
          .locator(".pdf-scroll")
          .evaluate((element) => element.scrollLeft)
          .then((position) => Math.abs(position - middleHorizontalScroll)),
      )
      .toBeLessThanOrEqual(1);
    await page.locator(".pdf-scroll").evaluate((element, position) => {
      element.scrollLeft = position;
      element.dispatchEvent(new Event("scroll"));
    }, maxHorizontalScroll);
    await expect
      .poll(() =>
        topScroll
          .evaluate((element) => element.scrollLeft)
          .then((position) => Math.abs(position - maxHorizontalScroll)),
      )
      .toBeLessThanOrEqual(1);
    const openViewerWidth = await page
      .locator(".pdf-column")
      .evaluate((element) => element.getBoundingClientRect().width);
    await page
      .getByRole("button", { name: "작업 패널 접기", exact: true })
      .click();
    await expect(page.locator(".reader-panel")).toBeHidden();
    await expect
      .poll(() =>
        page
          .locator(".pdf-column")
          .evaluate((element) => element.getBoundingClientRect().width),
      )
      .toBeGreaterThan(openViewerWidth * 1.25);
    await mkdir("test-results/pdf-browser", { recursive: true });
    await page.screenshot({
      path: `test-results/pdf-browser/${browserName}-wide.png`,
    });
    await page
      .getByRole("button", { name: "작업 패널 펼치기", exact: true })
      .click();
    await expect(page.locator(".reader-panel")).toBeVisible();
    await page
      .getByRole("button", { name: "다음 페이지", exact: true })
      .click();
    await rendered(page, 2);
    await page
      .getByRole("button", { name: "이전 페이지", exact: true })
      .click();
    await rendered(page, 1);
    await expect(
      page.locator('.textLayer [data-pdf-verified="true"]').first(),
    ).toBeVisible();
    await page
      .locator('.pdf-stage[data-page-number="1"] .textLayer')
      .evaluate((layer) => {
        const text = Array.from(layer.querySelectorAll("span")).find(
          (s) =>
            s.firstChild?.nodeType === Node.TEXT_NODE &&
            s.textContent?.startsWith("Trace-based"),
        )!.firstChild!;
        const range = document.createRange();
        range.setStart(text, 0);
        range.setEnd(text, 11);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
      });
    await page
      .locator('.pdf-stage[data-page-number="1"]')
      .dispatchEvent("mouseup");
    await page.getByRole("button", { name: "메모", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "하이라이트 저장", exact: true }),
    ).toBeEnabled();
    // A range spanning adjacent pages must not retain the previous valid anchor.
    await page.locator(".pdf-document").evaluate((document) => {
      const text = (number: number) =>
        Array.from(
          document.querySelectorAll(
            `.pdf-stage[data-page-number="${number}"] .textLayer span`,
          ),
        ).find((span) => span.firstChild?.nodeType === Node.TEXT_NODE)
          ?.firstChild;
      const first = text(1)!;
      const second = text(2)!;
      const range = window.document.createRange();
      range.setStart(first, 0);
      range.setEnd(second, 1);
      const selected = window.getSelection()!;
      selected.removeAllRanges();
      selected.addRange(range);
    });
    await page
      .locator('.pdf-stage[data-page-number="2"]')
      .dispatchEvent("mouseup");
    await expect(
      page.getByRole("button", { name: "하이라이트 저장", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText(
        "여러 페이지에 걸친 선택은 원문 연결이 지원되지 않습니다.",
        { exact: false },
      ),
    ).toBeVisible();
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await page.screenshot({
      path: `test-results/pdf-browser/${browserName}.png`,
    });
    await page.reload();
    await expect(page.locator(".pdf-stage").first()).toBeVisible();
    await expect(page.locator(".textLayer span").first()).toBeVisible();
    expect(unsafeCalls).toEqual([]);
  });

  test("continuous pages, wheel, scrollbar drag, jumps and zoom keep the document stable", async ({
    page,
  }) => {
    test.setTimeout(60000);
    const paper = await openSession(page);
    const writes: string[] = [];
    let fileRequests = 0;
    page.on("request", (request) => {
      if (request.method() !== "GET" && request.url().includes("/api/v1/"))
        writes.push(request.method() + " " + new URL(request.url()).pathname);
      // PDF.js may fetch byte ranges; only a new full request reopens the PDF.
      if (
        request.url().includes(`/papers/${paper.id}/file?`) &&
        !request.headers().range
      )
        fileRequests++;
    });
    await page.goto(`/papers/${paper.id}`);
    const input = page.getByLabel("페이지 번호", { exact: true });
    await expect(input).toBeEnabled();
    await input.fill("1");
    await page.getByLabel("PDF 확대 비율").selectOption("0.75");
    await rendered(page, 1);
    const scroll = page.getByRole("region", {
      name: "PDF 연속 스크롤",
      exact: true,
    });
    const slots = page.locator(".pdf-page-slot");
    await expect(slots).toHaveCount(14);
    const totalHeight = await scroll.evaluate((el) => el.scrollHeight);
    expect(totalHeight).toBeGreaterThan(8000);
    // Two actual canvases remain simultaneously in the viewport at the seam.
    const secondTop = await slots
      .nth(1)
      .evaluate((el) => (el as HTMLElement).offsetTop);
    await scroll.evaluate((el, top) => {
      el.scrollTop = top - 200;
    }, secondTop);
    await rendered(page, 2);
    await expect(page.getByLabel("PDF 원문 1페이지")).toBeInViewport();
    await expect(page.getByLabel("PDF 원문 2페이지")).toBeInViewport();
    const box = (await scroll.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 150);
    await page.mouse.wheel(0, 330);
    await expect(input).toHaveValue("2");
    await expect(page.getByLabel("PDF 원문 1페이지")).toBeAttached();

    // Drag the native vertical thumb, not a scripted page replacement.
    await input.fill("1");
    await expect
      .poll(() => scroll.evaluate((el) => el.scrollTop))
      .toBeLessThan(20);
    const metrics = await scroll.evaluate((el) => ({
      left: el.getBoundingClientRect().left,
      top: el.getBoundingClientRect().top,
      width: el.getBoundingClientRect().width,
      height: el.clientHeight,
      thumb: Math.max(
        28,
        (el.clientHeight * el.clientHeight) / el.scrollHeight,
      ),
    }));
    await page.mouse.move(
      metrics.left + metrics.width - 7,
      metrics.top + metrics.thumb / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      metrics.left + metrics.width - 7,
      metrics.top + metrics.height - 15,
      { steps: 18 },
    );
    await page.mouse.up();
    await expect(input).toHaveValue("14");
    await rendered(page, 14);
    expect(await scroll.evaluate((el) => el.scrollHeight)).toBe(totalHeight);
    expect(await page.locator(".pdf-stage canvas").count()).toBeLessThan(8);
    await page.getByLabel("PDF 확대 비율").selectOption("1.5");
    await rendered(page, 14);
    await expect(input).toHaveValue("14");
    await page.getByLabel("PDF 확대 비율").selectOption("0.75");
    await rendered(page, 14);
    await expect(input).toHaveValue("14");

    await input.fill("7");
    await rendered(page, 7);
    await expect(page.getByLabel("PDF 원문 7페이지")).toBeInViewport();
    await page.getByLabel("PDF 확대 비율").selectOption("1.5");
    await rendered(page, 7);
    await expect(input).toHaveValue("7");
    await expect(page.getByLabel("PDF 원문 7페이지")).toBeInViewport();
    await page
      .getByRole("button", { name: "이전 페이지", exact: true })
      .click();
    await rendered(page, 6);
    await expect(page.getByLabel("PDF 원문 6페이지")).toBeInViewport();
    expect(fileRequests).toBe(1);

    await input.fill("1");
    await page.getByLabel("PDF 확대 비율").selectOption("0.75");
    await rendered(page, 1);
    await mkdir("test-results/pdf-browser", { recursive: true });
    await page.screenshot({
      path: `test-results/pdf-browser/${browserName}-continuous.png`,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() => scroll.evaluate((el) => el.clientHeight))
      .toBeGreaterThan(250);
    await scroll.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(input).toHaveValue("14");
    await rendered(page, 14);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    expect(writes).toEqual([]);
  });

  test("text-free PDF keeps the original visible beneath a compact OCR notice", async ({
    page,
  }) => {
    const paper = await openSession(page);
    const writes: string[] = [];
    page.on("request", (request) => {
      if (request.method() !== "GET" && request.url().includes("/api/v1/"))
        writes.push(request.method() + " " + new URL(request.url()).pathname);
    });
    await page.route(`**/api/v1/papers/${paper.id}/file?*`, (route) =>
      route.fulfill({ contentType: "application/pdf", body: textFreePdf() }),
    );
    await page.goto(`/papers/${paper.id}`);
    await expect(page.getByLabel("페이지 번호", { exact: true })).toBeEnabled();
    await page.getByLabel("PDF 확대 비율").selectOption("0.75");
    const notice = page.locator(".pdf-page-content > .notice");
    await expect(notice).toContainText("OCR이 필요합니다");
    const canvas = page.getByLabel("PDF 원문 1페이지");
    await expect(canvas).toBeVisible();
    await expect(page.locator(".pdf-scroll .state.loading")).toHaveCount(0);
    const bounds = (await canvas.boundingBox())!;
    expect((await notice.boundingBox())!.height).toBeLessThan(100);
    expect(
      await canvas.evaluate((element: HTMLCanvasElement) => {
        const pixel = element
          .getContext("2d")!
          .getImageData(element.width / 2, element.height / 2, 1, 1).data;
        return pixel[3] === 255 && pixel[0] < 100 && pixel[2] > 100;
      }),
    ).toBe(true);
    expect(
      await page.evaluate(
        ({ x, y }) => {
          return Boolean(
            document.elementFromPoint(x, y)?.closest(".pdf-stage"),
          );
        },
        { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
      ),
    ).toBe(true);
    expect(writes).toEqual([]);
  });

  test("failed file request offers a working retry", async ({ page }) => {
    const paper = await openSession(page);
    let fail = true;
    await page.route(`**/api/v1/papers/${paper.id}/file?*`, (route) =>
      fail
        ? route.fulfill({ status: 503, body: "Temporary local test failure" })
        : route.fallback(),
    );
    await page.goto(`/papers/${paper.id}`);
    await expect(page.locator(".pdf-scroll .state.error")).toBeVisible();
    fail = false;
    await page
      .getByRole("button", { name: "다시 불러오기", exact: true })
      .click();
    await expect(page.locator(".pdf-stage").first()).toBeVisible();
    await expect(page.locator(".textLayer span").first()).toBeVisible();
    await expect(page.locator(".pdf-scroll .state.error")).toHaveCount(0);
  });
});
