# 로컬 개발 프리뷰 상태

기록일: 2026-09-26. 이 문서는 설계상 목표가 아니라 현재 구현과 실제 검증 경계를 기록한다. 전체 서비스 완성을 의미하지 않는다.

## 2026-09-26 PDF 연속 스크롤 — 최신

- PDF 전체 페이지를 세로 목록에 배치하고 실제 페이지 크기로 전체 높이를 유지한다. 화면 주변 페이지만 canvas/text layer로 그리며 휠·트랙패드·세로 스크롤바 드래그로 문서 전체를 이동한다.
- 현재 페이지와 번역 패널이 읽기 위치를 따라간다. 페이지 번호 입력·이전/다음·메모 이동은 같은 문서 안에서 이동하고, 확대·축소 시 페이지 안의 위치와 문서 끝 위치를 유지한다.
- 기존 선택·하이라이트·읽기 위치 저장·호버 검증을 유지한다. 스크롤 후 같은 단어에 다시 호버하는 동작과 여러 페이지에 걸친 선택의 원문 연결 거부를 검사했다.
- 텍스트 없는 페이지의 OCR 안내가 원문 전체를 덮는 CSS 회귀를 재현하고 수정했다. OCR 자체를 추가하지 않았으며 합성 PDF의 실제 canvas 픽셀과 화면 hit test로 원문 표시를 검사했다.
- 검증: Vitest 333개 통과 + native 1개 의도적 skip, production Chromium 23개·WebKit 8개, 타입·포맷·container production build 및 1,710개 build asset 경계 검사 통과. 실제 14페이지 PDF의 스크롤바 드래그·동시 페이지 표시·모바일 화면을 검사했으며 외부 AI 생성 요청은 0회다.
- 로컬 web 컨테이너에 배포했다. DB/API 변경은 없고 자세한 구현·명령·한계는 [PDF 연속 스크롤 기록](CONTINUOUS-PDF-SCROLL.md)을 따른다.

## 2026-09-23 넓은 논문 뷰어·연구 프로젝트 — 이전 기록

- 논문 화면 기본 비율을 약 70:30으로 넓히고 작업 패널 접기, 상단 가로 스크롤 동기화, 페이지 경계 휠 이동을 추가했다. PDF canvas/text layer, 메모와 번역 hover 검증 경계는 유지한다.
- 프로젝트 탭과 `research_projects`/`project_materials` 영속 모델을 추가했다. 한 도메인에 논문·Wiki·외부 링크·직접 메모를 연결하고, 자료별 프로젝트 메모와 전체 Markdown 통합 요약을 revision 충돌 보호 아래 저장한다.
- 프로젝트/자료 보관은 연결 원본을 삭제하지 않는다. 같은 활성 프로젝트의 같은 논문/Wiki 중복은 DB에서 거부한다. 프로젝트 읽기/쓰기는 기존 library scope에 포함한다.
- 프로젝트 정리는 현재 수동 Markdown 흐름이며 자동 다중 논문 AI 요약을 가장하지 않는다. 화면 진입·자료 저장·요약 편집에는 generation 요청이 없고, 실제 UI 시험에서 이를 감시한다.
- 최종 검증은 Vitest 330개 + native 1개 의도적 skip, 실제 PostgreSQL 1개, production Chromium 21개, WebKit 7개, 타입·포맷·host/container build 및 1,710개 asset 보안 경계 검사 통과다.
- 상세 설계, API, 검증 경계는 [넓은 논문 뷰어·연구 프로젝트 기록](PROJECTS-WIDE-READER.md)에 남긴다.

## 2026-09-10 페이지형 번역·양방향 호버 — 이전 기록

