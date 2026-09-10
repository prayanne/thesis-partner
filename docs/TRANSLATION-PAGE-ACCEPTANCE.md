# 페이지형 번역·양방향 호버 검증

기록일: 2026-09-10, Asia/Seoul. 범위는 번역 가독성, 원문/번역 호버, Google HTML 단어 표식 경로, 기존 기능 회귀다. RAG 대화·embedding 색인·AI 관계/reference 분석 전체 구현을 완료했다는 기록이 아니다.

## 이번에 구현한 동작

- 번역은 항목별 카드/반복 원문 인용 대신 제목, 앞부분 저자 정보, 문단이 있는 하나의 페이지형 문서다. 원문/번역 패널 폭을 재조정하고 번역 범위 선택은 접을 수 있게 했다. 원본 PDF를 수정하거나 새 한국어 PDF를 만드는 기능은 아니다.
- 기존 실제 Google 번역 캐시를 그대로 읽는다. 번역 진입/호버/탭 전환/브라우저 새로고침은 생성 호출을 하지 않는다. UI 요청 버튼은 현재 fingerprint의 캐시를 사용하고, `새로 생성`은 명시적 refresh다. 단어 profile 버전이 달라지면 생성 캐시는 구분되지만 과거 결과를 자동 삭제/재생성하지 않는다.
- 원문과 번역 양쪽의 문장·구절은 민트색, 유효한 단어 표식의 대응 범위는 호박색으로 강조한다. 실제 PDF.js DOM Range의 UTF-16 범위를 사용하고 현재 revision/extraction/hash/페이지에 연결되는지 검증한다. 메모 anchor와 별도 overlay다.
- Tab으로 구절에 초점을 주고 방향키로 단어를 이동할 수 있다. Escape, 포인터 이탈/선택 시작, 페이지/확대율/탭 변경 시 호버를 해제한다. 오래된 extraction 결과의 텍스트는 읽을 수 있지만 현재 원문으로 잘못 연결하지 않는다.
- 새 Google 번역 job은 `google-html-markers-v1`을 snapshot/fingerprint에 넣는다. 단어별로 escape된 평평한 `span id`를 보내고, 반환된 제한적 마크업만 파싱한다. 공급자 응답 HTML을 DOM으로 삽입하지 않는다. 누락/중복/겹침/Unicode 경계 위반/다른 텍스트 해시 등은 단어 연결을 해제하며 순서로 대응을 추측하지 않는다. 기존 queued text-mode snapshot은 이전 경로를 유지한다.

## 실제 데이터와 외부 호출 경계

사용자는 이 작업 시작 전에 OpenAI·Google 연동과 테스트 완료를 알렸다. 이번에 OpenAI 성공을 재시험한 것은 아니며, 9월 9일 초기 실패 기록을 현재 상태로 재해석하지 않는다. provider/모델/외부 전송 정책을 변경하지 않았다.

실제 브라우저 검증에는 저장되어 있던 `pdfjs-tracemonkey-validation` 공개 fixture만 사용했다. 14쪽 원본의 1쪽에는 비어 있지 않은 TextItem 151개와 기존 실제 Google 번역 캐시 151개가 있다. 페이지형 번역과 구절 호버는 이 캐시로 확인했다. 테스트에서 사용자 개인 PDF를 업로드하거나 번역하지 않았다.

새 단어 요청 형식에 대해 아래 **1회만** 실제 애플리케이션 job을 실행했다.

| 항목 | 관찰 결과 |
| --- | --- |
| 범위 | 공개 논문 제목의 첫 구절 1개, 원문 56자 |
| 전송 문자 예약 | HTML 표식/공백 포함 278자, 사전 상한 1,000자 이하 |
| job | `3bc32fbc-a54f-4cd4-acf7-aa39ed648291` |
| 시도 횟수 | 1, 자동 재시도/대체 provider 요청 없음 |
| 결과 | `failed / UPSTREAM_HTTP_ERROR`, 새 artifact 없음 |
| 사용량 | `outcome_unknown`, reserved characters 278, 실제 청구액 미확인 |
| 기존 결과 | 종전 페이지 번역 유지, 실패 뒤 cache-only 브라우저 검증 통과 |

