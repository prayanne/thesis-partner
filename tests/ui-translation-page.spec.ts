import { test, expect, type Page } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { Artifact, Segment } from "../apps/web/src/lib/types";

const base = process.env.UI_TEST_URL ?? "http://127.0.0.1:3000";
const browserName =
  process.env.UI_PDF_BROWSER === "webkit" ? "webkit" : "chromium";
test.use({
  baseURL: base,
  browserName,
  viewport: { width: 1600, height: 1120 },
});
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
async function setup(page: Page, mode: "cached" | "words" | "stale" = "words") {
  const token = (await readFile("data/bootstrap-token", "utf8")).trim();
  expect(
    (
      await page.request.post(`${base}/api/v1/session`, {
        headers: { Origin: base },
        data: { token },
      })
    ).ok(),
  ).toBeTruthy();
  const papers = (
    await (await page.request.get(`${base}/api/v1/papers`)).json()
  ).data;
  const paper = papers.find(
    (p: { title: string }) => p.title === "pdfjs-tracemonkey-validation",
  );
  expect(
    paper,
    "The existing public PDF fixture is required; never upload a user's paper for this test",
  ).toBeTruthy();
  const segments: Segment[] = (
    await (
      await page.request.get(
        `${base}/api/v1/papers/${paper.id}/segments?pageNumber=1`,
      )
    ).json()
  ).data;
  const source = segments.find((s) => s.sourceText.startsWith("Trace-based"))!;
  expect(source).toBeTruthy();
  const firstPage: Artifact[] = (
    await (
      await page.request.get(
        `${base}/api/v1/papers/${paper.id}/artifacts?operation=translation&pageNumber=1`,
      )
    ).json()
  ).data;
  const targetText = "트레이스 기반 컴파일러 연구.";
  const payload = {
    segments: [
      {
        segmentId: source.id,
        sourceText: source.sourceText,
        targetText,
        sourceTextHash: source.textHash,
        targetTextHash: digest(targetText),
        wordAlignment: {
          method: "google-html-markers-v1",
          status: "partial",
          sourceText: source.sourceText,
          targetText,
          links: [
            {
              id: "w0-5",
              sourceRange: { start: 0, end: 5 },
              targetRange: { start: 0, end: 4 },
            },
            {
              id: "w6-11",
              sourceRange: { start: 6, end: 11 },
              targetRange: { start: 5, end: 7 },
            },
          ],
        },
      },
    ],
    attribution: {
      service: "Google Translate",
      displayText: "Powered by Google Translate",
    },
  };
  const synthetic: Artifact = {
    id: "synthetic-translation",
    payload,
    provenance: {
      paperRevisionId: paper.currentRevisionId,
      extractionRunId:
        mode === "stale" ? "wrong-extraction" : source.extractionRunId,
    },
  };
  const calls: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() !== "GET" &&
      request.method() !== "HEAD" &&
      request.url().includes("/api/v1/")
    )
      calls.push(new URL(request.url()).pathname);
  });
  await page.route("**/api/v1/config", async (route) => {
    const response = await route.fetch().catch(() => null);
    if (!response) return route.abort("failed");
    const body = await response.json();
    body.data.onboarding = {
      completedAt: "2026-09-10T00:00:00.000Z",
      deferredAt: null,
    };
    await route.fulfill({ response, json: body });
  });
  await page.route(`**/api/v1/papers/${paper.id}/reading-state`, (route) =>
    route.fulfill({
      json: {
        data: {
          pageNumber: 1,
          scale: 1,
          revision: 1,
          paperRevisionId: paper.currentRevisionId,
        },
      },
    }),
  );
  await page.route(
    `**/api/v1/papers/${paper.id}/artifacts?*`,
    async (route) => {
      const query = new URL(route.request().url()).searchParams;
      if (mode === "cached" || query.get("operation") !== "translation")
        return route.continue();
      return route.fulfill({
        json: { data: query.get("pageNumber") === "1" ? [synthetic] : [] },
      });
    },
  );
  await page.goto(`/papers/${paper.id}`);
  await expect(page.getByLabel("PDF 원문 1페이지")).toBeVisible({
    timeout: 20000,
  });
  await expect(page.locator(".pdf-scroll .state.loading")).toHaveCount(0);
  await expect(page.locator(".translation-paper")).toBeVisible();
  return { paper, source, segments, calls, firstPage };
}
test.afterEach(async ({ page }) => {
  await page.request.delete(`${base}/api/v1/session`, {
    headers: { Origin: base },
  });
});

test("existing cached Google page is continuous prose and phrase hover makes no generation request", async ({
  page,
}) => {
  const { source, segments, calls, firstPage } = await setup(page, "cached");
  expect(
    firstPage.length,
    "Translate the public fixture once before this cached-result acceptance",
  ).toBeGreaterThan(0);
  await expect(page.locator(".translation-paper .source-quote")).toHaveCount(0);
  await expect(
    page.locator(".translation-paper .translation-segment"),
  ).toHaveCount(0);
  expect(
    await page
      .locator(".translation-paper > p, .translation-paper > h3")
      .count(),
  ).toBeLessThan(segments.length);
  const phrase = page.locator(
    `.translation-phrase[data-segment-id="${source.id}"]`,
  );
  await expect(phrase).toHaveAttribute("data-linked", "true");
  await phrase.hover();
  await expect(page.locator(".pdf-hover-sentence").first()).toBeVisible();
  await expect(phrase).toHaveClass(/is-sentence-active/);
  await page.mouse.move(5, 5);
  await expect(page.locator(".pdf-hover-sentence")).toHaveCount(0);
  await mkdir("test-results/translation-page", { recursive: true });
  await page.screenshot({
    path: `test-results/translation-page/cached-${browserName}.png`,
  });
  expect(calls).toEqual([]);
});

