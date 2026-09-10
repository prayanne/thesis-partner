# Thesis Partner

개인 PC에서 논문 관리, 원문·번역 읽기, 논문 기반 AI 대화, CS 커리큘럼, 실습 기록과 Wiki를 연결하는 로컬 서비스.

현재 단계는 **로컬 개발 프리뷰 0.1.0-dev**이다. 실행 가능한 UI·API·worker·컨테이너 기반을 구현했다. 전체 요구사항의 완료 버전은 아니며, 아래 설계 문서의 목표와 실제 구현 상태를 구분해야 한다.

- [제품·아키텍처·개발 계획](docs/PLAN.md)
- [데이터 모델·캐시·REST API·MCP 계약](docs/DATA-API.md)
- [초기 CS 커리큘럼·Wiki·실습 설계](docs/CURRICULUM.md)
- [Git 브랜치·커밋·검증·릴리스 규칙](CONTRIBUTING.md)
- [구현 상태·검증 범위·남은 작업](docs/IMPLEMENTATION-STATUS.md)
- [PDF 뷰어·모델 선택·첫 설정 검증 결과](docs/READER-SETUP-ACCEPTANCE.md)
- [페이지형 번역·양방향 호버 검증 결과](docs/TRANSLATION-PAGE-ACCEPTANCE.md)

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

처음 로그인하면 첫 설정 팝업에서 외부 전송 정책, 유료/로컬 제공자와 모델, 기능별 기본값을 순서대로 설정한다. 완료 또는 나중에 설정 상태는 로컬 설정 파일에 저장된다. **환경 설정 → 일반 · 읽기**에서 개발자 모드를 켜면 **첫 설정 다시 열기**로 기존 설정을 유지한 채 다시 테스트할 수 있다.

**환경 설정 → AI 공급자**의 모델 선택창은 제공자별 API 규격과 확인한 모델 목록을 함께 사용한다. 지원 규격을 확인하지 못한 모델은 이유와 함께 선택을 제한한다. 저장한 설정의 메타데이터 검증과 실제 추론 검증은 별개다. 유료 추론 검증은 현재 설정의 메타데이터 검증 통과 후 명시적으로 실행하며, 최대 출력 512 토큰과 단일 요청으로 제한한다. 화면 조회·새로고침·팝업 재실행으로 유료 검증을 자동 실행하지 않는다.

- `data/config/config.json`: 개인 환경 설정, revision 충돌 검사, API 키 원문 없음.
- `data/config/secrets.enc.json`: 설정 화면에서 입력한 키의 AES-256-GCM 암호문. 상태만 조회 가능.
- `data/master.key`: 암호화 마스터 키. 분실하면 암호문을 복호화할 수 없으며, 암호문과 함께 탈취되면 보호되지 않으므로 별도 안전한 백업이 필요하다.
- `data/bootstrap-token`, `data/postgres-password`: 최초 실행용 로컬 비밀 파일. 생성 시 파일 권한 0600.

개인 파일, PDF, DB, 분석 결과와 모델 파일은 Git 및 Docker build context에서 제외한다. `.env.example`은 비밀 값 없는 경로·키 변수 예시이며 실제 `.env`/`.env.local`이나 API 키를 자동 생성하지 않는다. 설정에서 키를 바꿔도 이전 세대의 작업에 새 키를 조용히 적용하지 않는다.

### 직접 발급한 API 키를 `.env`에서 등록

OpenAI 키 발급 연결이 재인증 오류로 실패하면 직접 키를 발급해 등록할 수 있다. 키 이름은 `thesis_parser_key`, 로컬 변수 이름은 `OPENAI_API_KEY`를 사용한다. 이름과 실제 비밀 값은 서로 다르다. Claude는 별도로 발급한 키를 `ANTHROPIC_API_KEY`에 저장한다. 키 원문을 채팅·터미널 명령 인자에 붙이지 않는다.

1. 저장소 루트의 **Git에서 제외된 `.env`** 파일을 로컬 편집기로 만들고 파일 권한을 `chmod 600 .env`로 제한한다. `OPENAI_API_KEY=`의 오른쪽에 실제 키를 입력한다. `.env.example`은 추적되는 공개 예시이므로 거기에 실제 값을 저장하지 않는다.
2. Configuration에서 해당 provider를 **비활성화하고 저장**한다. 처음 실행한 기본 상태는 이미 비활성화되어 있다.
3. **호스트 PC의 저장소 루트**에서 아래 명령을 실행한다. `--confirm-write`는 암호화 저장소와 설정 참조를 갱신한다는 명시적 확인이다. 먼저 `npm run setup:local`을 완료한 기본 private `data/` 레이아웃을 사용한다.

```sh
npm run credentials:import -- --from .env --provider openai --confirm-write
# Claude를 별도로 등록할 때만 실행:
npm run credentials:import -- --from .env --provider anthropic --confirm-write
```

