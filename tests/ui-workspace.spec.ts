import { test, expect, type Page } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";

const base = process.env.UI_TEST_URL ?? "http://127.0.0.1:3000";
const stamp = Date.now();
test.use({ baseURL: base, viewport: { width: 1440, height: 1050 } });
test.describe.configure({ mode: "serial" });
let wikiId = "";
let curriculumId = "";
const runtimeErrors: string[] = [];

async function login(page: Page) {
  const token = (
    await readFile(
      process.env.UI_BOOTSTRAP_FILE ?? "data/bootstrap-token",
      "utf8",
    )
  ).trim();
  const result = await page.request.post(`${base}/api/v1/session`, {
    headers: { Origin: base },
    data: { token },
  });
  expect(result.ok()).toBeTruthy();
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
}
async function screenshot(page: Page, name: string) {
  await mkdir("test-results/ui", { recursive: true });
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
  await page.screenshot({
    path: `test-results/ui/${name}.png`,
    fullPage: true,
  });
}

test("bootstrap screen and safe unauthenticated state", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "내 작업 공간 열기" }),
  ).toBeVisible();
  await expect(page.getByLabel("접속 토큰", { exact: true })).toHaveAttribute(
    "type",
    "password",
  );
  await screenshot(page, "login");
});

test("library reads actual records and filters without generation", async ({
  page,
}) => {
  await login(page);
  const generations: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/(translations|summaries|chat)$/.test(request.url())
    )
      generations.push(request.url());
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "라이브러리", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".state.loading")).toHaveCount(0);
  await screenshot(page, "library");
  await page.getByLabel("논문 검색").fill(`UI QA no match ${stamp}`);
  await expect(
    page.getByRole("heading", { name: /검색한 논문이 없어요|첫 번째 논문/ }),
  ).toBeVisible();
  await page.getByLabel("논문 검색").fill("");
  await page.getByRole("button", { name: "논문 추가", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("폴더 안의 상대 경로")).toBeVisible();
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  expect(generations).toEqual([]);
});

