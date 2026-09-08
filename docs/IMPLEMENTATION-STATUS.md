# 로컬 개발 프리뷰 상태

기록일: 2026-09-08. 이 문서는 설계상 목표가 아니라 현재 구현과 실제 검증 경계를 기록한다. 전체 서비스 완성을 의미하지 않는다.

## 구현된 기반

| 영역 | 현재 구현 | 남은 검증/구현 |
| --- | --- | --- |
| 실행 구성 | React/Next.js, PostgreSQL, Qdrant, durable worker, 4개 Compose 서비스 | 운영 백업/복원 훈련, 장시간 중단/복구 검증 |
| 개인 정보 | 로컬 세션, Origin/Host 검사, scoped MCP 토큰, 암호화 키 저장, 설정 revision | OS/디스크 탈취 방어는 별도, 키 발급 연결 재인증 필요 |
| 논문 관리 | 읽기 전용 PDF 마운트, hash 중복 검사, 메타데이터 수정/보관, 텍스트 추출 | 스캔 PDF OCR, 복잡한 다단/수식 읽기 순서 |
| PDF 읽기 | PDF.js canvas/text layer, 항목 hash/UTF-16 anchor, 메모·읽기 위치 | 문장 재구성과 번역 단어 정렬 정확도 평가 |
| 번역/생성 | Google/OpenAI/Claude/Ollama/LM Studio adapter, 캐시·명시적 refresh·job·취소/사용량 기반 | 실 API 검증, Google 문맥 품질, 인용 검증·계층 요약 |
| 분석 JSON | revision별 구조화 snapshot, 원자적 파일 교체, partial 상태와 coverage | 실제 AI 관계/중요도/reference 추출 통합 |
| Vector | Qdrant 컨테이너와 client adapter | embedding 생성·색인·재색인·실제 유사도 검색 전체 연결 |
| 대화 | UI와 provider streaming adapter | 논문 RAG, 영속 대화 분기/재생성. 현재 요청은 명시적 501 |
| 학습/Wiki | 동적 lesson block, 선행관계 DAG, revision snapshot, Wiki 이력, 실습·회고 | 더 넓은 커리큘럼과 실제 학습 사용성 검증 |
| API/MCP | 공통 도메인, REST, modern MCP 도구/리소스 | OpenAPI 산출물, 기타 MCP 클라이언트 호환성 |

번역 공급자가 단어 alignment를 반환한다고 가정하지 않는다. 현재 번역 결과의 alignment는 unavailable이며, 대응하지 않는 단어를 그럴듯하게 하이라이트하지 않는다. 원문 PDF TextItem anchor 검증은 번역 문장/단어 정렬 검증과 다르다.

요약 요청은 선택 범위의 텍스트를 사용한다. 긴 논문을 자동으로 잘라 전체 분석으로 표시하지 않고 제한을 보고한다. 분석 JSON의 빈 relations/references는 해당 논문에 관계가 없다는 뜻이 아니라 아직 분석하지 않았다는 뜻이다. Qdrant 컨테이너가 실행 중인 것은 vector 기능 완성과 다르다.

## 실제 확인한 증거

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

- OpenAI 키 `thesis_parser_key`의 발급/저장: setup connector가 재인증을 요구했고, 보안 로컬 저장 위치 확인도 승인 완료되지 않았다. 키가 발급됐다고 표시하지 않는다.
- OpenAI, Claude, Google의 실제 유료 요청 또는 로컬 모델 다운로드/실행.
- 외부 계정/논문 내용 업로드, 원격 Git push, main 릴리스.
- 실제 비용 정확도, Google 번역 word alignment 품질, 전체 RAG/vector 파이프라인 완료 선언.
- 설정 파일과 키 파일을 하나의 transaction으로 묶는 staged credential-reference 교체는 아직 구현하지 않았다. 현재는 각 파일의 원자적 교체와 credential revision 재검사로 이전 작업의 잘못된 키 사용을 차단하며, 설정 저장 실패 시 키 상태를 다시 확인해야 한다. 과거 키 버전의 복구는 제공하지 않는다.
- 페이지 번역의 부모 job을 일괄 취소하는 기능은 공유 자식 job 처리 규칙이 완성되지 않아 명시적 501로 차단한다. 취소됐다고 표시하면서 자식 호출을 계속 실행하지 않는다. 개별 소유 job 취소 또는 설정의 번역 허용 해제를 사용한다. Google 요청은 현재 TextItem별 호출이며 batch 최적화도 남아 있다.
- 기본 개발 레이아웃의 마스터 키는 Git/Docker에서 제외되는 `data/master.key`에 있다. 설계상의 저장소 바깥 별도 마스터 키 배치 및 백업/복구 절차는 아직 기본 Compose 경로로 일반화하지 않았다.

## 다음 구현 순서

1. 키 발급 connector 재인증과 승인된 보안 저장 경로 확인. API smoke test는 작은 명시적 요청으로 제한한다.
2. 실제 Google 번역에 문장 분할·alignment profile을 연결하고 다단/회전/수식 PDF 평가 fixture를 만든다.
3. 로컬 embedding profile을 선택하고 Qdrant 색인/재색인 및 출처 기반 검색을 연결한다.
4. 검색 근거를 사용하는 대화와 분석/reference/중요도 결과를 cache 및 analysis JSON에 연결한다.
5. 사용량 가격표·한도 경합·복구 테스트와 백업/복원까지 검증한 후 안정 버전 승격을 판단한다.
