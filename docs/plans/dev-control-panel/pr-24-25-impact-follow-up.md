# PR-24~25 후속 영향 점검 및 사용자 흐름 계획

> 상태: 미착수 · 선행: PR-21~23 완료 · 대상: PR-24(정책 런타임 오버라이드), PR-25(Web 개발자 패널)

## 목표
PR-21~23이 추가한 슈퍼어드민 게이트, 런타임 config 저장소, 프롬프트/인자 주입 seam이 실제 사용자 화면과 작업 흐름에서 어디에 영향을 주는지 정확히 확인하고, PR-24~25에서 체크·추가·변경해야 할 대상을 파일 단위로 고정한다.

이 문서는 새 기능 자체가 아니라 **남은 구현 전 점검 체크리스트**다. PR-24/25 구현 시 이 목록을 Definition of Done의 일부로 사용한다.

## 현재 영향 범위 요약
- 현재 사용자에게 직접 보이는 변화는 `사용자 관리` 화면의 `isSuperAdmin` 부여/회수 체크박스뿐이다.
- `/api/admin/*` 게이트와 `/api/admin/config` API는 준비됐지만, 이를 조작하는 Web 개발자 패널은 아직 없다.
- 프롬프트·인자·모델 오버라이드는 새 main/curation/learner job 시작 시 반영된다. 실행 중 job에는 반영되지 않는다.
- 정책 오버라이드는 아직 worker/API에 완성 배선되지 않았다. PR-24에서 처리한다.

## 반드시 체크할 대상

### 접근/권한
- `packages/shared/src/index.ts`
  - `canAccessDevPanel(user)`가 role rank와 독립적으로 `isSuperAdmin === true`만 보는지 확인.
  - `UserSchema`, `CreateUserBodySchema`, `UpdateUserRoleBodySchema`에 `isSuperAdmin` 필드가 유지되는지 확인.
- `apps/api/src/server.ts`
  - `/api/admin/*` prefix guard가 신규 admin route 전체에 적용되는지 확인.
  - `/api/admin/health`, `/api/admin/config`, PR-24의 policy route가 동일 guard 아래에 있는지 확인.
  - `isSuperAdmin` 부여/회수는 OWNER만 가능한 상태를 유지한다.
- `apps/web/src/components/users/UsersPage.tsx`
  - OWNER만 `isSuperAdmin` 체크박스를 조작할 수 있는지 확인.
  - OWNER가 아닌 사용자에게는 체크박스가 disabled 또는 hidden 상태인지 확인.

### 런타임 config 계약
- `packages/shared/src/index.ts`
  - `RuntimeConfigSchema`, `RuntimeConfigPatchSchema`, `RuntimeConfigResponseSchema`가 UI가 필요한 필드를 모두 포함하는지 확인.
  - `defaults`, `overrides`, `effective` 응답 구조가 PR-25 UI에서 그대로 소비 가능한지 확인.
  - `null` patch가 "기본값 복원"으로 동작하는지 유지한다.
- `packages/db/src/repositories.ts`
  - `app_config` 문서 저장/조회가 prompts, agentParams, models, policy를 모두 보존하는지 확인.
  - API key나 secret이 runtime config에 들어가지 않는지 확인.
- `apps/api/src/server.ts`
  - `GET /api/admin/config`가 `defaults`, `overrides`, `effective`를 모두 반환하는지 확인.
  - `PATCH /api/admin/config`가 부분 patch와 null 복원을 모두 허용하는지 확인.

### 작업 반영 시점
- `workers/main/src/index.ts`
  - ingest/preview/commit preview job 시작 시 `loadRuntimeConfig(db)`를 1회 호출하는지 확인.
  - agent model, embedding model, prompts, agentParams가 신규 job에만 반영되는지 확인.
- `workers/curation/src/index.ts`
  - curate job 시작 시 runtime prompt/model을 로드하는지 확인.
  - curation `agent_step_limit`은 policy fallback을 보존하고, runtime override가 있을 때만 덮는지 확인.
- `workers/learner/src/index.ts`
  - learner job 시작 시 runtime prompt/model을 로드하는지 확인.
- `packages/agent-tools/src/index.ts`, `discovery.ts`, `learner.ts`
  - 6개 prompt key가 override 없을 때 기존 상수로 fallback하는지 확인.
  - `vectorK`, `hybridK`, `graphMaxDepth`, `sandboxTimeoutMs` 기본값이 기존 동작을 깨지 않는지 확인.

## PR-24에서 추가/변경할 대상

### 정책 API 및 effective policy
- `packages/wkf/src/policy.ts`
  - `loadEffectivePolicy(override?, bundlePath)`를 추가한다.
  - override가 있으면 파일 policy 위에 merge하고, 없으면 기존 `loadPolicy(bundlePath)` 동작을 보존한다.
  - `review.approver_roles`는 실제 `userRoles`와 대조해 존재하지 않는 role을 검증 오류로 처리한다.
- `knowledge/policy.yaml`
  - 현재 live enum에 없는 role 값이 있으면 `OWNER`, `APPROVER`, `REVIEWER` 등 실제 enum 기준으로 정리한다.
- `apps/api/src/server.ts`
  - admin gate 하위에 정책 조회/수정 route를 추가한다. 권장 경로는 `/api/admin/policy`.
  - 문서 approve 경로가 file policy가 아니라 effective policy를 사용하도록 바꾼다.