`.env.local`을 사용했다면 `--from .env.local`로 지정한다. 동일한 키의 재등록은 no-op이고, 다른 키로 교체할 때만 명령 끝에 `--replace`를 추가한다. 추적 중인 env 파일, 공개 권한 파일, 링크 파일, 64 KiB 초과 파일은 거부한다. 목적지는 Git/Docker/Next 빌드에서 이미 제외된 기본 `data/config`와 `data/master.key`로 제한하며 소유자 전용 권한도 검사한다. Git ignore만으로 빌드 제외가 보장되지는 않으므로 다른 사용자 지정 배치는 별도 Configuration 구성을 사용한다. env 파일의 다른 변수를 프로세스에 주입하거나 셸 코드로 실행하지 않는다. 파서는 Node.js의 [공식 env 파싱 API](https://nodejs.org/api/environment_variables.html#programmatic-apis)를 사용한다.

등록 결과는 기존 `data/config/secrets.enc.json`에 암호화되어 저장되고 `config.json`에는 키 원문 없이 참조만 연결된다. 현재 Compose web/worker가 이 디렉터리를 공유하므로 **컨테이너 재빌드나 재시작 없이 Configuration을 다시 불러오면** 등록 상태를 확인할 수 있다. 키 등록은 제공자 활성화, 외부 전송, 유료 허용, 모델 선택을 대신하지 않으며 기존 설정은 유지한다. 실제 생성 요청을 하려면 사용자가 Configuration에서 해당 항목을 별도로 설정해야 한다.

이 명령은 키 발급이나 유효성 검사 요청을 하지 않으며 원본 `.env`를 자동 삭제하지 않는다. 따라서 원본은 여전히 평문이다. 등록 후 필요에 따라 키 항목을 직접 지우거나 소유자 전용 상태로 보관한다. 교체는 새 암호화 항목을 먼저 저장한 다음 설정 참조를 교체한다. 설정 저장 실패 시 이전 키·참조는 유지되지만 사용되지 않는 암호화 항목이 남을 수 있다. 이전 암호화 항목과 서버에서 발급한 이전 API 키도 자동 삭제/폐기하지 않는다.

Ollama/LM Studio는 호스트 PC에서 실행한다. **컨테이너에서의 주소는 `http://host.docker.internal:11434/v1` / `http://host.docker.internal:1234/v1`** 이다. 호스트 개발 시에는 `127.0.0.1`을 사용한다. 기존 설정은 보존되므로 실행 방식을 바꾸면 Configuration에서 주소를 확인해야 한다. 로컬 서버도 cloud model/proxy/LM Link를 사용할 수 있으므로 해당 기능이 꺼져 있는지 확인한 후 로컬 격리를 확인한다. 주소 변경 후에는 다시 확인해야 한다.

돈 단위 한도를 설정했는데 검증된 모델 가격 정보가 없으면 유료 요청을 차단한다. 비용을 임의로 추정해 한도를 지켰다고 표시하지 않는다. 2026-09-09의 OpenAI 초기 검증은 [이전 기록](docs/READER-SETUP-ACCEPTANCE.md)에 보존한다. 2026-09-10 사용자가 OpenAI·Google 연동과 테스트 완료를 알렸으며, 이후 개발은 기존 설정을 유지한다. 새 Google HTML 단어 표식 요청 1회의 실패와 UI 검증 결과는 [최신 기록](docs/TRANSLATION-PAGE-ACCEPTANCE.md)에 별도로 구분한다.

## 원문과 페이지 번역 읽기

논문 → **번역** 탭에서 현재 페이지의 저장된 번역을 제목·문단이 있는 하나의 문서로 읽는다. 항목별 카드와 반복 원문 인용을 없애고 번역 패널을 넓혔다. 이는 화면 구성 변경이며 PDF 파일 자체를 한국어 PDF로 바꾸는 기능은 아니다.

- 원문 또는 번역에 마우스를 올리면 대응하는 문장·구절을 민트색으로 표시한다. 유효한 단어 연결 정보가 있으면 해당 단어·구절을 호박색으로 구분한다.
- 저장된 기존 번역은 재호출 없이 표시한다. 예전 결과에 단어 연결 정보가 없으면 문장·구절만 연결한다. **번역 범위**를 펼쳐 필요한 항목을 선택하고 **새로 생성**하면 해당 범위의 재번역과 단어 연결을 시도한다. 새 연결이 반드시 생성되는 것은 아니다.
- 페이지 진입, 브라우저 새로고침, 호버는 생성 요청을 보내지 않는다. 요청 버튼은 현재 버전의 캐시를 사용하고, **새로 생성**은 명시적으로 새 결과를 요청한다. 이전 버전 캐시와 새 HTML 표식 버전은 생성 fingerprint로 구분한다.
- 단어 연결은 Google이 보존한 HTML 표식을 검증하는 방식이다. 언어학적으로 정확한 일대일 대응을 보장하지 않으며, 누락·중복·유효하지 않은 표식은 연결하지 않는다. **표식/공백을 포함한 HTML 문자도 사용량과 과금 대상**이므로 기존 월간 문자 한도에 포함한다. [Google 공식 번역 FAQ](https://docs.cloud.google.com/translate/faq)
- 키보드는 Tab으로 구절에 초점을 맞추고 좌우 방향키로 연결 단어를 이동한다. Escape, 마우스 이탈, 페이지·확대율·탭 변경으로 호버 강조를 해제한다. 저장된 메모 강조는 별도로 유지한다.

현재 단어 연결 UI/파서/좌표 검증은 통과했으나 새 방식의 실제 Google 요청 성공은 아직 확인하지 못했다. 기존 실제 Google 번역 캐시의 페이지 표시와 문장·구절 호버는 확인했다. OCR, 다단/수식 읽기 순서 완전 복원, 문맥 단위 일괄 번역은 후속 범위다.

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

기반 구현은 `feature/local-service-foundation`, 수동 키 등록은 `feature/manual-env-credentials`에서 수행하고 검증 후 `dev`에 통합한다. 전체 기능을 검증하기 전에는 `main` 안정 버전으로 릴리스하지 않는다.
