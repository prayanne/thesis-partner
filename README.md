# Thesis Partner

개인 PC에서 논문 관리, 원문·번역 읽기, 논문 기반 AI 대화, CS 커리큘럼, 실습 기록과 Wiki를 연결하는 로컬 서비스.

현재 단계는 **로컬 개발 프리뷰 0.1.0-dev**이다. 실행 가능한 UI·API·worker·컨테이너 기반을 구현했다. 전체 요구사항의 완료 버전은 아니며, 아래 설계 문서의 목표와 실제 구현 상태를 구분해야 한다.

- [제품·아키텍처·개발 계획](docs/PLAN.md)
- [데이터 모델·캐시·REST API·MCP 계약](docs/DATA-API.md)
- [초기 CS 커리큘럼·Wiki·실습 설계](docs/CURRICULUM.md)
- [Git 브랜치·커밋·검증·릴리스 규칙](CONTRIBUTING.md)
- [구현 상태·검증 범위·남은 작업](docs/IMPLEMENTATION-STATUS.md)

기본 구성: React UI + Next.js API, PostgreSQL, 별도 Qdrant, background worker. OrbStack 위에서 Docker Compose로 구동하고 원본 PDF는 호스트 디렉터리를 마운트한다. Ollama·LM Studio는 PC에서 실행 중인 서비스를 연결한다.

유료 AI의 첫 지원 대상은 OpenAI API(ChatGPT 계열 모델)와 Anthropic Claude API다. Configuration에서 유료 AI와 무료/로컬 AI를 구분하고 사용 허용·모델·사용량·예상 비용 한도를 저장한다. Google Cloud Translation은 기존 번역 기능의 별도 과금 항목이다. provider adapter와 capability registry를 통해 이후 제공자를 추가한다.

개발 브랜치는 `main`, `dev`, `feature/*`, `hotfix/*`를 사용한다. 일반 개발은 `dev → feature/* → dev`, 안정 버전은 `dev → main`, 긴급 수정은 `main → hotfix/* → main + dev` 흐름으로 관리한다.

## 실행

Node.js 24, npm, 실행 중인 OrbStack이 필요하다. 최초 실행은 저장소 루트에서 진행한다. 기본 UID/GID는 macOS 일반 사용자 501:20이며 다른 계정은 Compose 실행 환경의 `LOCAL_UID`/`LOCAL_GID`를 맞춘다.

```sh
npm ci
CONTAINER_RUNTIME=1 npm run setup:local
mkdir -p library
docker --context orbstack compose build web
docker --context orbstack compose up -d postgres qdrant
docker --context orbstack compose run --rm --no-deps worker migrate
docker --context orbstack compose run --rm --no-deps worker seed
docker --context orbstack compose up -d web worker
```

`http://127.0.0.1:3000`에 접속하고 `data/bootstrap-token` 파일의 로컬 로그인 토큰으로 로그인한다. 이 토큰은 서비스에 대한 전체 권한이므로 채팅·로그·Git에 붙이지 않는다. 설정에서 발급하는 MCP 토큰은 별도이며 기본값은 읽기 전용이다.

원본 PDF는 `library/`에 두고 논문 목록의 등록 기능을 사용한다. 다른 기존 폴더는 Compose 환경의 `PAPERS_DIR`로 지정한다. 원본은 컨테이너에 읽기 전용으로 마운트되며, 논문 보관 처리로 PDF를 삭제하지 않는다. 분석 JSON은 `data/artifacts/analysis/<paperId>/<stableStem>_analysis.json`에 별도로 저장한다.

`seed`는 초급 CS 학습 경로, Wiki, 논문 **메타데이터와 출처 링크**를 저장한다. 논문 PDF나 모델을 자동 다운로드하지 않는다. 같은 seed를 다시 실행해 기존 학습 이력을 초기화하지 않는다.

```sh
docker --context orbstack compose ps
docker --context orbstack compose logs --tail 50 web worker
docker --context orbstack compose stop
```

`compose stop`은 데이터와 원본을 유지한다. `down -v`는 DB/vector volume을 삭제하므로 일반 중지 명령으로 사용하지 않는다. 이 앱 때문에 OrbStack 전체 설정이나 다른 프로젝트를 중지할 필요는 없다.

