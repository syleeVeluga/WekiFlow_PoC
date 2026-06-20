# PR-12 — 쓰기 경로에 비축소(non-shrinkage) 강제

> Phase 6 · 선행: PR-03, PR-11 · 근거: [`07` §5](../07-knowledge-format-and-generation.md), [`05` §2.3](../05-curation-agent.md)

## 목표
큐레이션/병합이 문서를 *축소*(헤딩 삭제·스키마 필드 감소·인용 감소)하지 못하도록, **쓰기 직전** PR-03의 `assertNoShrinkage`를 강제한다. "지키면 좋은 가이드"를 "어기면 쓰기 거부"로.

## 범위
- **In:** `toolWriteConcept`/`tool_merge`/`wkf push`(큐레이션 출처) 쓰기 직전 `assertNoShrinkage(before, after)` 강제.
- **Out:** 라이브러리 자체(PR-03), 인입(파이프라인 A 신규 작성)은 비축소 비적용(신규는 before 없음).

## 변경 파일
- 🔧 `packages/agent-tools`(`toolWriteConcept` 검증 래퍼)
- 🔧 `packages/wkf/src/sync/push.ts`(큐레이션 출처 push에 가드)
- 🔧 `workers/curation`(병합 결과 검증)

## 구현 단계
1. 쓰기 진입점에 before(현재 published) vs after(제안) 비교 → `assertNoShrinkage` 위반 시 **거부**(에이전트 루프로 에러 반환 → 재시도/skip 유도).
2. 적용 범위 차등([`07` §5 pass별 규칙]):
   - **파이프라인 C(재작성):** 엄격 비축소.
   - **파이프라인 A(신규 인입):** before 없음 → 비적용.
   - type=Reference 등은 정책에 따라 우회 가능.
3. 위반 사유를 SSE/`jobs.agentSteps`에 기록(관측성).

## 테스트
- 큐레이션이 헤딩 삭제/스키마 축소/인용 감소 시 쓰기 거부.
- 가산 보강은 통과.
- 신규 인입(A)은 가드 비적용 확인.

## DoD
- [x] 큐레이션 에이전트가 문서를 축소하는 쓰기가 **자동 차단**된다([`10` §3.2]).
- [x] 가산 변경은 정상 통과.
- [x] 거부 사유가 감사 로그에 남는다.

완료 증거:
- 구현 PR: <https://github.com/syleeVeluga/WekiFlow_PoC/pull/24>
- 검증: `corepack pnpm -r build`, `corepack pnpm -r typecheck`, `corepack pnpm -r test`

## 리스크·메모
- 과민 차단으로 정상 보강이 막히면 `assertHeadingsPreserved` 정규화 보정(PR-03).
- CI 테스트(PR-03)와 런타임 강제(PR-12) 둘 다 둠 — 우회 불가.