현재 job/event에는 HTTP status나 상세 원인이 보존되지 않아 인증, 한도, 네트워크, 요청 형식 중 무엇이 원인인지 구분할 수 없다. 따라서 키가 잘못되었다거나 HTML 방식이 실제로 성공했다고 주장하지 않는다. 후속으로 안전한 오류 메타데이터를 먼저 보강하고 별도 허용한 작은 요청으로 확인해야 한다. 이번 실제 실패를 숨기기 위해 재요청하지 않았다.

## 검증 결과

| 검증 | 최종 결과 | 무엇을 증명하는가 |
| --- | --- | --- |
| Vitest 전체 | 329 통과, native 1 의도적 skip | provider/marker/domain/cache/usage/security/read-model 등 |
| Native PostgreSQL | 1 별도 통과 | 실제 PostgreSQL JSONB 회귀, 트랜잭션 rollback |
| Chromium production | 20 통과 | 기존 workspace 8 + setup 6 + PDF 2 + 번역 4 |
| WebKit production | 6 통과 | PDF 2 + 번역 4, Safari 계열 엔진 호버/선택/확대 |
| TypeScript / Prettier / diff check | 통과 | 정적 타입·포맷·공백 검사 |
| Host Next build / Docker image build | 통과 | 배포용 번들과 worker 이미지 생성 |
| Build boundary | 1,678 text assets 검사 통과 | 금지된 private runtime 경로/알려진 bootstrap 값 제외 |
| OrbStack | 기존 4개 서비스 유지, web/worker 교체 | web liveness 정상, 웹만 `127.0.0.1:3000` publish |

브라우저의 단어 시험은 **합성 alignment**를 실제 PDF TextItem에 연결한다. 원문 → 번역/번역 → 원문의 정확한 범위, 100%/150%에서 실제 DOM Range와 overlay의 x/y/width/height 일치, 페이지/탭/배율 변경 시 해제, stale provenance 거부, 키보드, 390px 화면의 overflow 부재를 확인했다. Google의 의미적 단어 정렬 정확도나 실제 새 응답 성공을 대신 증명하지 않는다. 번역 4개 시험은 로그인 이후 generation/쓰기 요청이 없음을 감시하고 종료 때 시험 세션을 로그아웃한다.

페이지 스크린샷 `test-results/translation-page/cached-chromium.png`, `cached-webkit.png`는 Git 제외된 로컬 검증 산출물이다. 실제 화면을 열어 제목/문단, 패널 균형, 기존 151구절 연속 표시를 확인했다. WebKit 자동화는 설치된 Safari 앱을 직접 조작한 것과 다르며, 이번에 Computer Use로 Safari를 재검증했다고 표시하지 않는다.

중간 실패와 수정도 보존한다.

- 개발 서버의 WebKit 실행은 PDF 초기 로딩 타임아웃과 종료 중 route fetch 오류로 실패했다. 실제 읽기 준비 상태를 기다리고 배포용 서비스에서 다시 검증했다. 실패 로그에 임시 시험 세션 헤더가 출력될 수 있는 route fetch 오류는 중단 처리하도록 변경했다. API 키 원문을 로그에 출력하지 않았다.
- WebKit의 150% 부분 단어 폭은 단순 `원래 폭 × 1.5`와 약 0.97px 차이가 있었다. 임계치만 느슨하게 하는 대신 각 배율의 실제 UTF-16 DOM Range 네 좌표와 overlay를 직접 비교하고 확대 비율도 검사한다.
- 첫 전체 Chromium 실행은 커리큘럼 복구 단계에서 멈췄으나 단독 재실행은 8개 모두 통과했다. 보관 이전 option을 고를 수 있는 시험 타이밍을 제거하려고 `보관됨`이 붙은 새 목록 도착을 기다리도록 보강했다. 이후 전체 20개 통과. 커리큘럼 제품 코드는 변경하지 않았다. Workspace 회귀는 기존 방식대로 UI QA 이름의 Wiki/커리큘럼·학습/메모 기록을 로컬 DB에 생성하며 사용자 기존 문서는 편집하지 않는다.
- Orca로 분리한 독립 read-model 검토에서 generation provenance, 중복 marker identity, 애매한 문장 병합, 줄바꿈 문단화 오류를 수정했다. [68개 독립 fixture와 검토 결과](TRANSLATION-PAGE-REVIEW.md)를 참조한다.

