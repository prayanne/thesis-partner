# PDF 연속 스크롤

기록일: 2026-09-26, Asia/Seoul. 이 변경은 한 페이지씩 교체하던 원문 뷰어를 문서 전체가 세로로 이어지는 뷰어로 바꾼다.

## 읽기 동작

- 모든 페이지를 한 세로 목록에 배치한다. 페이지 경계를 걸쳐 두 페이지를 동시에 볼 수 있고, 휠·트랙패드·스크롤바 드래그로 문서 전체를 이동한다.
- 오른쪽 스크롤바의 길이는 전체 문서를 기준으로 한다. 아직 그리지 않은 페이지까지 드래그해도 문서 높이가 바뀌지 않는다.
- 상단 페이지 번호와 번역 패널은 뷰포트 위쪽의 읽기 위치를 따라간다. 문서 끝에서는 마지막 페이지를 선택한다.
- 페이지 번호 입력, 이전/다음 버튼, 메모의 원문 위치 이동은 같은 세로 목록 안의 해당 페이지로 이동한다. PDF 파일을 다시 열지 않는다.
- 확대·축소 시 현재 페이지 안의 상대적 세로 위치를 유지한다. 문서 끝까지 내린 상태에서는 끝 위치를 유지한다.
- 기존 읽기 위치 저장은 페이지 번호와 배율을 저장하며, 다시 열면 해당 페이지 시작으로 복원한다. 페이지 내부의 정확한 스크롤 픽셀 위치를 영속 저장하는 변경은 아니다.
- 작업 패널 접기, 상단 가로 스크롤의 양방향 동기화, 모바일 화면을 유지한다. 스크롤·페이지 이동·확대 자체로 AI 요청이나 읽기 상태 저장을 실행하지 않는다.

## 구현

- `apps/web/src/components/pdf-viewer.tsx`: 문서당 PDF.js loading task 하나를 사용한다. 각 페이지의 기본 viewport 크기를 먼저 측정하고, 전체 문서 공간·스크롤·페이지 이동·배율 변경을 관리한다.
- `apps/web/src/lib/pdf-layout.ts`: 회전·UserUnit이 반영된 viewport 크기를 받아 페이지 위치와 전체 높이를 계산한다. 읽기 위치의 페이지는 이진 탐색으로 찾고, 뷰포트 앞뒤 영역에 가까운 페이지만 렌더링 대상으로 선택한다.
- `apps/web/src/components/pdf-page.tsx`: 개별 페이지 canvas/text layer, 원문 선택, 저장된 하이라이트, 번역 호버와 렌더링 취소를 관리한다. 화면에서 멀어진 페이지의 canvas는 마운트 해제하되 페이지 슬롯은 유지한다.
- `apps/web/src/components/reader.tsx`: 스크롤에 따른 현재 페이지 갱신과 사용자가 요청한 페이지 이동을 구분해, 스크롤 위치가 페이지 맨 위로 되돌아가는 루프를 방지한다.

원문 좌표와 호버는 기존 revision·extraction·텍스트 hash·UTF-16 범위 검증을 유지한다. 스크롤하면 일시적 호버를 해제하며 같은 단어에 다시 호버할 수 있다. 여러 페이지나 텍스트 항목에 걸친 선택은 원문 연결 없이 안내를 표시하고 하이라이트 저장을 제공하지 않는다.

텍스트가 없는 페이지에서는 OCR 필요 안내를 작은 영역에 표시한다. 연속 페이지 CSS의 `inset: 0`이 안내까지 적용되어 원문 전체를 덮던 문제를 후속 검토에서 발견했다. 텍스트 없는 합성 PDF의 600px 높이 페이지에서 안내가 583px를 차지하는 실패를 재현한 뒤, 안내를 페이지 아래쪽의 내용 높이로 제한했다. 이미지·도형 원문은 계속 읽을 수 있으며 OCR 처리를 새로 구현한 것은 아니다.

## 검증

2026-09-26 현재 작업 트리와 배포된 production 서비스에서 확인했다.

| 검증 | 결과 |
| --- | --- |
| `npm test` | 333개 통과, native PostgreSQL 1개 의도적 skip |
| `npm run typecheck` / `npm run format:check` | 통과 |
| 전체 Chromium UI | 23개 통과, 20.8초 |
| WebKit PDF·번역 UI | 8개 통과, 15.5초 |
| `docker --context orbstack compose build web` | Next.js production build 포함 통과 |
| 빌드 경계 검사 | 1,710개 text asset 검사 통과 |
| 로컬 웹 배포 | web 교체 후 healthy, `/api/health` 정상 |

브라우저 실행 명령:

```sh
UI_TEST_URL=http://127.0.0.1:3000 npx playwright test \
  tests/ui-workspace.spec.ts tests/ui-setup.spec.ts tests/ui-pdf-browser.spec.ts \
  tests/ui-translation-page.spec.ts tests/ui-projects.spec.ts \
  --workers=1 --reporter=line --output=test-results/continuous-final-chromium

UI_TEST_URL=http://127.0.0.1:3000 UI_PDF_BROWSER=webkit npx playwright test \
  tests/ui-pdf-browser.spec.ts tests/ui-translation-page.spec.ts \
  --workers=1 --reporter=line --output=test-results/continuous-final-webkit
```

Git 제외 경로 `test-results/pdf-browser/chromium-continuous.png`와 `webkit-continuous.png`를 직접 검토했다. 두 브라우저에서 첫 페이지와 두 번째 페이지가 연속으로 보이며, 자동화 시험은 14페이지까지 실제 스크롤바 드래그와 화면 밖 canvas 해제를 확인한다. 외부 AI 생성 요청은 0회다.

## 검증 범위와 한계

- 브라우저 시험은 실제 로컬 서비스와 공개 PDF.js tracemonkey 14페이지 fixture를 사용한다. 첫 페이지에서 마지막 페이지까지 실제 마우스로 세로 스크롤바를 드래그하고, 두 페이지 동시 표시·휠 이동·페이지 점프·확대 후 위치 유지·390px 화면을 검사한다.
- 전체 문서 높이 유지와 canvas 개수 제한을 확인하며, 일반 PDF 전체 요청이 스크롤/확대마다 반복되지 않는지 확인한다. PDF.js의 필요한 byte-range 요청은 허용한다.
- 텍스트 없는 페이지 시험은 브라우저에서 PDF 응답만 합성 데이터로 대체한다. 원본 파일이나 DB의 논문 revision은 수정하지 않는다. canvas 픽셀과 화면 중앙의 hit test로 원문이 실제로 보이는지 검사한다.
- 1,000페이지의 배치 계산은 단위 테스트로 검사한다. 실제 1,000페이지 PDF의 시간·메모리 벤치마크나 모든 회전/혼합 크기 문서의 브라우저 검증은 아니다. 문서를 열 때 모든 페이지의 크기를 먼저 읽으므로 매우 큰 문서는 초기 측정 시간이 필요하다.
- Chromium과 Playwright WebKit을 검증한다. 설치된 Safari 앱 자체의 이번 변경 검증과는 구별한다.
- 외부 번역/AI 호출 없이 저장된 번역과 합성 단어 연결로 회귀를 검사한다. 실제 Google 단어 연결 성공 여부 등 기존 공급자 제한은 이 변경의 검증 대상이 아니다.
- DB schema/API 계약 변경과 신규 migration은 없다. 기본 Vitest의 native PostgreSQL 시험 1개는 전용 DB 환경이 없어 의도적으로 건너뛰며, 이번 UI 변경을 위해 native 시험을 별도로 재실행하지 않는다.