- 사용자가 OpenAI·Google 연동/테스트 완료를 알렸다. 이 알림은 아래 9월 9일 초기 실패 기록 이후의 상태이며 이번 변경에서 OpenAI를 다시 호출하거나 키/설정을 교체하지 않았다. 시작·종료 시 개인 설정 revision 11과 네 개인 파일의 바이트/0600 권한/Git 제외가 유지됨을 확인했다.
- 기존 Google 번역 151개 구절을 별도 카드 대신 제목·문단이 있는 페이지형 문서로 표시한다. 원문/번역 어느 쪽에서든 문장·구절 호버가 연결되며, 유효한 단어 연결이 있으면 별도 색상으로 표시한다. 페이지/배율/탭 변경, 선택 드래그 중에는 이전 호버를 해제한다.
- 새 번역 job은 버전이 명시된 HTML 단어 표식 profile을 사용한다. 파서·캐시·작업 snapshot·문자 사용량에 연결했다. marker/hash/revision/extraction/UTF-16 검증에 실패한 연결은 사용하지 않는다. 기존 캐시는 자동 재생성하지 않는다.
- 실제 공개 구절 56자, HTML 포함 278자, 단일 Google 요청은 `UPSTREAM_HTTP_ERROR`로 실패했다. 추가 요청/자동 재시도는 하지 않았고 기존 캐시는 유지됐다. HTTP status/body가 현재 job 기록에 보존되지 않아 원인은 미확정이며 사용량은 `outcome_unknown` 예약으로 남는다. **실제 Google 단어 연결 성공은 미검증**이다.
- 최종 검증: source 329개 통과 + 기본 native 1개 의도적 skip, 실제 PostgreSQL 1개 별도 통과, production Chromium 20개·WebKit 6개 통과. 타입/포맷/host·container build와 1,678개 build asset 경계 검사 통과. 기존 캐시는 실제 결과, 단어 연결은 synthetic 결과로 브라우저 검증했으며 의미적 번역 품질 검증과 구별한다.
- Orca 작업 분리 및 독립 검토에서 stale provenance, 중복 marker, 애매한 문장 경계, 줄바꿈 묶음 문제를 찾아 수정했다. 상세 증거·실패한 중간 실행·한계는 [이번 검증 기록](TRANSLATION-PAGE-ACCEPTANCE.md)과 [독립 검토](TRANSLATION-PAGE-REVIEW.md)에 남긴다.

## 2026-09-09 PDF·모델 선택·첫 설정 후속 작업 — 이전 기록

- 설치된 Safari에서 PDF 오류를 Computer Use로 재현했다. PDF.js legacy build와 일치하는 worker, `getReader()` 기반 텍스트 추출로 브라우저 호환성 문제를 해결하고 실제 원문·페이지 전환·150% 확대를 확인했다. 원본 PDF는 변경하지 않았다.
- 사용자가 등록한 기존 키를 재사용해 OpenAI를 `gpt-5.6-sol / high`로 활성화했다. 외부 AI·유료 AI만 허용하고 외부 번역·메타데이터는 계속 차단한다. 이는 API 키 과금이며 Codex 구독 인증 연동이 아니다.
- 제공자 규격별 모델 select, 기능별 기본 모델, 메타데이터/추론 분리 검증, 설정 변경 시 검증 무효화, 첫 설정 팝업과 개발자 모드 재실행을 구현했다. 최초 진입이나 새로고침은 유료 추론을 자동 호출하지 않는다.
- 실제 모델 목록에서 exact Sol 모델을 확인해 메타데이터 검증은 통과했다. 제한된 합성 추론 2회는 모두 응답 스트림 미완료였으며 성공으로 표시하지 않는다. 인식 가능한 실패 코드와 사용량이 없어 원인이나 비용을 추정하지 않는다. 추가 유료 진단은 별도 명시적 작업이다.
- 최종 검증: source 171개 통과 + host native 1개 의도적 skip, 실제 PostgreSQL 1개 별도 통과, production Chromium 16개·WebKit 2개 통과, 타입·포맷·host/container build 통과. 자세한 증거와 한계는 [검증 기록](READER-SETUP-ACCEPTANCE.md)을 따른다.

## 이전 작업 기록 — 수동 키 등록 기능

