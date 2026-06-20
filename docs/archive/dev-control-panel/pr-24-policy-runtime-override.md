# PR-24 — 정책 런타임 오버라이드 + role 정합

> 원본 계획 §D. PR-19(외부 enrichment, 구현 완료)과 **직결**. 패널에서 `allowed_hosts` 편집 = fetch allowlist 즉시 반영.
> 상태: 완료(PR #37에 포함) · 선행: PR-22(config 저장소) · 후행: PR-25(UI 편집, 완료)

## 목표
`policy.yaml` 시작 1회 로드 구조를 깨지 않으면서, 런타임 `Policy` 오버라이드를 우선 적용하는 `loadEffectivePolicy`를 도입한다. 동시에 enum 불일치(`ADMIN`) 버그를 정합하고 role 검증을 추가한다.

## 범위
- `loadEffectivePolicy(override, bundlePath)` 해소 함수.
- 큐레이션 워커 + `POST /api/documents/:id/approve` 정책 사용처를 effective policy로 배선.
- role 정합: `review.approver_roles` 기본 정정 + live enum 대조 검증 + `policy.yaml` 수정.
- API: `GET /api/admin/policy`, `PUT /api/admin/policy` (또는 PR-22 config의 `policy` 섹션과 통합 — 구현 시 택1).

## 변경 파일
- `packages/wkf/src/policy.ts` — `loadEffectivePolicy(override?, bundlePath)`(override 우선 → 파일 → `defaultPolicy`). PolicySchema에 role 값 `userRoles` 대조 검증 추가(WKF 후 개편 시 silent drift 대신 검증 오류).
- `knowledge/policy.yaml` — `review.approver_roles`의 `ADMIN` → 실제 enum(`[OWNER, APPROVER]`)로 정정.
- 큐레이션 워커 — 정책 로드 지점을 `loadEffectivePolicy`로 교체(config의 `policy` 주입).
- `apps/api/src/server.ts` — `POST /api/documents/:id/approve`가 effective policy 사용. `GET/PUT /api/admin/policy`(PR-21 게이트 하위, zod 검증).

## ⚠️ 핵심 정합 포인트
- 현재 `policy.yaml`: `review.approver_roles: [ADMIN, REVIEWER]` — 실제 enum엔 **ADMIN 없음**(`OWNER/APPROVER/REVIEWER/EDITOR/VIEWER`). 기본을 `[OWNER, APPROVER]`로 정정.
- PolicySchema 검증에서 role 문자열을 live `userRoles`와 대조 → 미존재 role은 검증 오류로 노출.

## 작업 순서
1. `loadEffectivePolicy` 구현(override 우선, 없으면 기존 `loadPolicy(bundlePath)`/`defaultPolicy`).
2. PolicySchema에 role 대조 검증 추가, 실패 케이스 테스트.
3. `policy.yaml` 및 `defaultPolicy`의 approver_roles 정정.
4. 큐레이션 + approve 엔드포인트 배선 → effective policy 사용.
5. admin policy API(또는 config policy 섹션 통합) + 게이트.

## 검증
- `pnpm -r build` → `pnpm -r typecheck` → `pnpm -r test`.
- 단위: override 우선·fallback 해소; role 검증 실패 케이스(존재하지 않는 role 거부); approver_roles 정정 반영.
- 통합(PR-19 연계): config로 `allowed_hosts` 편집 → enrichment fetch가 신규 잡에서 새 allowlist 적용; `web_max_pages`·`freshness` 반영.
- 수동: 패널(임시 API 호출)로 정책 1건 편집 → 큐레이션/approve에서 effective 반영, null 복원 시 파일 사용.

## 완료 기준
- 정책이 런타임 오버라이드 가능하고 PR-19 enrichment에 즉시 반영.
- role 불일치 버그 해소 + 향후 개편 시 검증으로 드러남.

## 범위 밖
- UI(PR-25). 정책 hot-reload(잡 단위 로드로 충분).
