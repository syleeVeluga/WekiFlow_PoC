# 계획 — 개발자/슈퍼어드민 제어판 (Runtime Control Panel)

> 상태: **계획 확정, 미착수.** PR-19(외부 enrichment)·PR-20(WKF MCP·커넥터)은 이미 구현 완료(`b460a03`, `2ea303a`). 이 문서만 남은 작업.

## Context (왜)

WKF 운영에 필요한 **에이전트 프롬프트·인자/한도·모델·정책**이 전부 하드코딩 상수 / 부팅 시 env / YAML 파일이라, 조정하려면 재배포가 필요하다. 개발자·운영자가 **런타임에 안전하게 조정**할 수 있는 슈퍼어드민 전용 제어판을 추가한다. WKF 도입 후 권한 체계가 바뀔 수 있으므로 접근 통제는 역할 사다리와 **분리(직교)** 한다.

확정 결정:
- 접근: **직교 플래그 `isSuperAdmin`** (역할 랭크와 분리).
- 편집 대상: **프롬프트 · 인자/한도 · 모델 · policy.yaml** 전부.

## 현재 상태 (근거)

- **권한**: `OWNER(5)>APPROVER(4)>REVIEWER(3)>EDITOR(2)>VIEWER(1)` + 가드 `canEdit/canReview/canApprove/canManageUsers/canManageOwners` — [packages/shared/src/index.ts:14,377-410](../../packages/shared/src/index.ts). API 패턴: `me=currentUser(req); if(!me||!canX(me.role)) 403` — [apps/api/src/server.ts:145-158](../../apps/api/src/server.ts).
- **설정 인프라(재사용)**: `AppSettingsSchema`(현재 `reviewApprovalEnabled` 1개), `GET/PATCH /api/settings`(APPROVER+), in-memory+mongo store, `useSettings/useUpdateSettings`. 전용 설정 페이지는 없고 LNB 톱니 메뉴 인라인 — [apps/web/src/components/lnb/Lnb.tsx:142-171](../../apps/web/src/components/lnb/Lnb.tsx).
- **프롬프트(하드코딩 상수)**: `MAIN_AGENT_SYSTEM_PROMPT`·`CURATION_SYSTEM_PROMPT`·`MERGE_SYSTEM_PROMPT` — [packages/agent-tools/src/index.ts:83-112](../../packages/agent-tools/src/index.ts); `DISCOVERY_DECOMPOSE_PROMPT`·`DISCOVERY_SYSTEM_PROMPT` — [packages/agent-tools/src/discovery.ts:20-29](../../packages/agent-tools/src/discovery.ts); `LEARNER_JUDGE_PROMPT` — [packages/agent-tools/src/learner.ts:36-45](../../packages/agent-tools/src/learner.ts).
- **모델/인자**: env `EnvSchema` — [packages/shared/src/index.ts:327-365](../../packages/shared/src/index.ts) 부팅 1회. 루프 한도 하드코딩: main stepLimit 12([workers/main/src/pipeline.ts:94](../../workers/main/src/pipeline.ts)), discovery 8([discovery.ts:89]), search k 기본 8, hybrid k 8, graph maxDepth 2, sandbox timeout 10s.
- **정책**: `knowledge/policy.yaml` → `loadPolicy(bundlePath)` — [packages/wkf/src/policy.ts:86-93](../../packages/wkf/src/policy.ts) 시작 1회 로드, `defaultPolicy` fallback. PolicySchema에 `sources.allowed_hosts`·`enrichment.web_max_pages`·`freshness`·`review.approver_roles` 존재.
- **⚠️ role 불일치**: policy.yaml `review.approver_roles: [ADMIN, REVIEWER]`인데 실제 enum엔 **ADMIN 없음**(OWNER/APPROVER/...). 이 작업에서 정합.
- **유일 런타임 편집 가능 항목**: app-settings(`reviewApprovalEnabled`). 나머지는 전부 재배포 필요.

## 구현

### A. 직교 슈퍼어드민 플래그
- `packages/shared/src/index.ts`: User 스키마에 `isSuperAdmin?: boolean`(기본 false). 가드 `canAccessDevPanel(user: { isSuperAdmin?: boolean }): boolean => user.isSuperAdmin === true` — **role 아님, 랭크 사다리 불변**.
- `apps/api/src/server.ts`: 신규 `/api/admin/*` 라우트를 `currentUser` + `me.isSuperAdmin` 게이트(403). `CreateUserBodySchema`/사용자 수정에 `isSuperAdmin` 반영하되 **부여는 OWNER만**(`canManageOwners`) — agent-preview OWNER 게이트와 동형.
- `apps/web`: `useAuthStore` user의 `isSuperAdmin`로 패널 라우트 + LNB 메뉴 게이팅(에이전트 미리보기 게이팅 패턴 그대로).

### B. 런타임 config 저장소 (토대)
- `packages/shared`: `RuntimeConfigSchema`
  - `prompts: Partial<Record<PromptKey, string>>` — `PromptKey = 'main'|'curation'|'merge'|'discoveryDecompose'|'discoverySystem'|'learnerJudge'`. 키 없음/null = 빌트인 기본 사용.
  - `agentParams: { mainStepLimit?, discoveryStepLimit?, curationStepLimit?, vectorK?, hybridK?, graphMaxDepth?, sandboxTimeoutMs? }` — 전부 optional → 현 하드코딩 기본 fallback. zod로 현재 스키마 범위(예: vectorK 1–50, maxDepth 1–3) 검증.
  - `models: { agentModel?, embeddingModel?, tripletGoogleModel?, tripletAnthropicModel?, tripletOpenAiFallbackModel? }` — env 위 오버라이드(API 키는 제외).
  - `policy: Policy | null` — policy.yaml 오버라이드(null=파일).