test("synthetic word links highlight both directions with exact PDF geometry and clear on zoom/page/tab", async ({
  page,
}) => {
  const { source, calls } = await setup(page);
  const phrase = page.locator(
    `.translation-phrase[data-segment-id="${source.id}"]`,
  );
  const word = phrase.locator('[data-word-index="0"]');
  await word.hover();
  const overlay = page.locator(
    '.pdf-hover-word[data-source-start="0"][data-source-end="5"]',
  );
  await expect(overlay).toBeVisible();
  const width = (await overlay.boundingBox())!.width;
  await expect(word).toHaveClass(/is-word-active/);
  expect(
    (await page.locator(".pdf-hover-sentence").first().boundingBox())!.width,
  ).toBeGreaterThan(width * 2);
  await page.mouse.move(5, 5);
  await expect(overlay).toHaveCount(0);
  const sourceWord = page.locator(
    `.textLayer [data-pdf-verified="true"][data-segment-id="${source.id}"]`,
  );
  const sourceWordRect = () =>
    sourceWord.evaluate((element) => {
      const range = document.createRange();
      range.setStart(element.firstChild!, 0);
      range.setEnd(element.firstChild!, 5);
      const rect = range.getBoundingClientRect();
      return {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      };
    });
  await expect(sourceWord).toBeVisible();
  const point = await sourceWord.evaluate((element) => {
    const range = document.createRange();
    range.setStart(element.firstChild!, 0);
    range.setEnd(element.firstChild!, 5);
    const rect = range.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.mouse.move(point.x, point.y);
  await expect(word).toHaveClass(/is-word-active/);
  await expect(overlay).toBeVisible();
  const originalRect = await sourceWordRect();
  const originalOverlay = (await overlay.boundingBox())!;
  for (const key of ["x", "y", "width", "height"] as const)
    expect(originalOverlay[key]).toBeCloseTo(originalRect[key], 0);
  await page.getByLabel("PDF 확대 비율").selectOption("1.5");
  await expect(page.locator(".pdf-scroll .state.loading")).toHaveCount(0);
  await expect(overlay).toHaveCount(0);
  await word.hover();
  await expect(overlay).toBeVisible();
  // WebKit rounds partial-word glyph metrics differently after PDF.js scaling.
  // Compare against the actual UTF-16 DOM range at each scale, not an assumed
  // perfectly linear font width. Still reject a missing/wrong zoom transform.
  const zoomedOverlay = (await overlay.boundingBox())!;
  const zoomedRect = await sourceWordRect();
  for (const key of ["x", "y", "width", "height"] as const)
    expect(zoomedOverlay[key]).toBeCloseTo(zoomedRect[key], 0);
  expect(zoomedOverlay.width / width).toBeGreaterThan(1.45);
  expect(zoomedOverlay.width / width).toBeLessThan(1.55);
  await page.getByRole("button", { name: "메모", exact: true }).click();
  await expect(
    page.locator(".pdf-hover-word, .pdf-hover-sentence"),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "번역", exact: true }).click();
  await page.getByRole("button", { name: "다음 페이지", exact: true }).click();
  await expect(page.getByLabel("PDF 원문 2페이지")).toBeVisible();
  await expect(
    page.locator(".pdf-hover-word, .pdf-hover-sentence"),
  ).toHaveCount(0);
  expect(calls).toEqual([]);
});

test("stale extraction metadata renders text but never creates cross-document hover", async ({
  page,
}) => {
  const { source, calls } = await setup(page, "stale");
  const phrase = page.locator(
    `.translation-phrase[data-segment-id="${source.id}"]`,
  );
  await expect(phrase).toHaveAttribute("data-linked", "false");
  await expect(phrase).toContainText("트레이스 기반");
  await phrase.hover();
  await expect(
    page.locator(".translation-word, .pdf-hover-word, .pdf-hover-sentence"),
  ).toHaveCount(0);
  expect(calls).toEqual([]);
});

test("keyboard word navigation and mobile page layout preserve cache-only behavior", async ({
  page,
}) => {
  const { source, calls } = await setup(page);
  const phrase = page.locator(
    `.translation-phrase[data-segment-id="${source.id}"]`,
  );
  await phrase.focus();
  await phrase.press("ArrowRight");
  await expect(phrase.locator('[data-word-index="0"]')).toHaveClass(
    /is-word-active/,
  );
  await phrase.press("ArrowRight");
  await expect(phrase.locator('[data-word-index="1"]')).toHaveClass(
    /is-word-active/,
  );
  await phrase.press("Escape");
  await expect(
    page.locator(".pdf-hover-word, .pdf-hover-sentence"),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".translation-paper")).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(391);
  expect(calls).toEqual([]);
});