- `workers/curation/src/index.ts`
  - curation job의 policy 로딩을 effective policy로 바꾼다.
  - scan 정책은 기존 계획대로 유지할지, effective policy를 사용할지 구현 시 명시적으로 결정하고 테스트한다.

### PR-24 검증
- 비슈퍼어드민은 `/api/admin/policy` 403.
- 슈퍼어드민은 policy 조회/수정 가능.
- invalid role이 포함된 policy는 400 또는 검증 오류.
- override null 또는 삭제 시 파일/default policy로 복원.
- approve와 curation job이 effective policy를 사용한다.

## PR-25에서 추가/변경할 대상

### Web API client/hooks
- `apps/web/src/api/client.ts`
  - `fetchRuntimeConfig()`, `updateRuntimeConfig(patch)` 추가.
  - PR-24 이후 `fetchPolicy()`, `updatePolicy(body)` 또는 config policy 통합 API 함수를 추가.
  - admin API 실패 시 `ApiError(403)`가 UI에서 명확히 처리될 수 있게 기존 request 패턴을 재사용한다.
- `apps/web/src/api/hooks.ts`
  - `queryKeys.runtimeConfig`, `useRuntimeConfig`, `useUpdateRuntimeConfig` 추가.
  - PR-24 이후 `queryKeys.policy`, `usePolicy`, `useUpdatePolicy` 추가.
  - 업데이트 성공 시 runtime config/policy query를 invalidate한다.

### 라우팅/진입점
- `apps/web/src/store.ts`
  - `ActivePage`에 개발자 패널 페이지 값을 추가한다. 권장값: `dev-panel`.
- `apps/web/src/App.tsx`
  - `activePage === 'dev-panel'`일 때 `DevPanel`을 렌더링한다.
  - 비슈퍼어드민이 직접 상태를 조작해 접근해도 패널 내부에서 차단 화면을 보여준다.
- `apps/web/src/components/lnb/Lnb.tsx`
  - gear menu에 `개발자 설정` 항목을 추가한다.
  - 노출 조건은 `canAccessDevPanel(user)`이다. `canManageOwners(user.role)`를 쓰지 않는다.
  - 기존 `에이전트 미리보기` OWNER 게이트와 섞지 않는다.

### DevPanel UI
- 신규 파일: `apps/web/src/components/admin/DevPanel.tsx`
- 탭 구성:
  - `프롬프트`: `main`, `curation`, `merge`, `discoveryDecompose`, `discoverySystem`, `learnerJudge`
  - `인자`: `mainStepLimit`, `discoveryStepLimit`, `curationStepLimit`, `vectorK`, `hybridK`, `graphMaxDepth`, `sandboxTimeoutMs`
  - `모델`: `agentModel`, `embeddingModel`
  - `정책`: PR-24 policy API 또는 config policy 섹션
- 각 필드는 `effective`, `defaults`, `overrides`를 함께 표시한다.
- override가 있는 필드는 시각적으로 구분한다.
- "기본값 복원"은 해당 key를 `null`로 PATCH하거나 override에서 제거하는 방식으로 구현한다.
- API key 입력은 만들지 않는다. 모델명만 편집한다.
- 저장 후 toast와 query invalidation을 제공한다.

### 사용자 안내 문구
- 패널 상단 또는 각 탭 공통 위치에 다음 의미를 명확히 표시한다.
  - 변경은 신규 job부터 적용된다.
  - 실행 중인 job에는 영향을 주지 않는다.
  - API key/secret은 환경변수로만 관리한다.
  - 기본값 복원은 저장된 override 제거를 의미한다.

### PR-25 검증
- 슈퍼어드민:
  - gear menu에서 `개발자 설정`이 보인다.
  - `/api/admin/config`를 조회하고 prompts/agentParams/models를 수정할 수 있다.
  - 수정 후 신규 agent-preview 또는 ingest job에서 반영된다.
  - 기본값 복원 후 built-in/env default가 다시 보인다.
- 비슈퍼어드민:
  - gear menu에 `개발자 설정`이 보이지 않는다.
  - 직접 `dev-panel` 상태로 접근해도 차단 화면 또는 403 안내가 보인다.
  - `/api/admin/*` 직접 호출은 403이다.
- OWNER가 아닌 사용자:
  - 사용자 관리에서 `isSuperAdmin`을 부여/회수할 수 없다.
- 회귀:
  - 기존 사용자 관리, 에이전트 미리보기, 검토 승인 토글, 문서 ingest 흐름이 유지된다.

## 문서/마무리 체크
- PR-24 완료 후 `pr-24-policy-runtime-override.md`, `README.md`, `docs/plans/README.md` 상태를 업데이트한다.
- PR-25 완료 후 `pr-25-web-dev-panel.md` 상태를 업데이트한다.
- PR-25 후 전체 dev-control-panel 계획이 끝나면 `docs/plans/dev-control-panel.md`와 `docs/plans/dev-control-panel/`을 archive로 이동하고 `docs/plans/README.md`에서 제거한다.
- `AGENTS.md` 권한 원칙에 `isSuperAdmin`은 role rank와 독립인 개발자 제어판 접근 플래그라는 문장을 반영한다.
