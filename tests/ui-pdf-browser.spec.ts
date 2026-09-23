import { test, expect, type Page } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";

const base = process.env.UI_TEST_URL ?? "http://127.0.0.1:3000";
const apiBase = process.env.UI_API_TEST_URL ?? base;
const fixtureTitle = "pdfjs-tracemonkey-validation";

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
  await expect(page.locator(".textLayer span").first()).toBeVisible();
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
    await expect(page.locator(".textLayer")).toContainText("Trace-based");
    const width = await page
      .locator(".pdf-stage")
      .evaluate((el) => el.getBoundingClientRect().width);
    await page.getByLabel("PDF 확대 비율").selectOption("1.5");
    await rendered(page, 1);
    await expect
      .poll(() =>
        page
          .locator(".pdf-stage")
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
    const pdfScroll = page.locator(".pdf-scroll");
    await pdfScroll.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await pdfScroll.dispatchEvent("wheel", { deltaY: 500 });
    await expect(page.getByLabel("페이지 번호", { exact: true })).toHaveValue(
      "2",
    );
    await rendered(page, 2);
    await pdfScroll.evaluate((element) => {
      element.scrollTop = 0;
    });
    await pdfScroll.dispatchEvent("wheel", { deltaY: -500 });
    await expect(page.getByLabel("페이지 번호", { exact: true })).toHaveValue(
      "1",
    );
    await rendered(page, 1);
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
    await page.locator(".textLayer").evaluate((layer) => {
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
    await page.locator(".pdf-stage").dispatchEvent("mouseup");
    await page.getByRole("button", { name: "메모", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "하이라이트 저장", exact: true }),
    ).toBeEnabled();
    await page.screenshot({
      path: `test-results/pdf-browser/${browserName}.png`,
    });
    await page.reload();
    await expect(page.locator(".pdf-stage")).toBeVisible();
    await expect(page.locator(".textLayer span").first()).toBeVisible();
    expect(unsafeCalls).toEqual([]);
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
    await expect(page.locator(".pdf-stage")).toBeVisible();
    await expect(page.locator(".textLayer span").first()).toBeVisible();
    await expect(page.locator(".pdf-scroll .state.error")).toHaveCount(0);
  });
});
