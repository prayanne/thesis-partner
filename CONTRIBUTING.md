# 개발 및 Git 운영 규칙

이 프로젝트는 개인 PC용 로컬 서비스이며 `main / dev / feature/* / hotfix/*` 전략으로 계획·코드·검증 기록을 관리한다. 별도 release 브랜치나 다인 승인 체계를 필수로 만들지 않는다.

## 1. 브랜치 역할

| 브랜치 | 시작점 | 역할 | 병합 대상 |
| --- | --- | --- | --- |
| `main` | 초기 저장소 | 검증된 안정 버전·릴리스 이력. 직접 기능 개발하지 않음 | 검증된 dev 또는 hotfix를 받음 |
| `dev` | main | 기능 통합·차기 버전 검증 | 릴리스 시 main |
| `feature/<topic>` | 최신 dev | 새 기능·계획·일반 버그 수정·리팩터링. 한 가지 목적 | dev |
| `hotfix/<topic>` | 최신 main | 안정 버전의 긴급 장애·보안·데이터 손상 수정 | main 반영 후 dev에도 동일 변경 병합 |

`feature`와 `hotfix`라는 단일 상설 브랜치를 만들지 않는다. 예: `feature/service-planning`, `feature/pdf-translation`, `feature/paid-ai-providers`, `hotfix/cache-generation-race`.

기본 흐름은 `dev → feature/* → dev → main`이다. hotfix는 `main → hotfix/* → main → dev`이며, main의 hotfix 반영을 dev에 병합해 다음 릴리스에서 수정이 사라지지 않게 한다.

## 2. 작업과 병합

작업 시작 시 현재 branch·변경 파일·기준 commit을 확인한다. 관련 없는 사용자 변경은 별도 보존하고 임의 stash/reset으로 정리하지 않는다. 기능은 최신 dev에서 분기하며 긴급 수정만 main에서 분기한다.

기능 브랜치에서는 의미 있는 단위로 커밋한다. dev의 새 변경은 merge로 반영한다. 공유/통합한 history에 rebase·force push를 적용하지 않는다. 개인 feature의 정리도 이미 다른 작업이 의존하면 history를 보존한다.

feature → dev는 검증 후 `--no-ff` merge를 기본으로 하여 기능 단위를 남긴다. 로컬 단독 개발은 변경 내역·검증 기록을 확인하고 로컬 merge할 수 있다. 원격 저장소를 연결하면 PR/MR을 같은 검토 기록으로 사용하되 승인 인원·보호 규칙은 실제 호스팅 환경에서 별도로 설정한다.

dev → main도 준비된 버전 전체를 검증한 뒤 merge한다. main에 생긴 merge/hotfix 이력은 dev에 되돌려 병합한다. CI가 있다는 이유로 배포·원격 push·main 릴리스를 자동 실행하지 않는다. 한 기능의 구현 완료와 안정 버전 출시를 구별한다.

현재는 원격 없이 로컬 Git으로 시작할 수 있다. 원격 연결·push·PR 발행이 요청되기 전에는 이를 실행하지 않는다. 브랜치 보호를 문서화한 것과 실제 원격에서 강제한 것은 다르다.

Orca가 관리하는 worktree의 생성·메타데이터·기본 base ref 변경은 Orca CLI를 사용한다. Git branch/commit/merge 자체는 일반 Git으로 수행하고 변경 후 Orca가 인식한 branch를 확인한다. 일반 기능의 worktree 기준 ref는 dev, hotfix 생성 시에는 main을 명시한다. 다른 worktree에서 checkout한 main/dev를 강제로 이동하거나 그 디렉터리를 임의 수정하지 않는다.

## 3. 커밋 규칙

형식은 `type(scope): 설명`으로 한다. 사용하는 type은 `feat`, `fix`, `refactor`, `docs`, `test`, `chore` 정도로 제한한다.

```text
docs(plan): define paid AI providers and configuration policy
feat(reader): link translated words to PDF anchors
fix(cache): preserve the latest segment refresh generation
chore(db): add versioned lesson snapshots
```

하나의 커밋에는 함께 검토·되돌릴 수 있는 변경을 넣는다. schema 변경은 migration과 필요한 데이터 호환 코드·검증을 함께 관리한다. 모델명·가격표 갱신도 registry 변경으로 기록하고 임의의 최신 모델로 조용히 교체하지 않는다.

stage는 파일을 명시하여 수행하고 commit 전 staged diff를 확인한다. 개인 config, API key, credential, PDF 원본, DB·vector 데이터, 분석 산출물, 모델 weight를 commit하지 않는다. 공개·재배포 가능한 작은 테스트 fixture와 placeholder만 든 설정 예시는 별도로 검토해서 포함할 수 있다.

## 4. 변경별 검증

| 변경 | 병합 전 최소 검증 |
| --- | --- |
| 계획·문서 | 내부 링크, JSON 예시 문법, 요구사항·계약 정합성, diff 공백 검사 |
| 일반 UI/API | 변경 범위 lint/typecheck/build와 의미 있는 테스트 |
| PDF·번역 | anchor/offset fixture, hover, 겹치는 refresh·cache 테스트 |
| AI provider·비용 | mock 요청/stream/usage, 허용·한도·취소·unknown outcome, capability 계약 |
| DB·작업 | migration 적용, 재시도·중단·revision 경쟁·기록 보존 검증 |
| 안정 릴리스/hotfix | 영향 시나리오 재현·회귀, compose healthcheck, 필요한 백업/복구 확인 |

실행 가능한 앱이 없는 Planning 단계에서 build/test가 통과했다고 보고하지 않는다. 테스트 범위는 변경 위험에 맞추고 단순 문서 수정 때문에 모델이나 유료 API를 호출하지 않는다. 실제 provider smoke test는 등록된 key·설정된 유료 허용·비용 범위에서 명시적으로 수행한다.

## 5. 릴리스·hotfix·복구

앱 릴리스는 검증된 main commit에 `vMAJOR.MINOR.PATCH` annotated tag를 붙이고 주요 변경·migration·검증 결과를 기록한다. Planning v0.2 같은 문서 버전은 실행 가능한 앱의 v0.2.0 릴리스를 의미하지 않는다.

hotfix는 main에서 분기해 문제를 재현하고 가장 작은 수정·회귀 검증을 수행한다. main에 merge하고 필요하면 patch version을 발행한 뒤 main의 변경을 dev에 merge한다. dev에만 hotfix를 넣거나 main에만 남겨 두지 않는다.

배포한 DB migration을 되돌려야 하면 단순 Git revert만으로 데이터까지 복구된다고 가정하지 않는다. 가능한 경우 호환 가능한 forward migration을 우선하고, 실제 데이터 복원은 검증한 백업·복구 절차로 처리한다.

완료된 feature/hotfix 삭제는 해당 변경이 필요한 대상에 병합됐는지 확인한 뒤 수행한다. 로컬 브랜치를 삭제해도 원격 브랜치를 자동 삭제하지 않는다. 이번 초기 계획 브랜치는 검토를 위해 보존한다.
