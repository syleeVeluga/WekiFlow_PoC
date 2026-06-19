# PR-09 — `policy.yaml` 스키마 + 로더 + 커밋/API 게이트

> Phase 6 · 선행: PR-03 · 근거: [`04` §5](../04-wekiflow-knowledge-spec.md), [`03` §3](../03-proposal.md)

## 목표
거버넌스 정책을 선언적 `policy.yaml`로 정의·로드하고, 커밋/API 경로에서 강제하는 정책 엔진을 만든다. "어기면 막히는 실행 계약".

## 범위
- **In:** `policy.yaml` zod 스키마, 로더, `enforce(action, doc, policy)` 게이트, `validate`/`push`/API 검토 라우트 연결.
- **Out:** 파이프라인 C 동작(PR-10/11), 외부 크롤 상한 실제 적용(PR-19).

## 변경 파일
- 🆕 `packages/wkf/src/policy.ts`(스키마·로더·enforce)
- 🆕 `knowledge/policy.yaml`(기본값)
- 🔧 `packages/wkf/src/validate.ts`(citations 필수 type 연동), `sync/push.ts`(게이트 호출)
- 🔧 `apps/api`(검토/승인 라우트에 review roles 강제)

## 구현 단계
1. `PolicySchema`([`04` §5]): `freshness`(type별 + default), `sources`(tiers·auto_publish_max_tier·allowed_hosts), `enrichment`(web_max_pages·agent_step_limit), `citations`(required_for·require_fact_verification), `review`(approver_roles·overrides), `conformance`(reject_on_missing_type·block_commit_on_validate_fail).
2. 기본값([`10` §0 결정 #7·#8]): 사내 우선, 규정 90d·정책 180d·지표 30d·기본 365d.
3. `enforce(action, doc, policy)`: 인입/큐레이션/커밋별 적용. 위반 시 `PolicyError`.
4. API: 승인 라우트가 `review.approver_roles`(+type overrides, 예 REGULATION→ADMIN) 강제.

## 테스트
- 스키마 파싱/기본값.
- citations 필수 type 인용 누락 → 커밋 차단.
- 승인 권한 없는 사용자 → 거부(기존 RBAC 회귀 포함).
- `auto_publish_max_tier` 초과 소스 → 검토 강제.

## DoD
- [ ] `policy.yaml`이 로드되고 위반이 커밋/API에서 차단된다.
- [ ] type별 승인 override 동작.
- [ ] 기본값이 [`10` §0]과 일치.

## 리스크·메모
- 정책 변경은 git diff로 리뷰(정책도 코드). 핫리로드보다 배포 시 로드 권장.
