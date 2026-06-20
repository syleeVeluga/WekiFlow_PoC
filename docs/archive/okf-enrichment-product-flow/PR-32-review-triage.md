# PR-32 — Review Triage: 위험도 라우팅 + 승인 사유 inbox (T4)

> Track T4 · 상태: 완료(PR #44, 2026-06-21) · 선행: [PR-26](./PR-26-candidate-contract.md), [PR-27](./PR-27-candidate-model-and-trust-labels.md) · 근거: [`Overview.md`](./Overview.md) §3.3·§5.1-6·§5.2-3, [`Gap-Analysis.md`](./Gap-Analysis.md) §2.6·§3.3
> 외부 API 메모: 없음.

## 목표

승인 화면을 "모든 draft diff"가 아니라 **위험도 기반 triage**로 전환한다. PR-26 `needsReview` 규칙을 정책 엔진과 연결하고, Review inbox를 "왜 승인이 필요한지"(정책성·출처 없음·충돌·외부 공개) 중심 카드로 재설계한다.

## 구현 결과

- `packages/wkf/src/reviewRouting.ts`에 `routeCandidate(candidate, policy)`를 추가했다.
  - `auto_publish`, `needs_approval`, `needs_source`, `reject` 네 가지 경로를 반환한다.
  - `review.approver_roles`와 type override를 사용한다.
  - type-specific override는 generic risk factor로 넓어지지 않도록 보수적으로 적용한다.
- `apps/api/src/server.ts`에 candidate review routing API를 추가했다.
  - `GET /api/candidate-review-routes`
  - `POST /api/candidates/:id/route`
  - 기존 `PATCH /api/candidates/:id`의 `PUBLISHED` 전이도 routing gate를 통과해야 한다.
- `apps/web/src/components/review/ReviewPage.tsx`에 승인 사유 중심 candidate triage 섹션을 추가했다.
  - 위험도 사유, 권장 조치, provenance, 승인 가능 역할을 카드에 표시한다.
  - 낮은 위험 후보는 게시, 출처 부족 후보는 출처 요청, 고위험 후보는 승인, 충돌 후보는 보류로 처리한다.

## 검증

- `corepack pnpm --filter @wekiflow/wkf test -- reviewRouting`
- `corepack pnpm --filter @wf/api test -- server`
- `corepack pnpm -r typecheck`
- `corepack pnpm -r test`
- `corepack pnpm build`
- GitHub CI `verify` on PR #44

## DoD

- [x] 승인 queue 진입은 위험도 기반으로 결정된다(저위험 auto-publish).
- [x] Review inbox가 승인 사유 중심으로 표시된다.
- [x] 충돌 후보는 승인 후 게시되지 않는다.
- [x] 기존 역할 기반 승인 권한은 유지된다.

## 리스크·메모

- 후보 승격은 candidate 상태를 `PUBLISHED`로 전이한다. 실제 지식 문서 materialization은 후보 모델/게시 경계의 후속 명시 계약에서 확장할 수 있다.
- 기존 document review queue는 유지했다. PR-32는 candidate triage를 추가해 기존 Layer 1 review 동작을 깨지 않는 범위로 닫았다.
