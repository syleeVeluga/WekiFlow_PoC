# PR-32 — Review Triage: 위험도 라우팅 + 승인 사유 inbox (T4)

> Track T4 · 상태: 계획 · 선행: [PR-26](./PR-26-candidate-contract.md), [PR-27](./PR-27-candidate-model-and-trust-labels.md) · 근거: [`Overview.md`](./Overview.md) §3.3·§5.1-6·§5.2-3, [`Gap-Analysis.md`](./Gap-Analysis.md) §2.6·§3.3
> 외부 API 메모: 없음.

## 목표

승인을 "모든 draft diff"가 아니라 **위험도 기반 triage**로 전환한다. PR-26 `needsReview` 규칙을 정책 엔진에 연결하고, Review inbox를 "왜 승인이 필요한지"(정책성·출처없음·충돌·외부공개) 중심 카드로 재설계한다.

## 범위

- **In:**
  - 정책 엔진에 위험도 기반 `needsReview` 결합(역할/타입 + riskFactors).
  - approval routing: 위험 후보만 승인 큐로, 저위험은 auto-publish.
  - Review inbox 재설계 — 위험 사유 카드 + 그룹핑.
- **Out:** 후보 모델/라벨(PR-27), 대화 후보 생성(PR-30), 답변 신뢰 표시(PR-34).

## 변경 파일

- 🔧 `packages/wkf/src/policy.ts` — `enforcePolicy('review', …)`에 PR-26 `needsReview(candidate)` 결합. 기존 역할/타입 체크 유지하되 riskFactor 기반 게이트 추가.
- 🆕 `packages/wkf/src/reviewRouting.ts` — `routeCandidate(candidate, policy)` → `auto_publish | needs_approval | needs_source | reject`.
- 🔧 `apps/api/src/server.ts` — 후보 발행 시 routing 적용, 승인/반려 라우트.
- 🔧 `apps/web/src/components/review/ReviewPage.tsx` — 위험 사유 카드, 사유별 그룹(정책성/출처없음/충돌/외부공개), 일괄 처리.
- 🔧 `apps/web/src/components/review/ReviewDetailPanel` — "승인 필요 사유" 섹션 강조.

## 구현 단계

1. **정책 결합.** `routeCandidate`: `canAutoPublish`이면 auto_publish, `needsReview`이면 needs_approval, 대화/약출처면 needs_source, 충돌이면 승인 전 게시 금지.
2. **role 유지.** 승인 권한은 기존 `review.approver_roles`/type override 그대로. 위험도는 "무엇이 승인 큐에 들어오는가"를 결정, 역할은 "누가 승인하는가"를 결정.
3. **inbox 재설계.** 후보를 위험 사유로 그룹핑한 카드 목록. 각 카드에 사유 뱃지(정책성/규정/계약/보안/가격/공식답변/출처없음/충돌/외부공개) + 권장 액션.
4. **diff는 보조로.** Monaco diff는 상세 패널의 한 탭으로 격하, 1차 화면은 "왜·무엇을·어떻게" 요약 카드.
5. **일괄 처리.** 저위험 묶음 일괄 승인/자동통과, 고위험은 개별 검토 강제.

## 테스트

- `routeCandidate`: 4분기(auto/approval/source/reject) 단위 테스트.
- 정책: 역할 없는 사용자의 고위험 승인 거부.
- auto-publish: 저위험·비대화 후보가 승인 없이 발행.
- UI: 사유별 그룹 렌더, 일괄 승인.

## DoD

- [ ] 승인 큐 진입이 위험도 기반으로 결정된다(저위험 auto-publish).
- [ ] Review inbox가 승인 사유 중심으로 표시된다.
- [ ] 충돌 후보는 승인 전 게시되지 않는다.
- [ ] 기존 역할 기반 승인 권한이 유지된다.

## 리스크·메모

- 기존 `documents` REVIEW 워크플로와 후보 routing이 이중화되지 않도록 PR-27 매핑표 기준으로 단일화.
- auto-publish 도입은 신중히 — 초기엔 보수적 임계값(거의 모두 review)에서 시작해 점진 완화 권장.