재현 명령(등록된 공개 fixture와 기존 번역 캐시가 있는 로컬 환경):

```sh
npm test
npm run typecheck
npm run format:check
npm run build
docker --context orbstack compose run --rm --no-deps worker test-native
UI_TEST_URL=http://127.0.0.1:3000 npx playwright test tests/ui-workspace.spec.ts tests/ui-setup.spec.ts tests/ui-pdf-browser.spec.ts tests/ui-translation-page.spec.ts --workers=1 --reporter=line
UI_TEST_URL=http://127.0.0.1:3000 UI_PDF_BROWSER=webkit npx playwright test tests/ui-pdf-browser.spec.ts tests/ui-translation-page.spec.ts --workers=1 --reporter=line
```

이 명령들은 실제 Google 단어 요청을 자동 실행하지 않는다.

## 개인정보·데이터·Git

시작/종료 digest 비교에서 `.env`, `data/master.key`, `data/config/config.json`, `data/config/secrets.enc.json` 모두 동일하며 0600 권한과 Git ignore를 확인했다. digest나 비밀 원문을 문서에 저장하지 않는다. 설정 revision은 11을 유지했다. 원본 PDF 수정, 마이그레이션/DB 초기화, volume 삭제, 다른 OrbStack 프로젝트 중지, 키 발급/회전은 하지 않았다. 기존 큐에 queued/running job이 없음을 확인한 뒤 web/worker만 갱신했다.

개발은 `dev → feature/page-translation-hover → dev`의 로컬 `--no-ff` 통합으로 관리한다. `main` 승격과 원격 push는 수행하지 않는다. 전체 서비스는 계속 개발 프리뷰다.

## 알려진 한계와 공식 근거

Google Basic의 번역 응답 필드는 번역 텍스트/언어/모델이며 별도의 word alignment 계약이 아니다. 이 구현은 HTML 보존을 활용한 보수적 association이고 언어학적 동등성을 보장하지 않는다. [Google Basic REST translate](https://docs.cloud.google.com/translate/docs/reference/rest/v2/translate)

HTML 태그와 공백도 과금 문자에 포함된다. marker를 포함한 동일 payload로 예약/정산하고 문자 한도 검사로 초과 전송을 차단한다. 결과 불명의 요청을 비용 0으로 표시하지 않는다. [Google Cloud Translation FAQ](https://docs.cloud.google.com/translate/faq)

문단과 문장 묶음은 PDF 좌표·글자 크기·원문 구두점 기반 휴리스틱이다. 다중 문장이 한 TextItem 안에 있거나 연결이 모호하면 구절 전체로 낮춘다. 약어, 다단 PDF 읽기 순서, 회전, 수식, OCR, 모든 언어의 문장 경계에 대한 완전한 지원이 아니다. backend는 아직 TextItem 단위 호출이므로 페이지형 화면이 페이지 전체 문맥 번역이나 batch API 최적화를 의미하지 않는다.

다음 개발 범위는 실제 marker 요청 진단/성공 검증, 문맥 번역 개선, 로컬 embedding → Qdrant 색인/검색 → 근거 기반 대화 → 분석/reference JSON 연결 순서다.
