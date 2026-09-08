# Thesis Partner

개인 PC에서 논문 관리, 원문·번역 읽기, 논문 기반 AI 대화, CS 커리큘럼, 실습 기록과 Wiki를 연결하는 로컬 서비스.

현재 단계는 **Planning v0.2**이다. 실행 가능한 앱·컨테이너는 아직 없으며, 아래 문서는 구현을 위한 설계 결정과 검증 기준이다.

- [제품·아키텍처·개발 계획](docs/PLAN.md)
- [데이터 모델·캐시·REST API·MCP 계약](docs/DATA-API.md)
- [초기 CS 커리큘럼·Wiki·실습 설계](docs/CURRICULUM.md)
- [Git 브랜치·커밋·검증·릴리스 규칙](CONTRIBUTING.md)

기본 구성: React UI + Next.js API, PostgreSQL, 별도 Qdrant, background worker. OrbStack 위에서 Docker Compose로 구동하고 원본 PDF는 호스트 디렉터리를 마운트한다. Ollama·LM Studio는 PC에서 실행 중인 서비스를 연결한다.

유료 AI의 첫 지원 대상은 OpenAI API(ChatGPT 계열 모델)와 Anthropic Claude API다. Configuration에서 유료 AI와 무료/로컬 AI를 구분하고 사용 허용·모델·사용량·예상 비용 한도를 저장한다. Google Cloud Translation은 기존 번역 기능의 별도 과금 항목이다. provider adapter와 capability registry를 통해 이후 제공자를 추가한다.

개발 브랜치는 `main`, `dev`, `feature/*`, `hotfix/*`를 사용한다. 일반 개발은 `dev → feature/* → dev`, 안정 버전은 `dev → main`, 긴급 수정은 `main → hotfix/* → main + dev` 흐름으로 관리한다.

이 계획의 첫 구현 작업은 `docs/PLAN.md`의 P0 기술 검증이다. Google 번역은 공식 Cloud Translation Basic API를 전제로 하며, 유료 API 실행·키 입력·모델 설치는 이번 Planning에서 수행하지 않았다.