- OpenAI 보안 발급 picker를 다시 호출했지만 `UNAUTHORIZED / oauth_token_endpoint_unauthorized` 재인증 오류로 열리지 않았다. 키를 발급하거나 실제 비밀 파일에 저장하지 않았다. 사용자가 직접 키를 발급해 `.env`에 추가하는 방식으로 전환했다.
- `npm run credentials:import -- --from .env --provider openai --confirm-write`를 추가했다. `.env.local`과 Anthropic의 `ANTHROPIC_API_KEY`도 명시적으로 선택할 수 있다. 등록은 호스트에서 실행하며 provider는 비활성화 상태여야 한다.
- 선택한 변수만 파싱해 암호화 저장소에 저장하고 provider 참조를 연결한다. env의 다른 변수를 프로세스에 주입하지 않으며 외부 전송·유료 허용·모델·사용자 설정을 변경하지 않는다. 같은 키는 no-op, 다른 키로 교체할 때만 `--replace`가 필요하다.
- source/destination의 Git 제외·비추적, 소유권, owner-only 권한, symlink/hardlink, source 크기 제한을 검사한다. 목적지는 Docker/Next 빌드에서도 제외된 기본 `data/config`와 `data/master.key`로 제한한다. 원본 env 평문은 자동 삭제하지 않는다. importer는 새 암호화 항목을 staging한 뒤 설정 참조를 교체하며, 실패하면 이전 키와 참조는 유지되지만 사용하지 않는 암호화 항목이 남을 수 있다. 이전 항목의 자동 정리나 provider 측 키 폐기는 하지 않는다.
- 검증: 수동 등록 회귀 14개를 포함해 **78개 통과 / 네이티브 PostgreSQL 1개 의도적 skip**. 타입·포맷 검사와 production Next.js build 통과, build 경계 검사 1,636개 text asset 통과. 실제 CLI 프로세스도 격리한 임시 Git 저장소와 synthetic 값만 사용해 실행했다. build 경계 검사는 금지 파일명·기존 bootstrap 비밀 값 범위이며 모든 API 키 유출을 일반적으로 증명하는 검사는 아니다.
- 별도 Orca 보안 검토에서 저장 대상 권한/추적 여부와 Git-only ignore 경로의 빌드 포함 가능성을 발견해 수정했다. 독립 synthetic 6개 시나리오로 수정 결과를 재검증했고 확인된 보안 blocker 없이 검토를 마쳤다. 전체 앱 보안 감사나 실제 자격 증명 검증을 의미하지 않는다.
- 기존 Compose 4개 서비스는 계속 실행 중이고 웹 liveness는 정상이다. 이번 변경은 호스트 CLI이므로 컨테이너를 재빌드하거나 교체하지 않았다. 실제 `.env`, `.env.local`, `secrets.enc.json`이 아직 없음을 파일 메타데이터로 확인했다. 실제 유료 API 호출·브라우저 재검증·네이티브 DB 재검증은 이번 후속 작업에서 수행하지 않았다.

## 구현된 기반

| 영역 | 현재 구현 | 남은 검증/구현 |
| --- | --- | --- |
| 실행 구성 | React/Next.js, PostgreSQL, Qdrant, durable worker, 4개 Compose 서비스 | 운영 백업/복원 훈련, 장시간 중단/복구 검증 |
| 개인 정보 | 로컬 세션, Origin/Host 검사, scoped MCP 토큰, 암호화 키 저장, 설정 revision | OS/디스크 탈취 방어는 별도, 자동 키 발급 연결은 재인증 필요 |
| 논문 관리 | 읽기 전용 PDF 마운트, hash 중복 검사, 메타데이터 수정/보관, 텍스트 추출 | 스캔 PDF OCR, 복잡한 다단/수식 읽기 순서 |
| PDF 읽기 | 전체 문서 연속 스크롤·주변 페이지 렌더링, PDF.js canvas/text layer, 항목 hash/UTF-16 anchor, 메모·읽기 위치, 양방향 구절/검증된 단어 범위 호버 | 대용량 문서 실측, 복잡한 문장 재구성·레이아웃과 의미적 정렬 정확도 평가 |
| 번역/생성 | 페이지형 번역, HTML marker adapter, 버전별 캐시·명시적 refresh·job·취소/사용량 기반 | 실제 Google marker 성공, 문맥 품질, 인용 검증·계층 요약 |
| 초기 설정 | 유료/로컬 모델 select, 기능별 선택, 분리 검증, 첫 설정·개발자 replay | 미확인 모델의 추가 규격 profile, 실제 제공자별 추론 검증 |
| 분석 JSON | revision별 구조화 snapshot, 원자적 파일 교체, partial 상태와 coverage | 실제 AI 관계/중요도/reference 추출 통합 |
| Vector | Qdrant 컨테이너와 client adapter | embedding 생성·색인·재색인·실제 유사도 검색 전체 연결 |
| 대화 | UI와 provider streaming adapter | 논문 RAG, 영속 대화 분기/재생성. 현재 요청은 명시적 501 |
| 학습/Wiki | 동적 lesson block, 선행관계 DAG, revision snapshot, Wiki 이력, 실습·회고 | 더 넓은 커리큘럼과 실제 학습 사용성 검증 |
| API/MCP | 공통 도메인, REST, modern MCP 도구/리소스 | OpenAPI 산출물, 기타 MCP 클라이언트 호환성 |