## 개인 설정과 API

기본 설정은 local-only이며 외부 AI·번역·유료 AI가 모두 꺼져 있다. Google은 공식 Cloud Translation Basic API를 사용한다. 무료 번역 웹페이지를 비공식으로 스크래핑하지 않는다. OpenAI API/Claude API는 웹 채팅 구독과 별도의 API 계정·과금 설정이 필요하다.

- `data/config/config.json`: 개인 환경 설정, revision 충돌 검사, API 키 원문 없음.
- `data/config/secrets.enc.json`: 설정 화면에서 입력한 키의 AES-256-GCM 암호문. 상태만 조회 가능.
- `data/master.key`: 암호화 마스터 키. 분실하면 암호문을 복호화할 수 없으며, 암호문과 함께 탈취되면 보호되지 않으므로 별도 안전한 백업이 필요하다.
- `data/bootstrap-token`, `data/postgres-password`: 최초 실행용 로컬 비밀 파일. 생성 시 파일 권한 0600.

개인 파일, PDF, DB, 분석 결과와 모델 파일은 Git 및 Docker build context에서 제외한다. `.env.example`은 비밀 값 없는 경로 예시일 뿐이며, 실제 `.env.local`이나 API 키를 자동 생성하지 않는다. 설정에서 키를 바꿔도 이전 세대의 작업에 새 키를 조용히 적용하지 않는다.

Ollama/LM Studio는 호스트 PC에서 실행한다. **컨테이너에서의 주소는 `http://host.docker.internal:11434/v1` / `http://host.docker.internal:1234/v1`** 이다. 호스트 개발 시에는 `127.0.0.1`을 사용한다. 기존 설정은 보존되므로 실행 방식을 바꾸면 Configuration에서 주소를 확인해야 한다. 로컬 서버도 cloud model/proxy/LM Link를 사용할 수 있으므로 해당 기능이 꺼져 있는지 확인한 후 로컬 격리를 확인한다. 주소 변경 후에는 다시 확인해야 한다.

돈 단위 한도를 설정했는데 검증된 모델 가격 정보가 없으면 유료 요청을 차단한다. 비용을 임의로 추정해 한도를 지켰다고 표시하지 않는다. 실제 외부 provider/번역 호출은 아직 검증하지 않았다.

## API와 MCP

REST 기본 경로는 `/api/v1`, MCP는 `/mcp`이다. 둘은 동일한 도메인 작업과 정책 검사를 사용한다. 설정·키 관리 API는 브라우저 로컬 세션만 허용하고 MCP로 노출하지 않는다. MCP에는 `Authorization: Bearer <scoped-token>`이 필요하다.

현재 MCP는 SDK 2의 modern 프로토콜, HTTP POST를 사용하며 legacy 프로토콜은 거부한다. 모든 MCP 클라이언트와의 호환을 보장하는 버전이 아니다. 실제 SDK 클라이언트의 네트워크 접속·도구 조회·논문 읽기·권한 없는 쓰기 거부를 smoke test로 검증한다.

## 개발과 검증

```sh
npm run format:check
npm run typecheck
npm test
npm run build
```

`npm test`는 격리된 PGlite/모의 provider 테스트를 기본으로 한다. 네이티브 PostgreSQL 회귀 테스트는 `TEST_DATABASE_URL`이 있을 때만 실행하며, 테스트에서 만든 행을 트랜잭션 rollback으로 되돌린다. 개발 DB에서 `docker --context orbstack compose run --rm --no-deps worker test-native`로 실행할 수 있다. `tests/ui-workspace.spec.ts`는 실제 실행 중인 앱의 브라우저 검증이다. `scripts/smoke-local.ts`는 자격 증명 없는 local-only 개발 환경에서만 실행하는 검증이며 테스트 Wiki와 임시 MCP 토큰을 만들고 보관/폐기한다.

개발은 `feature/local-service-foundation`에서 수행한다. 전체 기능을 검증하기 전에는 `main` 안정 버전으로 릴리스하지 않는다.
