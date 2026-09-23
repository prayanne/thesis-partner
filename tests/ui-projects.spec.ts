import { test, expect, type Page } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";

const base = process.env.UI_TEST_URL ?? "http://127.0.0.1:3000";
const stamp = Date.now();
const browserName =
  process.env.UI_PROJECT_BROWSER === "webkit" ? "webkit" : "chromium";

test.use({
  baseURL: base,
  browserName,
  viewport: { width: 1440, height: 1050 },
});

async function login(page: Page) {
  const token = (
    await readFile(
      process.env.UI_BOOTSTRAP_FILE ?? "data/bootstrap-token",
      "utf8",
    )
  ).trim();
  const response = await page.request.post(`${base}/api/v1/session`, {
    headers: { Origin: base },
    data: { token },
  });
  expect(response.ok()).toBeTruthy();
}

test.afterEach(async ({ page }) => {
  await page.request.delete(`${base}/api/v1/session`, {
    headers: { Origin: base },
  });
});

test("project workspace collects papers and notes into a durable synthesis without AI calls", async ({
  page,
}) => {
  await login(page);
  const generationRequests: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/(translations|summaries|chat)$/.test(request.url())
    )
      generationRequests.push(request.url());
  });
  const papers = (
    await (await page.request.get(`${base}/api/v1/papers`)).json()
  ).data as { id: string; title: string }[];
  const paper = papers.find(
    (item) => item.title === "pdfjs-tracemonkey-validation",
  );
  expect(paper, "The registered public PDF fixture is required").toBeTruthy();

  await page.goto("/projects");
  await expect(
    page.getByRole("heading", { name: "프로젝트", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "새 프로젝트" }).click();
  let dialog = page.getByRole("dialog");
  const title = `UI QA 연구 프로젝트 ${stamp}`;
  await dialog.getByLabel("프로젝트 이름").fill(title);
  await dialog
    .getByLabel("연구 도메인")
    .fill("Information Retrieval · Local-first AI");
  await dialog
    .getByLabel("프로젝트 목표와 질문")
    .fill("논문과 직접 메모의 근거를 한 문서로 취합합니다.");
  await dialog.getByRole("button", { name: "프로젝트 만들기" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "자료 추가" }).first().click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("프로젝트 자료 종류").selectOption("paper");
  await dialog.getByLabel("프로젝트에 추가할 논문").selectOption(paper!.id);
  await dialog
    .getByLabel("이 프로젝트에서의 메모")
    .fill("프로젝트의 기준 논문으로 사용합니다.");
  await dialog.getByRole("button", { name: "자료 추가" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: paper!.title, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("프로젝트의 기준 논문으로 사용합니다."),
  ).toBeVisible();

  await page.getByRole("button", { name: "자료 추가" }).first().click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("프로젝트 자료 종류").selectOption("note");
  await dialog.getByLabel("자료 제목").fill("비교 관찰");
  await dialog
    .getByLabel("메모 Markdown")
    .fill("- 재현 가능성 확인\n- 검색 품질 비교");
  await dialog
    .getByLabel("이 프로젝트에서의 메모")
    .fill("후속 실험 설계에 반영합니다.");
  await dialog.getByRole("button", { name: "자료 추가" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "비교 관찰", exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "요약 편집" }).click();
  await page
    .getByLabel("프로젝트 통합 요약 Markdown")
    .fill(
      "## 현재 결론\n\n기준 논문과 직접 관찰을 함께 검토했다.\n\n## 다음 질문\n\n검색 품질을 동일한 데이터로 비교한다.",
    );
  await page.getByRole("button", { name: "통합 요약 저장" }).click();
  await expect(
    page.getByRole("heading", { name: "현재 결론", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("기준 논문과 직접 관찰을 함께 검토했다."),
  ).toBeVisible();
  expect(generationRequests).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1050 });

  await mkdir("test-results/projects", { recursive: true });
  await page.screenshot({
    path: `test-results/projects/workspace-${browserName}.png`,
    fullPage: true,
  });

  await page.getByLabel("프로젝트 보관").click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "보관", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText(title, { exact: true })).toHaveCount(0);

  await page.getByLabel("보관된 프로젝트·자료 포함").check();
  await page.locator(".project-list-item").filter({ hasText: title }).click();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await page.getByLabel("프로젝트 복구").click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "복구", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByLabel("프로젝트 보관")).toBeVisible();

  await page.getByLabel("프로젝트 보관").click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "보관", exact: true }).click();
  await expect(dialog).not.toBeVisible();
});