Google Basic API가 별도 단어 alignment를 반환한다고 가정하지 않는다. 새 profile은 반환 HTML에서 보존된 marker를 문자열 hash/범위와 함께 검증한다. 기존 결과 또는 marker가 없는 결과는 문장·구절로 연결한다. 구조적으로 유효한 marker도 의미적으로 정확한 번역 대응을 보장하지 않는다. 원문 PDF TextItem anchor 검증은 번역 품질 검증과 다르다.

요약 요청은 선택 범위의 텍스트를 사용한다. 긴 논문을 자동으로 잘라 전체 분석으로 표시하지 않고 제한을 보고한다. 분석 JSON의 빈 relations/references는 해당 논문에 관계가 없다는 뜻이 아니라 아직 분석하지 않았다는 뜻이다. Qdrant 컨테이너가 실행 중인 것은 vector 기능 완성과 다르다.

## 기반 구현 당시 확인한 증거 — 최신 검증은 상단 참조

- 최종 통합: `npm test` 64개 통과, 네이티브 PostgreSQL 테스트 1개는 기본 실행에서 의도적으로 제외하고 읽기 전용 Compose worker에서 별도로 통과. 최종 Compose production 웹 대상으로 Playwright 8개 시나리오 통과(5.5초).
- 실행 상태: web/worker/postgres/qdrant 4개 서비스 구동. web·PostgreSQL healthcheck 정상, Qdrant `/readyz` 200, 웹만 `127.0.0.1:3000`에 publish. worker/Qdrant는 상시 healthcheck가 아니라 실행 상태와 별도 실제 작업/readyz로 확인했다.
- TypeScript 검사, production Next.js build, Docker image build 통과.
- 빌드 산출물 검사: 개인 런타임 파일/로그인 토큰/DB 암호/마스터 키가 포함되지 않는지 검사 통과. runtime 이미지 내부 파일의 경계 검사도 통과했고 web의 개발 캐시를 runtime 이미지로 복사하지 않는다. worker 실행/로컬 회귀 검증을 위해 현재 이미지는 일부 소스와 개발 의존성을 포함한다.
- 네이티브 PostgreSQL migration 및 임시 테이블 rollback 회귀: JSONB 객체/배열/null 및 중첩 snapshot 타입 확인.
- 실제 HTTP API: 비인증 401, 로그인, local-only 기본값, provider registry, Wiki 생성/수정/보관, stale revision 409.
- 공개 PDF 14쪽, 2,436 TextItem 추출, 첫 쪽 151항목, 원본 SHA-256 불변, 분석 JSON partial 및 AI 분석 페이지 0 확인.
- 실제 HTTP MCP SDK client: modern 협상, tools 조회, 논문 읽기, 읽기 전용 토큰의 Wiki 쓰기 거부, 테스트 후 토큰 폐기.
- 브라우저 8개 시나리오: Wiki 편집, 동적 단원/학습/실습/완료 및 개정 이력, 보관/복구, 설정, 모바일 레이아웃, 실제 PDF 선택. 원문 `Trace-based`의 UTF-16 범위 `[0,11)` 저장과 150% 배율에서의 highlight 크기 변화, 재접속 시 읽기 위치 보존을 확인했다. 이 검증은 번역 단어 alignment 검증이 아니다.
- 원본 마운트 PDF를 컨테이너 worker에서 실제 재추출해 같은 14쪽/2,436항목을 확인했다. Wiki HTML 실행 거부와 외부 이미지 자동 로딩 차단도 production 브라우저에서 확인했다.
- 보안 회귀: 다른 토큰의 생성 작업 조회/취소 거부, 원래 필요한 유료/외부 scope 재검사, 세션 로그아웃/만료와 token 폐기 재검사, dispatch 직전 변경된 한도 검사, MCP resource 오류 비밀값 제거, JSON-RPC parse error 형식.