test("Wiki creates and edits real Markdown with safe rendering", async ({
  page,
}) => {
  const imageRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("wiki-image-tracking.invalid"))
      imageRequests.push(request.url());
  });
  await login(page);
  await page.goto("/wiki");
  await page.getByRole("button", { name: "새 문서", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("문서 제목").fill(`UI QA 개념 ${stamp}`);
  await dialog.getByLabel("문서 식별 이름").fill(`ui-qa-${stamp}`);
  await dialog
    .getByLabel("위키 Markdown 본문")
    .fill(
      "## 한 문장 정의\n\n실제 UI 검증을 위한 사용자 문서입니다.\n\n- 기록 보존\n- 원문 근거\n\n<script>window.UI_XSS=true</script>\n\n![private tracking](https://wiki-image-tracking.invalid/pixel.png)",
    );
  await dialog.getByRole("button", { name: "미리보기", exact: true }).click();
  await expect(
    dialog.getByRole("heading", { name: "한 문장 정의" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "문서 저장", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".document-content h2").first()).toHaveText(
    `UI QA 개념 ${stamp}`,
  );
  expect(await page.evaluate(() => Object.hasOwn(window, "UI_XSS"))).toBe(
    false,
  );
  expect(imageRequests).toEqual([]);
  await expect(
    page.getByText("이미지 자동 로딩 차단:", { exact: false }),
  ).toBeVisible();
  const rows = (await (await page.request.get(`${base}/api/v1/wiki`)).json())
    .data;
  wikiId = rows.find(
    (row: { slug: string }) => row.slug === `ui-qa-${stamp}`,
  ).id;
  await page.getByRole("button", { name: "수정", exact: true }).click();
  await dialog
    .getByLabel("위키 Markdown 본문")
    .fill("## 한 문장 정의\n\n수정한 내용도 새 버전으로 보존합니다.");
  await dialog.getByRole("button", { name: "문서 저장", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByText("수정한 내용도 새 버전으로 보존합니다.", { exact: true }),
  ).toBeVisible();
  await screenshot(page, "wiki");
});

test("dynamic lesson blocks, real study, submission and versioned completion", async ({
  page,
}) => {
  test.setTimeout(90000);
  await login(page);
  await page.goto("/curriculum");
  await page
    .getByRole("button", { name: "커리큘럼 만들기", exact: true })
    .click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("제목", { exact: true }).fill(`UI QA 학습 ${stamp}`);
  await dialog
    .getByLabel("학습 목표")
    .fill("개념 → 자기 설명 → 실습 → 회고의 실제 저장 흐름을 검증합니다.");
  await dialog.getByRole("button", { name: "저장", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "단원 추가", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("단원 제목").fill("UI QA 기록과 재현");
  await dialog.getByRole("button", { name: "블록 추가", exact: true }).click();
  await dialog
    .getByLabel("Markdown 내용", { exact: true })
    .fill("## 기록의 목적\n\n결과와 재현 방법을 함께 남깁니다.");
  await dialog.getByLabel("추가할 블록 종류").selectOption("self_explanation");
  await dialog.getByRole("button", { name: "블록 추가", exact: true }).click();
  await dialog
    .getByLabel("한 줄에 한 항목", { exact: true })
    .fill("재현 가능한 기록에는 무엇이 필요한가요?");
  await dialog.getByLabel("추가할 블록 종류").selectOption("exercise");
  await dialog.getByRole("button", { name: "블록 추가", exact: true }).click();
  await dialog
    .getByLabel("표시 제목", { exact: true })
    .fill("결과 파일 기록하기");
  await dialog
    .getByLabel("Markdown 내용", { exact: true })
    .last()
    .fill("정상 결과와 실패 사례를 기록하고 명령을 설명하세요.");
  await dialog.getByLabel("추가할 블록 종류").selectOption("checklist");
  await dialog.getByRole("button", { name: "블록 추가", exact: true }).click();
  await dialog
    .getByLabel("한 줄에 한 항목", { exact: true })
    .last()
    .fill("예상 결과 확인\n실패 사례 확인");
  await dialog.getByLabel("추가할 블록 종류").selectOption("wiki_reading");
  await dialog.getByRole("button", { name: "블록 추가", exact: true }).click();
  await dialog
    .getByLabel("위키 읽기 자료", { exact: true })
    .selectOption(wikiId);
  await dialog
    .getByLabel("표시 제목", { exact: true })
    .last()
    .fill("기록 보존 개념");
  await dialog
    .getByRole("button", { name: "학습 내용 저장", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "UI QA 기록과 재현", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("1. 재현 가능한 기록에는 무엇이 필요한가요?", { exact: true })
    .fill("실행 환경, 방법, 정상 및 실패 결과, 당시 자료 버전이 필요합니다.");
  await page.getByLabel("예상 결과 확인", { exact: true }).check();
  await page.getByLabel("실제 학습 시간 (분)").fill("15");
  await page
    .getByLabel("오늘의 회고")
    .fill("정상/실패를 구분하고 재현 방법을 작성했습니다.");
  await page
    .getByRole("button", { name: "학습 기록 저장", exact: true })
    .click();
  await expect(
    page.getByText("학습 시간과 회고를 저장했습니다.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "실습 제출", exact: true }).click();
  await page
    .getByLabel("실행 환경", { exact: true })
    .fill("UI QA · 로컬 브라우저");
  await page
    .getByLabel("재현 방법", { exact: true })
    .fill("브라우저의 양식으로 기록 저장 후 다시 조회했습니다.");
  await page
    .getByLabel("정상 · 실패 결과와 회고", { exact: true })
    .fill(
      "정상 저장을 확인했고 미완료 체크가 완료를 확정하지 않음을 확인했습니다.",
    );
  await page
    .getByRole("button", { name: "실습 결과 제출", exact: true })
    .click();
  await expect(
    page.getByText(
      "실습 결과를 제출했습니다. 완료 여부는 별도로 확인해 주세요.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "완료 · 복습", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "학습 완료", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("필수 읽기 자료를 확인했습니다.", { exact: true })
    .check();
  await page
    .getByLabel("각 실습의 결과를 제출하고 최소 확인 항목을 점검했습니다.", {
      exact: true,
    })
    .check();
  await page
    .getByLabel("내가 직접 학습 완료를 확인합니다.", { exact: true })
    .check();
  await page.getByRole("button", { name: "학습 완료", exact: true }).click();
  await expect(
    page.getByText("1 / 1 단원 완료", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("예상 결과 확인", { exact: true }),
  ).toBeChecked();
  await page.getByRole("button", { name: "이전 기록", exact: true }).click();
  await expect(
    page
      .locator(".annotation-card")
      .filter({ hasText: "정상/실패를 구분하고 재현 방법을 작성했습니다." }),
  ).toBeVisible();
  await screenshot(page, "curriculum");
  const rows = (
    await (await page.request.get(`${base}/api/v1/curricula`)).json()
  ).data;
  curriculumId = rows.find(
    (row: { title: string }) => row.title === `UI QA 학습 ${stamp}`,
  ).id;
  await page.getByRole("button", { name: "단원 편집", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("단원 제목").fill("UI QA 기록과 재현 · 개정");
  await dialog
    .getByRole("button", { name: "학습 내용 저장", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByText("0 / 1 단원 완료", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "이전 기록", exact: true }).click();
  await expect(page.getByText(/이전 학습 버전/).first()).toBeVisible();
});

test("configuration tabs preserve safe policies and credentials are write-only", async ({
  page,
}) => {
  await login(page);
  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { name: "나의 읽기 환경", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "AI 공급자", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Ollama", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("호스트 AI의 원격 실행이 꺼진 것을 확인했습니다").first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "유료 AI", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "OpenAI", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("유료 AI 사용 허용")).not.toBeChecked();
  expect(
    await page
      .locator(".credential-form input")
      .evaluateAll((nodes) =>
        nodes.every(
          (n) =>
            (n as HTMLInputElement).type === "password" &&
            (n as HTMLInputElement).value === "",
        ),
      ),
  ).toBe(true);
  await screenshot(page, "settings");
  await page
    .getByRole("button", { name: "연결 · 사용 한도", exact: true })
    .click();
  await expect(page.getByLabel("로컬 전용 모드")).toBeChecked();
  await expect(
    page.getByLabel("외부 AI 연결 허용", { exact: false }),
  ).not.toBeChecked();
  expect(runtimeErrors).toEqual([]);
});

test("curriculum archive and restore preserve its records", async ({
  page,
}) => {
  await login(page);
  await page.goto("/curriculum");
  await page.getByLabel("커리큘럼 선택").selectOption(curriculumId);
  await page
    .getByRole("button", { name: "커리큘럼 보관", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "보관", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByLabel("보관된 항목 포함", { exact: true }).check();
  await page.getByLabel("커리큘럼 선택").selectOption(curriculumId);
  await page
    .getByRole("button", { name: "커리큘럼 복구", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "복구", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "UI QA 기록과 재현 · 개정",
      exact: true,
    }),
  ).toBeVisible();
});

test("mobile shell stays within viewport", async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "라이브러리", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".state.loading")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () =>
        document.querySelector(".sidebar")!.getBoundingClientRect().right <=
        document.querySelector(".main-shell")!.getBoundingClientRect().left,
    ),
  ).toBe(true);
  await screenshot(page, "mobile-library");
});

test("real PDF selection persists exact source ranges and scales highlight geometry", async ({
  page,
}) => {
  test.setTimeout(60000);
  await login(page);
  const papers = (
    await (await page.request.get(`${base}/api/v1/papers`)).json()
  ).data;
  const paper = papers.find(
    (p: { title: string; currentRevisionId?: string }) =>
      p.title === "pdfjs-tracemonkey-validation" && p.currentRevisionId,
  );
  expect(
    paper,
    "The coordinator must import the public PDF validation fixture first",
  ).toBeTruthy();
  const generationRequests: string[] = [];
  page.on("request", (r) => {
    if (
      r.method() === "POST" &&
      /\/(translations|summaries|chat)$/.test(r.url())
    )
      generationRequests.push(r.url());
  });
  await page.goto(`/papers/${paper.id}`);
  await expect(page.getByLabel("페이지 번호", { exact: true })).toBeEnabled();
  await page.getByLabel("페이지 번호", { exact: true }).fill("1");
  await page.getByLabel("PDF 확대 비율").selectOption("1");
  await expect(page.locator(".pdf-stage")).toBeVisible();
  await expect(page.locator(".textLayer span").first()).toBeAttached();
  await expect(page.locator(".state.loading")).toHaveCount(0);
  await expect(page.locator(".textLayer")).toContainText("Trace-based");
  const selection = await page.locator(".textLayer").evaluate((layer) => {
    const span = Array.from(layer.querySelectorAll("span")).find(
      (s) =>
        s.firstChild?.nodeType === Node.TEXT_NODE &&
        (s.textContent ?? "").startsWith("Trace-based"),
    );
    if (!span || !span.firstChild)
      throw new Error("Expected real PDF title text");
    const range = document.createRange();
    range.setStart(span.firstChild, 0);
    range.setEnd(span.firstChild, 11);
    const selected = window.getSelection()!;
    selected.removeAllRanges();
    selected.addRange(range);
    return range.toString();
  });
  expect(selection).toBe("Trace-based");
  await page.locator(".pdf-stage").dispatchEvent("mouseup");
  await page.getByRole("button", { name: "메모", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "하이라이트 저장", exact: true }),
  ).toBeVisible();
  const responsePromise = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      r.url().endsWith(`/papers/${paper.id}/annotations`),
  );
  await page
    .getByRole("button", { name: "하이라이트 저장", exact: true })
    .click();
  const response = await responsePromise;
  expect(response.ok()).toBeTruthy();
  const annotation = (await response.json()).data;
  expect(annotation.anchor.paperRevisionId).toBe(paper.currentRevisionId);
  expect(annotation.anchor.sourceRange).toEqual({ start: 0, end: 11 });
  expect(annotation.anchor.coordinateSpace).toBe("pdf-user-space-unrotated");
  expect(annotation.anchor.sourceTextHash).toMatch(/^[a-f0-9]{64}$/);
  await expect(page.locator(".pdf-highlight").last()).toBeVisible();
  const before = await page.locator(".pdf-highlight").last().boundingBox();
  await page.getByLabel("PDF 확대 비율").selectOption("1.5");
  await expect(page.locator(".state.loading")).toHaveCount(0);
  await expect(page.locator(".pdf-highlight").last()).toBeVisible();
  const after = await page.locator(".pdf-highlight").last().boundingBox();
  expect(after!.width / before!.width).toBeCloseTo(1.5, 1);
  expect(after!.height / before!.height).toBeCloseTo(1.5, 1);
  await screenshot(page, "reader-highlight");
  await page.getByLabel("페이지 번호", { exact: true }).fill("2");
  await expect(page.locator(".state.loading")).toHaveCount(0);
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.request().method() === "PATCH" && r.url().endsWith("/reading-state"),
    ),
    page.getByRole("button", { name: "읽기 위치 저장", exact: true }).click(),
  ]);
  await page.reload();
  await expect(page.getByLabel("페이지 번호", { exact: true })).toHaveValue(
    "2",
  );
  await expect(page.getByLabel("PDF 확대 비율")).toHaveValue("1.5");
  await page.getByLabel("페이지 번호", { exact: true }).fill("1");
  await page.getByLabel("PDF 확대 비율").selectOption("1");
  await expect(page.locator(".state.loading")).toHaveCount(0);
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.request().method() === "PATCH" && r.url().endsWith("/reading-state"),
    ),
    page.getByRole("button", { name: "읽기 위치 저장", exact: true }).click(),
  ]);
  const cleanup = await page.request.delete(
    `${base}/api/v1/annotations/${annotation.id}`,
    {
      headers: { Origin: base },
      data: { expectedRevision: annotation.revision },
    },
  );
  expect(cleanup.ok()).toBeTruthy();
  expect(generationRequests).toEqual([]);
  expect(runtimeErrors).toEqual([]);
});

test.afterAll(async ({ request }) => {
  const token = (
    await readFile(
      process.env.UI_BOOTSTRAP_FILE ?? "data/bootstrap-token",
      "utf8",
    )
  ).trim();
  await request.post(`${base}/api/v1/session`, {
    headers: { Origin: base },
    data: { token },
  });
  for (const resource of ["wiki", "curricula"]) {
    const response = await request.get(`${base}/api/v1/${resource}`);
    if (!response.ok()) continue;
    const rows = (await response.json()).data;
    for (const row of rows.filter(
      (r: { title: string }) =>
        r.title.includes(String(stamp)) && r.title.startsWith("UI QA"),
    )) {
      await request.delete(`${base}/api/v1/${resource}/${row.id}`, {
        headers: { Origin: base },
        data: { expectedRevision: row.revision },
      });
    }
  }
});
