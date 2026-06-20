# PR-21 — 직교 슈퍼어드민 플래그 (`isSuperAdmin`)

> 원본 계획 §A. 제어판 전체의 **접근 통제 토대**. 이후 PR-22~25가 이 게이트 위에 올라간다.
> 상태: 완료 · 구현 PR: #31 · 선행: 없음 (첫 PR) · 후행: PR-22, PR-25

## 목표
역할 랭크 사다리(`OWNER>APPROVER>...`)와 **직교**하는 `isSuperAdmin` 플래그를 도입해, 향후 WKF 권한 개편과 충돌 없이 개발자 제어판 접근을 통제한다. 이 PR은 게이트만 만든다 — 제어판 기능(config/prompt/policy/UI)은 후속 PR.

## 범위
- User 스키마에 `isSuperAdmin?: boolean` 추가 + 가드 함수.
- `/api/admin/*` 라우트 게이트 골격(403) + 사용자 생성/수정 시 플래그 반영(부여는 OWNER만).
- 웹: 라우트·LNB 메뉴 게이팅 훅(메뉴 항목 자체는 PR-25에서 채움 — 여기선 게이팅 기반만).

## 변경 파일
- `packages/shared/src/index.ts` — User 스키마 `isSuperAdmin?: boolean`(기본 false); `canAccessDevPanel(user: { isSuperAdmin?: boolean }): boolean => user.isSuperAdmin === true`.
- `apps/api/src/server.ts` — `/api/admin/*` prefix 가드 미들웨어/헬퍼(`currentUser` + `me.isSuperAdmin` 아니면 403). `CreateUserBodySchema` 및 사용자 수정 바디에 `isSuperAdmin` 추가, **부여/회수는 `canManageOwners(me.role)`(OWNER) 게이트** — agent-preview OWNER 게이트와 동형.
- `apps/web/src/stores/authStore`(또는 `useAuthStore`) — user에 `isSuperAdmin` 노출.
- `apps/web` 라우팅/LNB 게이팅 유틸 — `me.isSuperAdmin` 기준(에이전트 미리보기 게이팅 패턴 재사용).

## 작업 순서
1. `packages/shared`: User 스키마 필드 + `canAccessDevPanel` 가드 추가, 빌드.
2. `apps/api`: `/api/admin/health`(또는 noop) 더미 라우트 1개로 게이트 동작 확인. 사용자 생성/수정 경로에 `isSuperAdmin` 반영 + OWNER 부여 게이트.
3. InMemory + Mongo 사용자 store가 `isSuperAdmin`를 저장/반환하는지 확인(직렬화 포함).
4. `apps/web`: authStore에 필드 반영, 게이팅 유틸 추가(메뉴 노출은 PR-25).
5. 시드/기존 사용자 마이그레이션: 누락 시 false로 취급(스키마 optional이므로 무변경 안전).

## 검증
- `pnpm -r build` → `pnpm -r typecheck` → `pnpm -r test`.
- 단위: `canAccessDevPanel` true/false/undefined; 비OWNER가 `isSuperAdmin` 부여 시 거부; 슈퍼어드민 아닌 사용자 `/api/admin/*` 403; 슈퍼어드민 통과.
- 수동: 슈퍼어드민 유저로 더미 admin 라우트 200, 일반 유저 403.

## 완료 기준
- [x] `isSuperAdmin`가 role과 완전 분리되어 동작, 랭크 가드 로직 불변.
- [x] `/api/admin/*` 게이트가 모든 후속 라우트의 단일 진입 가드로 재사용 가능.

## 완료 기록
- 병합: PR #31 (`Add superadmin gate for dev control panel`)
- 검증: `corepack pnpm verify:testing`

## 범위 밖
- 제어판 실제 기능(config/prompt/policy/UI) — PR-22~25.
- 워크스페이스 멤버십/role 재설계 — 별도 보류 plan.