테스트용 PDF는 [Mozilla PDF.js의 공개 샘플](https://mozilla.github.io/pdf.js/web/compressed.tracemonkey-pldi-09.pdf)을 개발자의 로컬 `library/`에 내려받아 사용했다. 원본 PDF는 저장소에 포함하지 않는다. 단일 PDF 성공은 일반적인 논문 레이아웃 지원을 보증하지 않는다.

네이티브 테스트에서 발견한 JSONB 이중 직렬화 문제는 driver 수정과 별도 forward migration으로 복구했다. 적용된 migration checksum은 고정하며 DB 초기화나 사용자 텍스트 일괄 치환으로 해결하지 않는다.

## 이번에 하지 않은 일

- OpenAI 키 신규 발급/회전: setup connector의 자동 발급은 실패했으며, 이후 사용자가 직접 등록한 기존 키를 사용했다. 이번 작업에서 키를 새로 발급했다고 표시하지 않는다.
- 이번 변경 중 OpenAI/Claude 재호출, 로컬 모델 다운로드/실행. 사용자가 알린 기존 API 성공과 별개로, 새 Google marker 실제 요청 1회는 실패했으며 위에 구분했다.
- 사용자 개인 논문의 외부 업로드, 원격 Git push, main 릴리스. 외부 전송은 공개 PDF의 짧은 구절 1개로 한정했다.
- 실제 비용 정확도, Google 번역 word alignment 품질, 전체 RAG/vector 파이프라인 완료 선언.
- 설정 화면의 키 변경은 여전히 키 파일과 설정 파일을 하나의 transaction으로 묶지 않는다. 수동 import CLI에만 새 암호화 항목을 먼저 저장하고 참조를 교체하는 순서를 추가했다. 완전한 다중 파일 transaction/복구 journal은 아니며 과거 키 버전 복원 UI는 없다. 모든 경로에서 credential revision과 provider snapshot 재검사로 이전 작업의 잘못된 키 사용을 차단한다.
- 페이지 번역의 부모 job을 일괄 취소하는 기능은 공유 자식 job 처리 규칙이 완성되지 않아 명시적 501로 차단한다. 취소됐다고 표시하면서 자식 호출을 계속 실행하지 않는다. 개별 소유 job 취소 또는 설정의 번역 허용 해제를 사용한다. Google 요청은 현재 TextItem별 호출이며 batch 최적화도 남아 있다.
- 기본 개발 레이아웃의 마스터 키는 Git/Docker에서 제외되는 `data/master.key`에 있다. 설계상의 저장소 바깥 별도 마스터 키 배치 및 백업/복구 절차는 아직 기본 Compose 경로로 일반화하지 않았다.

## 다음 구현 순서

1. 새 HTML 단어 표식 요청의 안전한 HTTP status/오류 진단을 보강하고, 별도 허용한 단일 요청으로 실제 Google 응답을 확인한다. 근거 없이 키·모델·한도를 변경하거나 실패한 요청을 자동 반복하지 않는다.
2. 문맥 단위 번역/batch와 다단·회전·수식 평가 fixture를 추가한다. 이번 페이지형 UI가 전체 페이지 문맥을 한 번에 번역하는 backend 변경을 의미하지는 않는다.
3. 로컬 embedding profile을 선택하고 Qdrant 색인/재색인 및 출처 기반 검색을 연결한다.
4. 검색 근거를 사용하는 대화와 분석/reference/중요도 결과를 cache 및 analysis JSON에 연결한다.
5. 사용량 가격표·한도 경합·복구 테스트와 백업/복원까지 검증한 후 안정 버전 승격을 판단한다.
