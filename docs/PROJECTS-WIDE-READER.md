# 넓은 논문 뷰어와 연구 프로젝트 작업 공간

기록일: 2026-09-23, Asia/Seoul. 이 문서는 논문 읽기 화면의 시인성 개선과 프로젝트 단위 자료 취합·정리 기능의 구현 경계를 기록한다.

## 넓은 논문 뷰어

- 데스크톱 기본 레이아웃에서 PDF와 작업 패널 비율을 기존 약 56:44에서 약 70:30으로 바꿨다. 1500px 이상 화면에서는 PDF가 약 72%를 사용한다.
- **작업 패널 접기**를 누르면 번역·요약·질문·메모 패널을 숨기고 PDF가 읽기 영역 전체 폭을 사용한다. 다시 펼치면 현재 페이지와 확대 비율을 유지한다.
- 확대된 PDF가 가로로 넘칠 때 페이지 맨 아래까지 내려가지 않아도 조작할 수 있도록 PDF 바로 위에 동기화된 가로 스크롤 영역을 추가했다. 위·아래 가로 스크롤 위치는 항상 같다.
- 한 페이지 안에서는 기존처럼 세로로 스크롤한다. 페이지 맨 아래에서 아래 방향 휠을 계속 움직이면 다음 페이지의 위로 이동하고, 페이지 맨 위에서 위 방향 휠을 움직이면 이전 페이지의 아래로 이동한다. 첫 페이지 이전이나 마지막 페이지 다음으로는 이동하지 않는다.
- 페이지 전환 뒤 PDF canvas, selectable text layer, 저장된 annotation, 번역 hover overlay는 해당 페이지의 revision·extraction·텍스트 hash를 다시 검증한다. 스크롤 이동이 AI 생성 요청을 발생시키지는 않는다.
- 모바일에서는 PDF 영역과 작업 패널을 기존처럼 위아래로 배치한다. 데스크톱용 패널 접기와 상단 스크롤은 키보드 및 접근성 이름을 가진 실제 버튼/region으로 제공한다.

## 프로젝트 데이터 구조

프로젝트는 논문 태그가 아니라 연구 목적을 담는 독립 레코드다.

| 레코드 | 주요 필드 | 역할 |
| --- | --- | --- |
| `research_projects` | 제목, 도메인, 목표·질문, 통합 요약 Markdown, 상태, revision, 보관 시각 | 한 연구 도메인의 작업 경계와 최종 정리 |
| `project_materials` | 프로젝트, 종류, 제목, 연결 대상, 내용, 프로젝트 메모, 순서, revision, 보관 시각 | 프로젝트에서 검토하는 개별 근거·자료 |

자료 종류는 다음 네 가지다.

- `paper`: 라이브러리의 논문을 ID로 참조한다. 제목·초록·태그와 논문 뷰어 링크를 보여준다.
- `wiki`: 현재 Wiki 문서를 ID로 참조하고 저장된 Markdown과 문서 링크를 보여준다.
- `link`: 출처 URL, 발췌·설명 Markdown, 프로젝트 메모를 저장한다.
- `note`: 사용자가 직접 작성한 Markdown과 프로젝트 메모를 저장한다.

논문과 Wiki 원본은 프로젝트 자료로 복제하거나 이동하지 않는다. 프로젝트 또는 자료를 보관해도 원본은 변경·삭제되지 않는다. 같은 활성 프로젝트 안에 같은 논문/Wiki를 중복 연결하지 않도록 DB unique index가 보호한다. 프로젝트·자료 수정은 `expectedRevision`을 검사해 오래된 화면의 덮어쓰기를 거부한다.

## 프로젝트 화면

- 왼쪽 목록에서 도메인, 논문 수, 전체 자료 수를 확인하고 프로젝트를 전환한다.
- 프로젝트 설정에서 제목·도메인·목표·상태를 관리한다.
- Evidence Board에서 논문, Wiki, 링크, 직접 메모를 추가하고 각 자료가 현재 프로젝트에서 갖는 근거·반례·후속 질문을 별도 메모로 남긴다.
- 통합 요약은 Markdown 문서로 직접 작성한다. 현재 구현은 화면 진입이나 저장만으로 외부 AI를 호출하지 않는다. 자동 프로젝트 요약 생성과 여러 논문을 한 번에 공급자에게 전송하는 기능은 이번 범위에 포함하지 않았다.
- 프로젝트와 개별 자료는 보관·복구할 수 있다. 기본 목록은 활성 레코드만 표시하며 **보관된 프로젝트·자료 포함**을 선택해야 보관 항목이 나타난다.

## API와 권한

- `GET/POST /api/v1/projects`
- `GET/PATCH/DELETE /api/v1/projects/:id`
- `POST /api/v1/projects/:id/restore`
- `POST /api/v1/projects/:id/materials`
- `PATCH/DELETE /api/v1/project-materials/:id`
- `POST /api/v1/project-materials/:id/restore`

프로젝트 읽기/쓰기는 기존 `library:read`/`library:write` 범위를 사용한다. 로컬 세션은 기존과 같이 전체 작업 공간 권한을 가진다.

## 검증 경계

- PGlite 기반 전체 Vitest에서 마이그레이션, 네 종류 자료 연결, stale revision 거부, 통합 요약 저장, 자료 보관을 검증한다.
- 실제 PostgreSQL에 `0005_research_projects.sql`을 적용하고 실제 API/UI를 통해 프로젝트 생성, 공개 fixture 논문 연결, 직접 메모 추가, 통합 요약 저장, 프로젝트 보관을 검증한다.
- Chromium과 WebKit에서 실제 PDF canvas/text layer 렌더링, 상단 가로 스크롤, 패널 접기 폭 증가, 페이지 경계 휠 이동, 기존 선택·highlight·재열기·실패 재시도를 검증한다.
- 프로젝트 UI 시험은 번역·요약·질문 POST가 한 번도 발생하지 않는지 감시한다. 사용자 개인 논문이나 외부 URL을 새로 전송하지 않는다.

최종 실행 결과는 Vitest 330개 통과와 native 1개 의도적 skip, 실제 PostgreSQL native 1개 통과, production Chromium 21개, WebKit 7개 통과다. TypeScript, Prettier, Next production build, Docker build와 1,710개 build text asset의 private runtime 경계 검사도 통과했다. 데스크톱 패널 접기 뒤 PDF 열은 열린 상태보다 25% 이상 넓어지고, Chromium·WebKit 모두 1440px 프로젝트 화면과 390px 반응형 화면에서 문서 전체의 수평 overflow가 없음을 수치로 검사했다.

로컬 검증 이미지는 Git에서 제외된 `test-results/projects/workspace-chromium.png`, `workspace-webkit.png`, `test-results/pdf-browser/chromium-wide.png`, `webkit-wide.png`에 남긴다.