- `packages/db`: repo `runtimeConfig.get()/update(patch)` — Mongo 단일 문서(예: `app_config` 컬렉션 `_id:'runtime'`). `apps/api` InMemory store에도 동일 미러(테스트용).
- `loadRuntimeConfig(db)` 헬퍼: DB 오버라이드를 **빌트인 기본 + env 위에 머지**해 effective config 반환. 빌트인 기본(프롬프트 상수, stepLimit 12/8, k 8 등)을 한 곳에 모아 단일 출처화.
- API: `GET /api/admin/config`(effective + 각 항목의 기본값을 함께 반환해 UI가 "기본 vs 오버라이드" 표시), `PATCH /api/admin/config`(부분 patch, zod 검증 후 저장).
- **로딩 규율**: 워커는 **잡마다** config 로드(큐레이션은 이미 scan마다 policy 로드, main은 잡 시작 시). 모델 변경은 신규 잡부터 적용됨을 UI·문서에 명시. 실행 중 잡은 변경하지 않음.

### C. 프롬프트 주입 seam (프롬프트 편집 enabler)
- `packages/agent-tools/src/{index,discovery,learner}.ts`: 상수는 **기본값으로 유지**, 각 팩토리/빌더가 컨텍스트의 prompt 오버라이드를 받아 `const sys = ctx.prompts?.main ?? MAIN_AGENT_SYSTEM_PROMPT` 형태로 사용(동작 불변, seam만 추가).
- `workers/{main,curation,learner}` + discovery 호출부: `loadRuntimeConfig()`의 prompts·agentParams를 ctx로 주입. 기존 `ctx.stepLimit` 등 이미 컨텍스트 주입 가능한 항목은 그대로 활용.

### D. 정책 런타임 오버라이드 (PR-19와 직결)
- `packages/wkf/src/policy.ts`: 호출자가 `Policy` 오버라이드를 전달하거나 `loadEffectivePolicy(override, bundlePath)`(override 우선, 없으면 파일/`defaultPolicy`)로 해소. 큐레이션 워커 + `POST /api/documents/:id/approve`의 정책 사용처가 effective policy를 쓰도록 배선 → **패널에서 `allowed_hosts` 편집 = PR-19 fetch allowlist 즉시 반영.**
- **role 정합**: `review.approver_roles` 기본을 실제 enum(`[OWNER, APPROVER]`)으로 정정. PolicySchema에서 role 값을 `userRoles`와 대조 검증(WKF 후 role 개편 시 silent drift 대신 검증 오류로 노출). policy.yaml의 `ADMIN`도 정정.
- API: `GET /api/admin/policy`, `PUT /api/admin/policy`(zod 검증). (config의 `policy` 섹션과 통합해도 무방 — 구현 시 택1.)

### E. Web UI — 설정 → 개발자 패널
- `apps/web/src/components/admin/DevPanel.tsx`: 탭 4개.
  - **프롬프트**: 키별 Monaco 에디터(스택에 Monaco 존재) + 「기본값 복원」(오버라이드 제거). placeholder로 빌트인 기본 노출.
  - **인자**: 숫자 폼, 비우면 기본값(placeholder) 사용.
  - **모델**: 텍스트 입력, env 기본값 placeholder.
  - **정책**: `allowed_hosts` 리스트(추가/삭제), `web_max_pages`, `freshness`, `approver_roles`(실제 role 멀티셀렉트).
- `apps/web/src/api/hooks.ts`: `useRuntimeConfig`/`useUpdateRuntimeConfig`/`usePolicy`/`useUpdatePolicy`(기존 `useSettings` 패턴).
- `apps/web/src/components/lnb/Lnb.tsx`: 톱니 메뉴에 「개발자 설정」 항목, `me.isSuperAdmin` 게이팅(미리보기 항목과 동형).

## 유연한 권한 메모 (cross-cutting)
- `isSuperAdmin`는 role과 직교 → 향후 WKF 주도 role 재설계(capability·워크스페이스 멤버십, [workspace-authorization.md](./workspace-authorization.md)의 보류 작업)와 충돌 없음.
- policy role 값을 live enum과 대조 검증 → role 변경이 조용히 깨지지 않음.
- 이 원칙 1~2줄을 `AGENTS.md` 권한 절에 반영.

## 검증
- 게이트: `pnpm -r build` → `pnpm -r typecheck` → `pnpm -r test` (타입은 빌드 dist로 해소 — typecheck 전 build 필수).
- 단위: runtimeConfig get/update 라운드트립, effective 머지(오버라이드 없을 때 빌트인 기본 반환), zod 경계값, policy role 검증 실패 케이스, 프롬프트 seam(오버라이드 시 주입·없으면 상수).
- 수동 E2E: 슈퍼어드민 로그인 → 개발자 패널 → 프롬프트/인자/모델/정책 각 1건 편집 → 신규 잡(agent-preview 또는 ingest)에서 반영 확인 → 「기본값 복원」 후 빌트인 사용 확인 → 비슈퍼어드민은 메뉴 숨김 + `/api/admin/*` 403.

## 진행·병합 규약
- 독립 브랜치(`veluga/dev-control-panel`)에서 green CI 후 main 병합. 완료 시 이 문서를 `docs/archive/`로 이동하고 [plans/README.md](./README.md) 정리.

## 범위 밖
- 워크스페이스 멤버십/레지스트리 구현(별도 보류 plan).
- 프롬프트 버전 관리·A/B·감사 히스토리(이번엔 단일 오버라이드 + 기본 복원만).
- 정책 hot-reload(잡 단위 로드로 충분).
- env API 키의 UI 편집(보안상 제외, 모델명만).
